/**
 * Consensus Verifier — Round 1 에이전트 출력 기반 algorithmic consensus 검증.
 *
 * Moderator가 할당한 consensusLevel을 Round 1 에이전트 4명의 실제 발언과
 * 키워드 매칭으로 대조한다. LLM을 사용하지 않는 순수 규칙 기반 검증.
 *
 * #713: Moderator consensus_level 알고리즘 검증 부재 해소.
 */

import { logger } from "@/lib/logger";
import type { RoundOutput, Thesis, ConsensusLevel, AgentPersona } from "@/types/debate";

/** 부정 맥락 키워드 — 이 키워드 근처에 thesis 키워드가 등장하면 미지지로 판정 */
const NEGATIVE_CONTEXT_PATTERNS: RegExp[] = [
  /(?:반박|반대|우려|리스크|위험|부정|약화|하락|과대|과소|의문|불확실|경고|주의|제한|억제|둔화|감소|축소|악화|비관|취약|부담|장애|저해|걸림돌|역풍)/,
];

/** 긍정 맥락 키워드 — thesis 키워드와 함께 등장하면 지지로 판정 */
const POSITIVE_CONTEXT_PATTERNS: RegExp[] = [
  /(?:지지|동의|강조|확인|긍정|강화|상승|성장|확대|가속|수혜|기회|호조|낙관|유망|주도|선도|촉진|촉매|수요|확장|개선)/,
];

/**
 * thesis 텍스트에서 핵심 키워드를 추출한다.
 * 한글 명사구, 영문 대문자 약어/종목, 숫자+단위를 추출.
 * 너무 짧은(2자 미만) 키워드는 제외.
 */
export function extractThesisKeywords(thesisText: string): string[] {
  const keywords: string[] = [];

  // 영문 대문자 단어 (종목, 지표명 등): AI, NASDAQ, VIX, Technology 등
  const englishMatches = thesisText.match(/\b[A-Z][A-Za-z&]{1,20}\b/g);
  if (englishMatches != null) {
    keywords.push(...englishMatches);
  }

  // 한글 핵심 명사구 추출 (2자 이상)
  // "~의", "~가", "~를" 등 조사를 제거하고 명사 부분만 추출
  const koreanMatches = thesisText.match(/[가-힣]{2,10}/g);
  if (koreanMatches != null) {
    // 조사/어미 패턴 제거
    const STOP_WORDS = new Set([
      "에서", "으로", "에게", "까지", "부터", "처럼", "만큼",
      "하는", "되는", "있는", "없는", "이는", "하고", "하면",
      "것이", "것을", "것은", "것에", "대한", "위한", "통한",
      "따른", "인한", "의한", "관련", "이상", "이하", "미만",
      "기준", "기반", "수준", "단계", "시점", "초기", "후기",
    ]);
    for (const word of koreanMatches) {
      if (!STOP_WORDS.has(word) && word.length >= 2) {
        keywords.push(word);
      }
    }
  }

  // 중복 제거
  return [...new Set(keywords)];
}

/**
 * 에이전트 출력에서 특정 키워드 주변 맥락이 긍정적인지 부정적인지 판정한다.
 * 키워드가 출현하지 않으면 null (판정 불가).
 * 키워드 주변 ±100자 범위에서 긍정/부정 패턴을 검사.
 */
function analyzeKeywordContext(
  agentOutput: string,
  keyword: string,
): "support" | "oppose" | null {
  const keywordIndex = agentOutput.indexOf(keyword);
  if (keywordIndex === -1) return null;

  // 키워드 주변 ±100자 범위 추출
  const CONTEXT_WINDOW = 100;
  const start = Math.max(0, keywordIndex - CONTEXT_WINDOW);
  const end = Math.min(agentOutput.length, keywordIndex + keyword.length + CONTEXT_WINDOW);
  const context = agentOutput.slice(start, end);

  const hasNegative = NEGATIVE_CONTEXT_PATTERNS.some((p) => p.test(context));
  const hasPositive = POSITIVE_CONTEXT_PATTERNS.some((p) => p.test(context));

  // 둘 다 있으면 부정 우선 (보수적 판정)
  if (hasNegative && !hasPositive) return "oppose";
  if (hasPositive && !hasNegative) return "support";
  // 둘 다 있거나 둘 다 없으면 키워드 존재 자체를 지지로 간주 (관련 논의 = 관심)
  return "support";
}

/**
 * 단일 thesis에 대해 Round 1 에이전트들의 지지 여부를 알고리즘적으로 판정한다.
 *
 * @returns 지지 에이전트 수 (0~4)와 각 에이전트의 판정 상세
 */
export interface AgentSupportDetail {
  persona: AgentPersona;
  /** 에이전트 출력에서 thesis 키워드가 발견되었는가 */
  keywordsFound: number;
  /** 총 키워드 수 */
  totalKeywords: number;
  /** 최종 판정: support (지지), oppose (반대), absent (관련 없음) */
  verdict: "support" | "oppose" | "absent";
}

export interface AlgorithmicConsensusResult {
  /** thesis 텍스트에서 추출된 키워드 */
  keywords: string[];
  /** 알고리즘 산출 지지 에이전트 수 */
  supportCount: number;
  /** 알고리즘 산출 consensus level */
  algorithmicConsensus: ConsensusLevel;
  /** 각 에이전트별 판정 상세 */
  details: AgentSupportDetail[];
}

/**
 * Round 1 에이전트 출력에서 thesis에 대한 알고리즘적 합의도를 산출한다.
 *
 * 키워드 매칭 기반:
 * 1. thesis에서 핵심 키워드 추출
 * 2. 각 에이전트 출력에서 키워드 등장 여부 + 맥락(긍정/부정) 분석
 * 3. 키워드의 30% 이상이 긍정 맥락으로 등장하면 "지지"
 * 4. 지지 에이전트 수로 consensus level 산출
 */
export function computeAlgorithmicConsensus(
  thesis: Thesis,
  round1Outputs: RoundOutput[],
): AlgorithmicConsensusResult {
  const keywords = extractThesisKeywords(thesis.thesis);

  // 키워드가 없으면 판정 불가 — 전원 지지로 간주 (보수적: 플래그 안 붙임)
  if (keywords.length === 0) {
    return {
      keywords: [],
      supportCount: round1Outputs.length,
      algorithmicConsensus: `${round1Outputs.length}/4` as ConsensusLevel,
      details: round1Outputs.map((o) => ({
        persona: o.persona,
        keywordsFound: 0,
        totalKeywords: 0,
        verdict: "support" as const,
      })),
    };
  }

  // thesis를 제출한 에이전트 자신은 자동 지지
  const thesisAuthor = thesis.agentPersona;

  const SUPPORT_THRESHOLD = 0.3; // 키워드 30% 이상 긍정 매칭 → 지지
  const details: AgentSupportDetail[] = [];

  for (const output of round1Outputs) {
    // thesis 제출자는 자동 지지
    if (output.persona === thesisAuthor) {
      details.push({
        persona: output.persona,
        keywordsFound: keywords.length,
        totalKeywords: keywords.length,
        verdict: "support",
      });
      continue;
    }

    let supportCount = 0;
    let opposeCount = 0;
    let foundCount = 0;

    for (const kw of keywords) {
      const result = analyzeKeywordContext(output.content, kw);
      if (result === "support") {
        supportCount++;
        foundCount++;
      } else if (result === "oppose") {
        opposeCount++;
        foundCount++;
      }
    }

    // 판정 로직
    let verdict: "support" | "oppose" | "absent";
    if (foundCount === 0) {
      verdict = "absent";
    } else {
      const supportRatio = supportCount / keywords.length;
      const opposeRatio = opposeCount / keywords.length;

      if (supportRatio >= SUPPORT_THRESHOLD) {
        verdict = "support";
      } else if (opposeRatio > supportRatio) {
        verdict = "oppose";
      } else {
        verdict = "absent";
      }
    }

    details.push({
      persona: output.persona,
      keywordsFound: foundCount,
      totalKeywords: keywords.length,
      verdict,
    });
  }

  const supportCount = details.filter((d) => d.verdict === "support").length;
  const clampedSupport = Math.max(1, Math.min(4, supportCount)) as 1 | 2 | 3 | 4;
  const algorithmicConsensus: ConsensusLevel = `${clampedSupport}/4`;

  return {
    keywords,
    supportCount,
    algorithmicConsensus,
    details,
  };
}

/**
 * consensus score 파싱 (예: "3/4" → 3)
 */
function parseConsensusScore(level: ConsensusLevel): number {
  return parseInt(level.split("/")[0], 10);
}

/**
 * 전체 thesis 배열에 대해 consensus 검증을 수행하고 불일치 플래그를 부착한다.
 *
 * 판정 기준: Moderator consensus와 알고리즘 consensus가 2단계 이상 차이나면
 * consensusUnverified = true.
 *
 * @returns 플래그가 부착된 thesis 배열 (원본 변경 없이 새 배열 반환)
 */
export function verifyConsensusLevels(
  theses: Thesis[],
  round1Outputs: RoundOutput[],
): Thesis[] {
  // Round 1 에이전트가 4명이 아니면 검증 불가 — 원본 그대로 반환
  if (round1Outputs.length !== 4) {
    logger.warn(
      "ConsensusVerifier",
      `Round 1 에이전트 수가 4명이 아님 (${round1Outputs.length}명) — consensus 검증 스킵`,
    );
    return theses;
  }

  return theses.map((thesis) => {
    const result = computeAlgorithmicConsensus(thesis, round1Outputs);
    const moderatorScore = parseConsensusScore(thesis.consensusLevel);
    const algorithmicScore = parseConsensusScore(result.algorithmicConsensus);
    const gap = Math.abs(moderatorScore - algorithmicScore);

    const UNVERIFIED_THRESHOLD = 2;
    const isUnverified = gap >= UNVERIFIED_THRESHOLD;

    if (isUnverified) {
      logger.warn(
        "ConsensusVerifier",
        `Consensus 불일치 감지: "${thesis.thesis.slice(0, 50)}..." — ` +
        `Moderator: ${thesis.consensusLevel}, 알고리즘: ${result.algorithmicConsensus} (gap=${gap})`,
      );
    }

    return {
      ...thesis,
      consensusUnverified: isUnverified ? true : undefined,
    };
  });
}

// ---------------------------------------------------------------------------
// Report Validator — 리포트 발송 전 후처리 검증 레이어
// ---------------------------------------------------------------------------

const BULL_KEYWORDS = [
  "상승", "급등", "돌파", "신고가", "강세", "긍정", "호재", "성장", "개선", "확대",
] as const;

const BEAR_KEYWORDS = [
  "리스크", "주의", "경고", "위험", "하락", "약세", "손절", "변동성", "과열", "저항", "둔화", "부진",
] as const;

import { MIN_PHASE, MIN_RS_SCORE } from "@/agent/tools/validation";

const BULL_BIAS_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReportType = "daily" | "weekly";

export interface ReportValidationInput {
  markdown: string;
  reportType?: ReportType;
  leadingSectors?: string[];
  recommendations?: Array<{
    symbol: string;
    sector?: string;
    rsScore?: number;
    phase?: number;
    prevPhase?: number;
    pctFromLow52w?: number;
    volRatio?: number;
  }>;
}

export interface ReportValidationResult {
  warnings: string[];
  errors: string[];
  isValid: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countKeywords(text: string, keywords: readonly string[]): number {
  let count = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) {
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function checkRiskKeywords(
  markdown: string,
  warnings: string[],
  errors: string[],
): void {
  const bearCount = countKeywords(markdown, BEAR_KEYWORDS);
  const bullCount = countKeywords(markdown, BULL_KEYWORDS);

  if (bearCount === 0) {
    errors.push(
      "리포트에 리스크 관련 키워드가 전혀 없습니다. 리스크 섹션을 추가하세요.",
    );
  }

  const total = bullCount + bearCount;
  if (total > 0) {
    const bullRatio = bullCount / total;
    if (bullRatio > BULL_BIAS_THRESHOLD) {
      const pct = Math.round(bullRatio * 100);
      warnings.push(
        `Bull-bias ${pct}% 감지 (bull: ${bullCount}, bear: ${bearCount}). 균형 잡힌 분석이 필요합니다.`,
      );
    }
  }
}

function checkSectorAlignment(
  leadingSectors: string[],
  recommendations: Array<{ symbol: string; sector?: string }>,
  warnings: string[],
): void {
  const hasMatch = recommendations.some(
    (rec) =>
      rec.sector != null &&
      leadingSectors.some((ls) =>
        rec.sector!.toLowerCase().includes(ls.toLowerCase()),
      ),
  );

  if (!hasMatch) {
    const recSectors = recommendations
      .map((r) => r.sector)
      .filter((s): s is string => s != null);
    const uniqueRecSectors = [...new Set(recSectors)];
    warnings.push(
      `섹터-종목 불일치: 주도섹터 [${leadingSectors.join(", ")}]와 추천 종목 섹터 [${uniqueRecSectors.join(", ")}]가 겹치지 않습니다.`,
    );
  }
}

function checkSubstandardStocks(
  recommendations: Array<{
    symbol: string;
    rsScore?: number;
    phase?: number;
  }>,
  warnings: string[],
  errors: string[],
): void {
  const substandardPhase: string[] = [];
  const substandardRs: string[] = [];

  for (const rec of recommendations) {
    const isPhase1 = rec.phase != null && rec.phase < MIN_PHASE;
    if (isPhase1) {
      // Phase 1 종목은 RS 수치와 무관하게 항상 ERROR — RS 경고를 중복 발행하지 않음
      substandardPhase.push(`${rec.symbol} (Phase ${rec.phase})`);
    } else if (rec.rsScore != null && rec.rsScore < MIN_RS_SCORE) {
      substandardRs.push(`${rec.symbol} (RS ${rec.rsScore})`);
    }
  }

  if (substandardPhase.length > 0) {
    errors.push(
      `Phase 1 종목 추천 감지: ${substandardPhase.join(", ")} — 추천 목록에서 제외하세요`,
    );
  }

  if (substandardRs.length > 0) {
    warnings.push(`RS 기준 미달 종목: ${substandardRs.join(", ")}`);
  }
}

/**
 * Phase 2 비율이 100%를 초과하는 패턴을 감지한다.
 * "Phase 2: 3520%" 같은 이중 변환 버그를 리포트 발송 전에 차단.
 */
const MAX_PHASE2_RATIO = 100;

function checkPhase2RatioRange(
  markdown: string,
  errors: string[],
): void {
  // Phase 2: NUM% (콜론 포함, 중간 텍스트 허용) + Phase 2 비율 NUM% (콜론 없음)
  const phase2Pattern = /Phase\s*2(?:[^:\n]*:\s*|\s*(?:비율|종목\s*비율)\s*)([\d,]+(?:\.\d+)?)\s*%/gi;
  let match: RegExpExecArray | null;
  while ((match = phase2Pattern.exec(markdown)) !== null) {
    const rawValue = match[1].replace(/,/g, "");
    const value = Number(rawValue);
    if (Number.isFinite(value) && value > MAX_PHASE2_RATIO) {
      errors.push(
        `Phase 2 비율 이상값 감지: ${value}% (최대 100%). 이중 변환(×100) 버그 가능성. 원본: "${match[0]}"`,
      );
    }
  }

  // (전일 NUM%) 패턴 — Phase 2 전일 비율도 0~100 범위
  const prevDayPattern = /\(전일\s*([\d,]+(?:\.\d+)?)\s*%\)/gi;
  while ((match = prevDayPattern.exec(markdown)) !== null) {
    const rawValue = match[1].replace(/,/g, "");
    const value = Number(rawValue);
    if (Number.isFinite(value) && value > MAX_PHASE2_RATIO) {
      errors.push(
        `전일 비율 이상값 감지: ${value}% (최대 100%). 이중 변환(×100) 버그 가능성. 원본: "${match[0]}"`,
      );
    }
  }
}

/**
 * 일간 리포트 MD에 필수 섹션이 포함되어 있는지 검증한다.
 * 필수 키워드: "시장 온도", "섹터 RS"(RS 랭킹 표), "시장 흐름"(종합 전망)
 */
type SectionSeverity = "error" | "warning";

const DAILY_REQUIRED_SECTIONS: ReadonlyArray<{
  keyword: string;
  label: string;
  severity: SectionSeverity;
}> = [
  { keyword: "시장 온도", label: "시장 온도 근거", severity: "error" },
  { keyword: "섹터 RS", label: "섹터 RS 랭킹 표", severity: "error" },
  { keyword: "시장 흐름", label: "시장 흐름 및 종합 전망", severity: "error" },
  { keyword: "섹터별 요약", label: "섹터별 요약", severity: "warning" },
  { keyword: "전일 대비", label: "전일 대비 변화 요약", severity: "warning" },
];

/** 특이종목이 없는 날 메시지만 전송하면 markdownContent가 빈 문자열. 실질적인 MD 파일 최소 길이. */
export const MIN_DAILY_MD_LENGTH = 500;

function checkDailySections(
  markdown: string,
  warnings: string[],
  errors: string[],
): void {
  if (markdown.length < MIN_DAILY_MD_LENGTH) {
    return;
  }

  const missingRequired: string[] = [];
  const missingOptional: string[] = [];

  for (const section of DAILY_REQUIRED_SECTIONS) {
    if (!markdown.includes(section.keyword)) {
      if (section.severity === "error") {
        missingRequired.push(section.label);
      } else {
        missingOptional.push(section.label);
      }
    }
  }

  if (missingRequired.length > 0) {
    errors.push(
      `일간 리포트 필수 섹션 누락: ${missingRequired.join(", ")}`,
    );
  }

  if (missingOptional.length > 0) {
    warnings.push(
      `일간 리포트 권장 섹션 누락: ${missingOptional.join(", ")}`,
    );
  }
}

/**
 * Phase 2 분류와 약세 서술이 같은 줄에 동시 등장하는 패턴을 감지한다.
 * 예: "SLDB Phase 2 — 바이오테크 약세 시작"
 *
 * @remarks 주간 리포트는 섹터 전체 흐름 서술에서 false positive 가능성이 높아 일간 전용으로 제한.
 */
const PHASE2_BEARISH_PATTERN = /Phase\s*2[^\n]*?(약세|하락세|부진|급락|손절|급락 경고|모멘텀 훼손|추세 이탈|하락 전환|약세 전환)/gi;

function checkPhaseDescriptionConsistency(
  markdown: string,
  warnings: string[],
  errors: string[],
): void {
  const conflicts = [...markdown.matchAll(PHASE2_BEARISH_PATTERN)]
    .map((match) => ({ text: match[0].slice(0, 80), keyword: match[1] }));

  if (conflicts.length === 0) return;

  // "급락" 키워드가 포함된 모순은 ERROR (Phase 2 + 급락은 심각한 불일치)
  const severeConflicts = conflicts.filter((c) => c.keyword.includes("급락"));
  const mildConflicts = conflicts.filter((c) => !c.keyword.includes("급락"));

  if (severeConflicts.length > 0) {
    errors.push(
      `Phase 2 ↔ 급락 서술 모순 감지 (${severeConflicts.length}건). Phase 2 종목에 급락 경고를 사용하려면 ⚠️ 약세 경고 섹션으로 이동하세요: ${severeConflicts.map((c) => c.text).join(" | ")}`,
    );
  }

  if (mildConflicts.length > 0) {
    warnings.push(
      `Phase 2 분류 ↔ 약세 서술 모순 감지 (${mildConflicts.length}건). 서술 또는 Phase 분류를 수정하세요: ${mildConflicts.map((c) => c.text).join(" | ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// F. 마크다운 텍스트에서 Phase 1 종목 추천 감지 (recommendations 데이터 없이도 동작)
// ---------------------------------------------------------------------------

/**
 * 마크다운 본문에서 Phase 1 종목이 추천 목록에 포함된 패턴을 감지한다.
 * `[기준 미달]` 태그 또는 "Phase 1" 키워드가 추천 문맥에서 등장하면 ERROR.
 *
 * recommendations 배열이 전달되지 않는 호출(sendDiscordReport 등)에서도
 * Phase 1 추천을 차단하기 위한 텍스트 기반 방어선.
 */
const PHASE1_RECOMMENDATION_PATTERN =
  /(?:\[기준\s*미달\]|Phase\s*1\b)[^\n]*?(?:추천|매수|진입|편입)/gi;
const SUBSTANDARD_TAG_PATTERN = /\[기준\s*미달\]/gi;

function checkPhase1InMarkdown(
  markdown: string,
  errors: string[],
): void {
  const substandardMatches = [...markdown.matchAll(SUBSTANDARD_TAG_PATTERN)];
  if (substandardMatches.length > 0) {
    errors.push(
      `[기준 미달] 태그 종목 ${substandardMatches.length}건이 리포트에 포함되어 있습니다 — Phase 1 종목은 추천 목록에서 제외하세요`,
    );
    return;
  }

  const phase1Matches = [...markdown.matchAll(PHASE1_RECOMMENDATION_PATTERN)];
  if (phase1Matches.length > 0) {
    const samples = phase1Matches.map((m) => m[0].slice(0, 60));
    errors.push(
      `Phase 1 종목 추천 문맥 감지 (${phase1Matches.length}건): ${samples.join(" | ")}`,
    );
  }
}

// ---------------------------------------------------------------------------
// G. Phase 2 비율 이중 변환(×100) 자동 교정
// ---------------------------------------------------------------------------

/**
 * Phase 2 비율이 100%를 초과하면 ÷100으로 자동 교정한다.
 * 예: "Phase 2: 2110%" → "Phase 2: 21.1%"
 *
 * 근거: 정상 범위는 0~100%. 100 초과는 LLM이 이미 퍼센트인 값을
 * ×100 한 이중 변환 패턴. 교정 사실은 corrections 배열로 반환.
 */
export function sanitizePhase2Ratios(markdown: string): {
  text: string;
  corrections: string[];
} {
  const corrections: string[] = [];

  // 1차: "Phase 2: NUM%" (콜론 포함) 또는 "Phase 2 비율 NUM%" (콜론 없음)
  const phase2Pattern = /Phase\s*2(?:[^:\n]*:\s*|\s*(?:비율|종목\s*비율)\s*)([\d,]+(?:\.\d+)?)\s*%/gi;

  let text = markdown.replace(phase2Pattern, (fullMatch, rawValue: string) => {
    const numericStr = rawValue.replace(/,/g, "");
    const value = Number(numericStr);
    if (Number.isFinite(value) && value > MAX_PHASE2_RATIO) {
      const corrected = (value / 100).toFixed(1);
      corrections.push(`${rawValue}% → ${corrected}%`);
      return fullMatch.replace(rawValue, corrected);
    }
    return fullMatch;
  });

  // 2차: "(전일 NUM%)" 패턴 — Phase 2 컨텍스트에서 전일 비율도 이중 변환 대상
  const prevDayPattern = /\(전일\s*([\d,]+(?:\.\d+)?)\s*%\)/gi;

  text = text.replace(prevDayPattern, (fullMatch, rawValue: string) => {
    const numericStr = rawValue.replace(/,/g, "");
    const value = Number(numericStr);
    if (Number.isFinite(value) && value > MAX_PHASE2_RATIO) {
      const corrected = (value / 100).toFixed(1);
      corrections.push(`전일 ${rawValue}% → ${corrected}%`);
      return fullMatch.replace(rawValue, corrected);
    }
    return fullMatch;
  });

  return { text, corrections };
}

// ---------------------------------------------------------------------------
// H. 주도 섹터 연속 동일 시 유지 사유 서술 검증
// ---------------------------------------------------------------------------

/**
 * "전일 대비" 섹션에서 섹터가 "동일" 또는 "유지"로 언급되면서
 * 사유 설명 키워드가 없으면 warning을 발행한다.
 *
 * 예: "주도 섹터 전일과 동일" → 왜 동일한지 1줄 이상 필요
 */
const SECTOR_CONTINUITY_PATTERN =
  /(?:주도\s*섹터|상위\s*섹터)[^\n]*?(?:동일|유지|변동\s*없|변화\s*없|그대로)/gi;
const SECTOR_REASON_KEYWORDS = [
  "때문", "영향", "지속", "이유", "근거", "배경", "덕분",
  "상승", "하락", "개선", "악화", "수급", "유입", "이탈",
  "WTI", "금리", "실적", "마진", "수요", "공급",
] as const;

function checkSectorContinuityReason(
  markdown: string,
  warnings: string[],
): void {
  // "전일 대비" 섹션 추출 (## 전일 대비 ~ 다음 ## 또는 EOF)
  const sectionMatch = markdown.match(/##\s*전일 대비[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i);
  if (sectionMatch == null) return;

  const section = sectionMatch[1];
  const continuityMatches = [...section.matchAll(SECTOR_CONTINUITY_PATTERN)];
  if (continuityMatches.length === 0) return;

  // 사유 키워드가 섹션 내에 하나라도 있으면 통과
  const hasReason = SECTOR_REASON_KEYWORDS.some((kw) => section.includes(kw));
  if (!hasReason) {
    warnings.push(
      "주도 섹터가 전일과 동일하나 유지 사유가 서술되지 않았습니다. 지속 근거를 1줄 이상 추가하세요.",
    );
  }
}

// ---------------------------------------------------------------------------
// I. 전일 추천→익일 경고 전환 맥락 검증
// ---------------------------------------------------------------------------

/**
 * 동일 종목이 ⭐/◎ 강세 섹션과 ⚠️ 약세 섹션에 모두 등장하면
 * 방향 반전 맥락이 필요함을 경고한다.
 *
 * @remarks 같은 리포트 내에서 강세와 약세를 동시 서술하는 것은
 *          전일→익일 반전의 축약 표현일 수 있다.
 */
const SYMBOL_IN_CONTEXT_PATTERN = /\b([A-Z]{2,5}(?:\.[A-Z]{1,2})?)\b/g;

function checkDirectionReversalContext(
  markdown: string,
  warnings: string[],
): void {
  // 강세 섹션의 종목 추출
  const bullSection = markdown.match(/[⭐◎]\s*강세[^\n]*(?:\n(?![#⚠])[^\n]*)*/g);
  const bearSection = markdown.match(/⚠️?\s*약세[^\n]*(?:\n(?![#⭐◎])[^\n]*)*/g);

  if (bullSection == null || bearSection == null) return;

  const bullText = bullSection.join("\n");
  const bearText = bearSection.join("\n");

  const bullSymbols = new Set(
    [...bullText.matchAll(SYMBOL_IN_CONTEXT_PATTERN)].map((m) => m[1]),
  );
  const bearSymbols = new Set(
    [...bearText.matchAll(SYMBOL_IN_CONTEXT_PATTERN)].map((m) => m[1]),
  );

  // 공통 종목 = 같은 리포트에서 강세+약세 동시 언급
  const overlap = [...bullSymbols].filter((s) => bearSymbols.has(s));
  // 일반적인 키워드 제외 (RS, Phase, MA 등은 종목이 아님)
  const COMMON_WORDS = new Set(["RS", "MA", "EPS", "PE", "PB", "ETF", "VIX", "DOW", "QQQ", "SPY", "IWM"]);
  const realOverlap = overlap.filter((s) => !COMMON_WORDS.has(s));

  if (realOverlap.length > 0) {
    warnings.push(
      `종목 방향 반전 감지: ${realOverlap.join(", ")}이(가) 강세/약세 섹션에 동시 등장합니다. 방향 전환 맥락(원인)을 명시하세요.`,
    );
  }
}

// ---------------------------------------------------------------------------
// J. 역분할 의심 종목 감지
// ---------------------------------------------------------------------------

/**
 * Phase 4/3 → Phase 2 전환 + 52주 저점 대비 극단적 괴리율(>1000%)인 종목을
 * 역분할 기술적 아티팩트 의심 대상으로 경고한다.
 *
 * 근거: 역분할 시 주가가 N배 상승하여 기술적 지표(MA, Phase)가 인위적으로
 * 상승 추세로 전환된다. 실제 추세 전환이 아닌 가격 인위 상승이므로 경고 필요.
 */
const REVERSE_SPLIT_PCT_THRESHOLD = 1000;

function checkReverseSplitSuspect(
  recommendations: Array<{
    symbol: string;
    phase?: number;
    prevPhase?: number;
    pctFromLow52w?: number;
  }>,
  warnings: string[],
): void {
  const suspects: string[] = [];

  for (const rec of recommendations) {
    if (
      rec.phase === 2 &&
      rec.prevPhase != null &&
      rec.prevPhase >= 3 &&
      rec.pctFromLow52w != null &&
      rec.pctFromLow52w > REVERSE_SPLIT_PCT_THRESHOLD
    ) {
      suspects.push(
        `${rec.symbol} (Phase ${rec.prevPhase}→2, 52주 저점 대비 +${rec.pctFromLow52w.toFixed(0)}%)`,
      );
    }
  }

  if (suspects.length > 0) {
    warnings.push(
      `역분할 의심 종목 감지: ${suspects.join(", ")} — Phase 급전환 + 극단적 괴리율은 역분할 기술적 아티팩트일 수 있습니다. 실제 추세 전환 여부를 확인하세요.`,
    );
  }
}

// ---------------------------------------------------------------------------
// K. 추천 종목별 리스크 언급 비율 검증
// ---------------------------------------------------------------------------

/**
 * 추천 종목 중 마크다운에서 리스크/경고를 언급한 종목 비율이
 * 30% 미만이면 bull-bias 경고를 발행한다.
 *
 * 기존 checkRiskKeywords는 전체 키워드 빈도를 계산하지만,
 * 이 체커는 종목별로 리스크 언급 여부를 확인한다.
 */
const MIN_RISK_MENTION_RATIO = 0.3;
const MIN_RECOMMENDATIONS_FOR_CHECK = 3;

const PER_REC_BEAR_KEYWORDS = [
  "리스크", "주의", "경고", "위험", "과열", "급락",
  "손절", "변동성", "저항", "둔화", "약세",
] as const;

function checkPerRecRiskMention(
  markdown: string,
  recommendations: Array<{ symbol: string }>,
  warnings: string[],
): void {
  if (recommendations.length < MIN_RECOMMENDATIONS_FOR_CHECK) return;

  let riskMentionedCount = 0;

  for (const rec of recommendations) {
    // 종목 심볼이 등장하는 줄과 그 다음 2줄 범위에서 리스크 키워드 검색
    const symbolPattern = new RegExp(
      `\\b${rec.symbol}\\b[^\\n]*(?:\\n[^\\n]*){0,2}`,
      "g",
    );
    const symbolContexts = [...markdown.matchAll(symbolPattern)]
      .map((m) => m[0])
      .join(" ");

    const hasRiskMention = PER_REC_BEAR_KEYWORDS.some((kw) =>
      symbolContexts.includes(kw),
    );

    if (hasRiskMention) {
      riskMentionedCount++;
    }
  }

  const ratio = riskMentionedCount / recommendations.length;
  if (ratio < MIN_RISK_MENTION_RATIO) {
    const pct = Math.round(ratio * 100);
    warnings.push(
      `추천 종목 리스크 언급 비율 ${pct}% (${riskMentionedCount}/${recommendations.length}건) — 목표 30% 이상. 추천 종목별 리스크/주의사항을 보강하세요.`,
    );
  }
}

// ---------------------------------------------------------------------------
// L. 극단적 거래량 과열 경고 누락 감지
// ---------------------------------------------------------------------------

/**
 * 거래량 비율(volRatio)이 극단적으로 높은 종목(10배 이상)에 대해
 * 마크다운에 과열/주의 경고가 없으면 경고를 발행한다.
 */
const EXTREME_VOL_RATIO = 10;

function checkExtremeVolumeWithoutWarning(
  markdown: string,
  recommendations: Array<{ symbol: string; volRatio?: number }>,
  warnings: string[],
): void {
  const unwarned: string[] = [];

  for (const rec of recommendations) {
    if (rec.volRatio == null || rec.volRatio < EXTREME_VOL_RATIO) continue;

    // 해당 종목 주변 컨텍스트에서 과열/경고 키워드 확인
    const symbolPattern = new RegExp(
      `\\b${rec.symbol}\\b[^\\n]*(?:\\n[^\\n]*){0,2}`,
      "g",
    );
    const contexts = [...markdown.matchAll(symbolPattern)]
      .map((m) => m[0])
      .join(" ");

    const hasWarning = ["과열", "주의", "경고", "위험", "급등 주의", "변동성"].some(
      (kw) => contexts.includes(kw),
    );

    if (!hasWarning) {
      unwarned.push(`${rec.symbol} (거래량 ${rec.volRatio.toFixed(1)}배)`);
    }
  }

  if (unwarned.length > 0) {
    warnings.push(
      `극단적 거래량 종목에 과열 경고 누락: ${unwarned.join(", ")} — 거래량 ${EXTREME_VOL_RATIO}배 이상 급증 시 과열 가능성을 언급하세요.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function validateReport(
  input: ReportValidationInput,
): ReportValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // A. 리스크 키워드 + bull-bias 체크
  checkRiskKeywords(input.markdown, warnings, errors);

  // B. 섹터-종목 정합성 체크
  if (input.leadingSectors != null && input.recommendations != null) {
    if (input.leadingSectors.length > 0 && input.recommendations.length > 0) {
      checkSectorAlignment(input.leadingSectors, input.recommendations, warnings);
    }
  }

  // C. 기준 미달 종목 태깅 (구조화 데이터 기반)
  if (input.recommendations != null && input.recommendations.length > 0) {
    checkSubstandardStocks(input.recommendations, warnings, errors);
    // J. 역분할 의심 종목 감지
    checkReverseSplitSuspect(input.recommendations, warnings);
    // L. 극단적 거래량 과열 경고 누락
    checkExtremeVolumeWithoutWarning(input.markdown, input.recommendations, warnings);
  }

  // D. Phase 2 비율 범위 검증 (이중 변환 방어)
  checkPhase2RatioRange(input.markdown, errors);

  // E. 일간 리포트 전용 검증 (필수 섹션 + Phase 분류 일관성)
  if (input.reportType === "daily") {
    checkDailySections(input.markdown, warnings, errors);
    checkPhaseDescriptionConsistency(input.markdown, warnings, errors);
    checkSectorContinuityReason(input.markdown, warnings);
    checkDirectionReversalContext(input.markdown, warnings);
    // K. 추천 종목별 리스크 언급 비율 (일간 전용)
    if (input.recommendations != null && input.recommendations.length > 0) {
      checkPerRecRiskMention(input.markdown, input.recommendations, warnings);
    }
  }

  // F. 마크다운 텍스트에서 Phase 1 추천 감지 (recommendations 없어도 동작)
  checkPhase1InMarkdown(input.markdown, errors);

  return {
    warnings,
    errors,
    isValid: errors.length === 0,
  };
}

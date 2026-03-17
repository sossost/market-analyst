/**
 * 펀더멘탈 애널리스트 에이전트.
 *
 * 정량 스코어 + 원시 실적 데이터를 받아
 * LLM이 투자 내러티브를 생성한다.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { logger } from "../logger.js";
import { ClaudeCliProvider } from "../debate/llm/claudeCliProvider.js";
import { AnthropicProvider } from "../debate/llm/anthropicProvider.js";
import { FallbackProvider } from "../debate/llm/fallbackProvider.js";
import type { LLMProvider } from "../debate/llm/types.js";
import type { FundamentalScore, FundamentalInput, DataQualityVerdict } from "../../types/fundamental.js";
import type { StockReportContext } from "./stockReport.js";

const PERSONA_PATH = resolve(import.meta.dirname, "../../../.claude/agents/fundamental-analyst.md");
import { CLAUDE_SONNET } from "@/lib/models.js";

const FALLBACK_MODEL = CLAUDE_SONNET;
const MAX_TOKENS = 4096;
const MAX_NARRATIVE_LENGTH = 6000;

function createFundamentalProvider(): LLMProvider {
  const cli = new ClaudeCliProvider();
  const hasApiKey = process.env.ANTHROPIC_API_KEY != null && process.env.ANTHROPIC_API_KEY !== "";
  if (!hasApiKey) return cli;
  return new FallbackProvider(cli, new AnthropicProvider(FALLBACK_MODEL), "ClaudeCLI");
}

interface FundamentalAnalysis {
  symbol: string;
  narrative: string;
  tokensUsed: { input: number; output: number };
  dataQualityVerdict: DataQualityVerdict;
  dataQualityReason: string;
}

/**
 * LLM 응답에서 데이터 품질 검증 JSON을 추출한다.
 *
 * JSON 형식: `{"dataQualityVerdict": "CLEAN"|"SUSPECT", "dataQualityReason": "..."}`
 * - 코드블록(```json ... ```) 내부 또는 인라인 텍스트 모두 지원
 * - 파싱 실패 또는 JSON 없음: 보수적 폴백 `{ verdict: "CLEAN", reason: "" }` 반환
 */
export function extractDataQualityVerdict(rawNarrative: string): {
  verdict: DataQualityVerdict;
  reason: string;
  cleanedNarrative: string;
} {
  const FALLBACK = { verdict: "CLEAN" as DataQualityVerdict, reason: "", cleanedNarrative: rawNarrative };

  // 코드블록 패턴: ```json\n{...}\n``` 또는 ```\n{...}\n```
  const codeBlockPattern = /```(?:json)?\s*(\{[^`]*"dataQualityVerdict"[^`]*\})\s*```/s;
  // 인라인 패턴: {...dataQualityVerdict...}
  const inlinePattern = /(\{[^{}]*"dataQualityVerdict"[^{}]*\})/;

  const codeBlockMatch = rawNarrative.match(codeBlockPattern);
  const inlineMatch = rawNarrative.match(inlinePattern);

  const jsonString = codeBlockMatch?.[1] ?? inlineMatch?.[1] ?? null;
  if (jsonString == null) {
    return FALLBACK;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return FALLBACK;
  }

  if (
    parsed == null ||
    typeof parsed !== "object" ||
    !("dataQualityVerdict" in parsed)
  ) {
    return FALLBACK;
  }

  const obj = parsed as Record<string, unknown>;
  const verdict = obj["dataQualityVerdict"];
  const reason = obj["dataQualityReason"];

  if (verdict !== "CLEAN" && verdict !== "SUSPECT") {
    return FALLBACK;
  }

  // narrative에서 JSON 블록 제거 (raw JSON 노출 방지)
  const cleanedNarrative = codeBlockMatch != null
    ? rawNarrative.replace(codeBlockPattern, "").trim()
    : rawNarrative.replace(inlinePattern, "").trim();

  return {
    verdict,
    reason: typeof reason === "string" ? reason : "",
    cleanedNarrative,
  };
}

function loadPersonaPrompt(): string {
  const raw = readFileSync(PERSONA_PATH, "utf-8");
  const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match != null ? match[1].trim() : raw;
}

/** @internal — 테스트용 export */
export function buildUserMessage(
  score: FundamentalScore,
  input: FundamentalInput,
  technical?: StockReportContext["technical"],
  isTopGrade?: boolean,
): string {
  const { criteria } = score;
  const lines: string[] = [
    `# ${score.symbol} 펀더멘탈 분석 요청`,
    "",
    `## 등급: ${score.grade} (필수 ${score.requiredMet}/2, 가점 ${score.bonusMet}/2)`,
    "",
  ];

  // 기술적 현황 섹션
  if (technical != null) {
    lines.push(
      "## 기술적 현황",
      `- Phase: ${technical.phase}`,
      `- RS Score: ${technical.rsScore}`,
      `- 52주 고점 대비: ${technical.pctFromHigh52w.toFixed(1)}%`,
      `- 시총: $${technical.marketCapB.toFixed(1)}B`,
      `- 섹터: ${technical.sector} / ${technical.industry}`,
      `- 거래량 확인: ${technical.volumeConfirmed ? "확인" : "미확인"}`,
      "",
    );
  }

  lines.push(
    "## SEPA 기준 판정",
    `- EPS 성장: ${criteria.epsGrowth.detail}`,
    `- 매출 성장: ${criteria.revenueGrowth.detail}`,
    `- EPS 가속: ${criteria.epsAcceleration.detail}`,
    `- 이익률 추세: ${criteria.marginExpansion.detail}`,
    `- ROE: ${criteria.roe.detail}`,
    "",
    "## 분기별 원시 데이터 (최신순)",
  );

  for (const q of input.quarters) {
    const eps = q.epsDiluted != null ? `EPS $${q.epsDiluted}` : "EPS N/A";
    const rev = q.revenue != null ? `매출 $${formatLargeNumber(q.revenue)}` : "매출 N/A";
    const margin = q.netMargin != null ? `마진 ${(q.netMargin * 100).toFixed(1)}%` : "마진 N/A";
    const ni = q.netIncome != null ? `순이익 $${formatLargeNumber(q.netIncome)}` : "순이익 N/A";
    lines.push(`- ${q.asOfQ} (${q.periodEndDate}): ${eps}, ${rev}, ${ni}, ${margin}`);
  }

  lines.push("");

  if (isTopGrade === true) {
    lines.push(
      "이 종목은 S등급(Top 3 슈퍼퍼포머)입니다. 페르소나 문서의 'S등급 종목 심층 분석' 포맷에 따라 6개 섹션으로 심층 분석해주세요.",
      "",
      "## 데이터 품질 검증 (필수)",
      "아래 관점에서 이 성장률이 실제 영업 성과인지 판단하라:",
      "1. 누적 보고 의심: 매출/EPS가 특정 분기에 급격히 점프한 후 다음 분기 급락 (재무제표 재작성 패턴)",
      "2. M&A/사업 매각: 단기 급증 후 기저가 바뀌어 YoY 비교가 무의미한 경우",
      "3. 통화 불일치: 외화 보고 기업의 환율 효과가 성장률의 대부분을 설명하는 경우",
      "4. 단위 변경: 특정 분기의 절댓값이 이전/이후 분기와 10배 이상 차이",
      "",
      '판단 결과를 반드시 아래 JSON 형식으로 분석 말미에 포함하라. dataQualityVerdict 값은 "CLEAN" 또는 "SUSPECT" 중 하나여야 한다. 예시:',
      '{"dataQualityVerdict": "CLEAN", "dataQualityReason": "누적 보고나 단위 변경 등의 이슈 없이 일관된 성장세를 보임."}',
    );
  } else {
    lines.push("위 데이터를 바탕으로 이 종목의 펀더멘탈을 2-3문단으로 해석해주세요.");
  }

  // DB 데이터를 XML 래핑하여 프롬프트 인젝션 방어 (대소문자 구분 없이 처리)
  const content = lines.join("\n").replace(/<\/?financial-data[^>]*>/gi, "");
  return `<financial-data source="db" trust="internal">\n${content}\n</financial-data>`;
}

function formatLargeNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return n.toLocaleString();
}

export async function analyzeFundamentals(
  score: FundamentalScore,
  input: FundamentalInput,
  technical?: StockReportContext["technical"],
): Promise<FundamentalAnalysis> {
  const systemPrompt = loadPersonaPrompt();
  const isTopGrade = score.grade === "S";
  const userMessage = buildUserMessage(score, input, technical, isTopGrade);

  logger.info("Fundamental", `Analyzing ${score.symbol} (grade: ${score.grade})`);

  const provider = createFundamentalProvider();
  const result = await provider.call({
    systemPrompt,
    userMessage,
    maxTokens: MAX_TOKENS,
  });

  const rawNarrative = result.content;

  const { verdict, reason, cleanedNarrative } = isTopGrade
    ? extractDataQualityVerdict(rawNarrative)
    : { verdict: "CLEAN" as DataQualityVerdict, reason: "", cleanedNarrative: rawNarrative };

  const trimmedNarrative =
    cleanedNarrative.length > MAX_NARRATIVE_LENGTH
      ? cleanedNarrative.slice(0, MAX_NARRATIVE_LENGTH) + "…"
      : cleanedNarrative;

  return {
    symbol: score.symbol,
    narrative: trimmedNarrative,
    tokensUsed: result.tokensUsed,
    dataQualityVerdict: verdict,
    dataQualityReason: reason,
  };
}

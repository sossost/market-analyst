/**
 * 기업 애널리스트 에이전트 코어.
 *
 * 분석 입력 데이터를 받아 단일 Claude API 호출로 7개 섹션으로 구성된
 * 종목 심층 분석 리포트를 생성한다.
 * reviewAgent.ts의 단일 LLM 호출 패턴을 따른다.
 */
import Anthropic from "@anthropic-ai/sdk";
import { callWithRetry } from "../debate/callAgent.js";
import { logger } from "@/lib/logger.js";
import type { AnalysisInputs } from "./loadAnalysisInputs.js";

const CLIENT = new Anthropic({ maxRetries: 5 });
import { CLAUDE_SONNET } from "@/lib/models.js";

export const CORPORATE_ANALYST_MODEL = CLAUDE_SONNET;
const MAX_TOKENS = 4_096;

const SYSTEM_PROMPT = `당신은 15년 경력의 미국 주식 전문 기업 애널리스트입니다. 제공된 데이터만을 기반으로 Seeking Alpha 수준의 종목 분석 리포트를 작성합니다. 데이터에 없는 내용은 절대 작성하지 않습니다. 추측이나 가정을 하지 않습니다.

출력 형식:
- 순수 JSON 객체만 출력 (코드 펜스 없이)
- 7개 필드: investmentSummary, technicalAnalysis, fundamentalTrend, valuationAnalysis, sectorPositioning, marketContext, riskFactors
- 각 섹션은 마크다운 형식, 한글로 작성
- 데이터가 없는 섹션은 해당 사실을 명시 (예: "실적 데이터 미확인")`;

export interface AnalysisReport {
  investmentSummary: string;
  technicalAnalysis: string;
  fundamentalTrend: string;
  valuationAnalysis: string;
  sectorPositioning: string;
  marketContext: string;
  riskFactors: string;
}

// ---------------------------------------------------------------------------
// 프롬프트 조립
// ---------------------------------------------------------------------------

function buildUserPrompt(symbol: string, companyName: string | null, inputs: AnalysisInputs): string {
  const displayName = companyName != null ? `${companyName} (${symbol})` : symbol;
  const sections: string[] = [`종목: ${displayName}\n`];

  // 기술적 데이터
  const t = inputs.technical;
  if (Object.values(t).some((v) => v != null)) {
    sections.push(`<technical_data>
Phase: ${t.phase ?? "미확인"}
RS 스코어: ${t.rsScore ?? "미확인"}
MA150 기울기: ${t.ma150Slope ?? "미확인"}
거래량 비율: ${t.volRatio ?? "미확인"}
52주 고점 대비: ${t.pctFromHigh52w != null ? `${t.pctFromHigh52w}%` : "미확인"}
52주 저점 대비: ${t.pctFromLow52w != null ? `${t.pctFromLow52w}%` : "미확인"}
충족 조건: ${t.conditionsMet ?? "미확인"}
거래량 확인: ${t.volumeConfirmed != null ? (t.volumeConfirmed ? "확인됨" : "미확인") : "미확인"}
</technical_data>`);
  }

  // 섹터·업종 컨텍스트
  const s = inputs.sectorContext;
  sections.push(`<sector_context>
섹터: ${s.sector ?? "미확인"}
업종: ${s.industry ?? "미확인"}
섹터 RS: ${s.sectorRs ?? "미확인"}
섹터 그룹 Phase: ${s.sectorGroupPhase ?? "미확인"}
섹터 RS 4주 변화: ${s.sectorChange4w ?? "미확인"}
섹터 RS 8주 변화: ${s.sectorChange8w ?? "미확인"}
업종 RS: ${s.industryRs ?? "미확인"}
업종 그룹 Phase: ${s.industryGroupPhase ?? "미확인"}
</sector_context>`);

  // 4분기 실적
  if (inputs.financials.length > 0) {
    const rows = inputs.financials
      .map((q) =>
        `  - ${q.periodEndDate}: 매출 ${fmt(q.revenue)}, 순이익 ${fmt(q.netIncome)}, EPS ${q.epsDiluted ?? "N/A"}, EBITDA ${fmt(q.ebitda)}, FCF ${fmt(q.freeCashFlow)}, 매출총이익 ${fmt(q.grossProfit)}`,
      )
      .join("\n");
    sections.push(`<quarterly_financials>
${rows}
</quarterly_financials>`);
  } else {
    sections.push(`<quarterly_financials>
실적 데이터 없음
</quarterly_financials>`);
  }

  // 밸류에이션
  if (inputs.ratios != null) {
    const r = inputs.ratios;
    sections.push(`<valuation_ratios>
P/E: ${r.peRatio ?? "N/A"}
P/S: ${r.psRatio ?? "N/A"}
P/B: ${r.pbRatio ?? "N/A"}
EV/EBITDA: ${r.evEbitda ?? "N/A"}
매출총이익률: ${r.grossMargin != null ? `${r.grossMargin}%` : "N/A"}
영업이익률: ${r.opMargin != null ? `${r.opMargin}%` : "N/A"}
순이익률: ${r.netMargin != null ? `${r.netMargin}%` : "N/A"}
부채비율: ${r.debtEquity ?? "N/A"}
</valuation_ratios>`);
  } else {
    sections.push(`<valuation_ratios>
밸류에이션 데이터 없음
</valuation_ratios>`);
  }

  // 시장 레짐
  if (inputs.marketRegime != null) {
    const m = inputs.marketRegime;
    sections.push(`<market_regime>
레짐: ${m.regime}
신뢰도: ${m.confidence}
근거: ${m.rationale}
</market_regime>`);
  } else {
    sections.push(`<market_regime>
시장 레짐 데이터 없음
</market_regime>`);
  }

  // 토론 synthesis
  if (inputs.debateSynthesis != null) {
    sections.push(`<debate_synthesis>
${inputs.debateSynthesis}
</debate_synthesis>`);
  } else {
    sections.push(`<debate_synthesis>
최근 7일 내 토론 데이터 없음
</debate_synthesis>`);
  }

  sections.push(`
위 데이터를 기반으로 아래 7개 섹션으로 구성된 종목 분석 리포트를 JSON 형식으로 작성하세요.
데이터가 없는 섹션은 해당 사실을 명시하세요.

JSON 필드:
- investmentSummary: 핵심 투자 포인트 요약 (3~5개 bullet point)
- technicalAnalysis: 기술적 분석 (Phase, RS, 이동평균, 거래량)
- fundamentalTrend: 4분기 실적 트렌드 (매출/이익 성장률, 가속 여부)
- valuationAnalysis: 밸류에이션 멀티플 분석 및 업종 대비 평가
- sectorPositioning: 섹터·업종 내 포지셔닝 (RS 순위, Group Phase)
- marketContext: 현재 시장 레짐 및 토론 synthesis 요약
- riskFactors: 핵심 리스크 및 모니터링 포인트 (3~5개)`);

  return sections.join("\n\n");
}

/**
 * 숫자 값을 백만 단위로 포맷한다.
 */
function fmt(value: number | null): string {
  if (value == null) return "N/A";
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (abs >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  return `$${value.toFixed(0)}`;
}

// ---------------------------------------------------------------------------
// JSON 파싱
// ---------------------------------------------------------------------------

/**
 * LLM 응답 텍스트에서 JSON 객체를 안전하게 추출한다.
 * 코드 펜스 및 앞뒤 비-JSON 텍스트를 제거한다.
 */
function extractJson(text: string): string {
  let cleaned = text
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();

  const start = cleaned.indexOf("{");
  if (start === -1) return cleaned;

  // 중첩 괄호를 고려하여 매칭 닫기 괄호 탐색
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        cleaned = cleaned.slice(start, i + 1);
        break;
      }
    }
  }

  return cleaned;
}

const REQUIRED_REPORT_FIELDS: ReadonlyArray<keyof AnalysisReport> = [
  "investmentSummary",
  "technicalAnalysis",
  "fundamentalTrend",
  "valuationAnalysis",
  "sectorPositioning",
  "marketContext",
  "riskFactors",
];

function isValidReport(parsed: unknown): parsed is AnalysisReport {
  if (parsed == null || typeof parsed !== "object") return false;
  return REQUIRED_REPORT_FIELDS.every(
    (field) => typeof (parsed as Record<string, unknown>)[field] === "string",
  );
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * 종목 분석 리포트를 LLM으로 생성한다.
 *
 * @returns report + 토큰 사용량
 * @throws JSON 파싱 실패 또는 필드 누락 시 에러
 */
export async function generateAnalysisReport(
  symbol: string,
  companyName: string | null,
  inputs: AnalysisInputs,
): Promise<{ report: AnalysisReport; tokensInput: number; tokensOutput: number }> {
  const userPrompt = buildUserPrompt(symbol, companyName, inputs);

  logger.info("CorporateAnalyst", `${symbol} 리포트 생성 시작`);

  const response = await callWithRetry(() =>
    CLIENT.messages.create({
      model: CORPORATE_ANALYST_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  );

  const tokensInput = response.usage.input_tokens;
  const tokensOutput = response.usage.output_tokens;

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock?.type === "text" ? textBlock.text : "";

  const jsonText = extractJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    logger.error(
      "CorporateAnalyst",
      `${symbol} JSON 파싱 실패. 원문 앞 200자: ${raw.slice(0, 200)}`,
    );
    throw new Error(`CorporateAnalyst: JSON 파싱 실패 (${symbol})`);
  }

  if (!isValidReport(parsed)) {
    logger.error(
      "CorporateAnalyst",
      `${symbol} 리포트 필드 누락. 파싱 결과: ${JSON.stringify(parsed).slice(0, 200)}`,
    );
    throw new Error(`CorporateAnalyst: 리포트 필드 누락 (${symbol})`);
  }

  logger.info(
    "CorporateAnalyst",
    `${symbol} 리포트 생성 완료 (input: ${tokensInput}, output: ${tokensOutput})`,
  );

  return { report: parsed, tokensInput, tokensOutput };
}

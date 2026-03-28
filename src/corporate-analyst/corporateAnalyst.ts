/**
 * 기업 애널리스트 에이전트 코어.
 *
 * 분석 입력 데이터를 받아 단일 Claude API 호출로 7개 섹션으로 구성된
 * 종목 심층 분석 리포트를 생성한다.
 * reviewAgent.ts의 단일 LLM 호출 패턴을 따른다.
 */
import { getAnthropicClient } from "@/lib/anthropic-client";
import { callWithRetry } from "@/debate/callAgent.js";
import { logger } from "@/lib/logger.js";
import type { AnalysisInputs } from "./loadAnalysisInputs.js";
import { computePriceTarget, type PriceTargetResult, type CompanyMetrics, type PeerMultiples } from "./pricingModel.js";
import { CLAUDE_SONNET } from "@/lib/models.js";

export const CORPORATE_ANALYST_MODEL = CLAUDE_SONNET;
const MAX_TOKENS = 4_096;

const SYSTEM_PROMPT = `당신은 15년 경력의 미국 주식 전문 기업 애널리스트입니다. 제공된 데이터만을 기반으로 Seeking Alpha 수준의 종목 분석 리포트를 작성합니다. 데이터에 없는 내용은 절대 작성하지 않습니다. 추측이나 가정을 하지 않습니다.

출력 형식:
- 순수 JSON 객체만 출력 (코드 펜스 없이)
- 필수 7개 필드: investmentSummary, technicalAnalysis, fundamentalTrend, valuationAnalysis, sectorPositioning, marketContext, riskFactors
- 선택 1개 필드: earningsCallHighlights (earnings_call 데이터가 있을 때만 포함)
- 각 섹션은 마크다운 형식, 한글로 작성. 불릿은 반드시 "- " (하이픈+공백) 사용. "•" 유니코드 불릿 사용 금지
- 데이터가 없는 섹션은 해당 사실을 명시 (예: "실적 데이터 미확인")

섹션별 작성 지침:
- valuationAnalysis: peer_valuation 데이터가 있으면 피어 대비 할인/프리미엄 포지션을 구체적 수치로 명시
- fundamentalTrend: forward_estimates 데이터가 있으면 포워드 EPS 방향성과 서프라이즈 트랙 레코드를 포함
- earningsCallHighlights: earnings_call 데이터가 있을 때만 이 필드를 JSON에 포함 — 경영진 핵심 발언, 가이던스 변화, 톤 분석 포함
- priceTargetAnalysis: price_target_model 데이터를 기반으로 작성. 적정가 산출 근거(어떤 멀티플, 피어 몇 개), 상승여력 해석, 월가 컨센서스와의 비교, 모델의 한계(데이터 부재·가정)를 명시. 데이터 불충분 시 "정량 모델 산출 불가 — [이유]" 형식. valuationAnalysis와 내용 중복 최소화.
- investmentSummary / riskFactors: recent_news 데이터가 있으면 최근 뉴스에서 드러나는 촉매, 이벤트, 리스크를 반영
- riskFactors: upcoming_earnings 데이터가 있으면 임박한 실적 발표 일정과 컨센서스를 리스크 요인에 명시`;

export interface AnalysisReport {
  investmentSummary: string;
  technicalAnalysis: string;
  fundamentalTrend: string;
  valuationAnalysis: string;
  sectorPositioning: string;
  marketContext: string;
  riskFactors: string;
  /** 어닝콜 데이터가 있을 때만 생성되는 선택적 섹션 */
  earningsCallHighlights?: string;
  /** Phase C: 정량 모델 기반 목표주가 해석 (currentPrice + peerGroup이 있을 때만 생성) */
  priceTargetAnalysis?: string;
}

// ---------------------------------------------------------------------------
// 프롬프트 조립
// ---------------------------------------------------------------------------

function buildUserPrompt(
  symbol: string,
  companyName: string | null,
  inputs: AnalysisInputs,
  priceTargetResult: PriceTargetResult | null,
): string {
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

  // 기업 프로필 (Phase B)
  if (inputs.companyProfile != null) {
    const p = inputs.companyProfile;
    const marketCapFormatted = p.marketCap != null ? fmt(p.marketCap) : "N/A";
    sections.push(`<company_profile>
사업 설명: ${p.description ?? "미확인"}
CEO: ${p.ceo ?? "미확인"}
직원수: ${p.employees != null ? p.employees.toLocaleString() : "미확인"}
시가총액: ${marketCapFormatted}
상장소: ${p.exchange ?? "미확인"}
국가: ${p.country ?? "미확인"}
IPO일: ${p.ipoDate ?? "미확인"}
웹사이트: ${p.website ?? "미확인"}
</company_profile>`);
  }

  // 연간 재무 트렌드 (Phase B)
  if (inputs.annualFinancials != null && inputs.annualFinancials.length > 0) {
    const rows = inputs.annualFinancials
      .map((y) =>
        `  - ${y.fiscalYear}: 매출 ${fmt(y.revenue)}, 순이익 ${fmt(y.netIncome)}, EPS ${y.epsDiluted ?? "N/A"}, 영업이익 ${fmt(y.operatingIncome)}, FCF ${fmt(y.freeCashFlow)}`,
      )
      .join("\n");
    sections.push(`<annual_trend>
${rows}
</annual_trend>`);
  }

  // 어닝콜 트랜스크립트 (Phase B)
  if (inputs.earningsTranscript != null && inputs.earningsTranscript.transcript != null) {
    const ec = inputs.earningsTranscript;
    sections.push(`<earnings_call>
분기: ${ec.year}Q${ec.quarter}${ec.date != null ? ` (${ec.date})` : ""}
트랜스크립트:
${ec.transcript}
</earnings_call>`);
  }

  // 포워드 추정치 + EPS 서프라이즈 (Phase B)
  if (inputs.analystEstimates != null && inputs.analystEstimates.length > 0) {
    const estimateRows = inputs.analystEstimates
      .map((e) =>
        `  - ${e.period}: EPS 추정 ${e.estimatedEpsAvg ?? "N/A"} (범위 ${e.estimatedEpsLow ?? "N/A"}~${e.estimatedEpsHigh ?? "N/A"}), 매출 추정 ${e.estimatedRevenueAvg != null ? fmt(e.estimatedRevenueAvg) : "N/A"}, 애널리스트 ${e.numberAnalysts ?? "N/A"}명`,
      )
      .join("\n");

    let surpriseRows = "";
    if (inputs.epsSurprises != null && inputs.epsSurprises.length > 0) {
      surpriseRows =
        "\nEPS 서프라이즈 히스토리:\n" +
        inputs.epsSurprises
          .map((s) => {
            const surprise = buildSurpriseLine(s.actualEps, s.estimatedEps);
            return `  - ${s.actualDate}: 실제 ${s.actualEps ?? "N/A"} vs 추정 ${s.estimatedEps ?? "N/A"}${surprise}`;
          })
          .join("\n");
    }

    sections.push(`<forward_estimates>
컨센서스 EPS/매출 추정치:
${estimateRows}${surpriseRows}
</forward_estimates>`);
  }

  // 피어 밸류에이션 비교 (Phase B)
  if (inputs.peerGroup != null && inputs.peerGroup.length > 0) {
    const peerRows = inputs.peerGroup
      .map((peer) =>
        `  - ${peer.symbol}: P/E ${peer.peRatio ?? "N/A"}, EV/EBITDA ${peer.evEbitda ?? "N/A"}, P/S ${peer.psRatio ?? "N/A"}`,
      )
      .join("\n");
    sections.push(`<peer_valuation>
동종업계 피어 밸류에이션 (최신 분기 기준):
${peerRows}
</peer_valuation>`);
  }

  // 가격 목표 컨센서스 (Phase B)
  if (inputs.priceTargetConsensus != null) {
    const pt = inputs.priceTargetConsensus;
    sections.push(`<price_targets>
월가 목표가 컨센서스:
  High: ${pt.targetHigh ?? "N/A"}
  Low: ${pt.targetLow ?? "N/A"}
  Mean: ${pt.targetMean ?? "N/A"}
  Median: ${pt.targetMedian ?? "N/A"}
</price_targets>`);
  }

  // 최근 뉴스 (stock_news)
  if (inputs.recentNews != null && inputs.recentNews.length > 0) {
    const newsLines = inputs.recentNews
      .map((n) => `- ${escapeXml(n.title)} (${n.site != null ? escapeXml(n.site) : "출처 미확인"}, ${n.publishedDate})`)
      .join("\n");
    sections.push(`<recent_news>
${newsLines}
</recent_news>`);
  }

  // 임박 실적 발표 (earning_calendar)
  if (inputs.upcomingEarnings != null && inputs.upcomingEarnings.length > 0) {
    const earningsLines = inputs.upcomingEarnings
      .map((e) => {
        const time = e.time != null ? escapeXml(e.time) : "시간 미확인";
        const eps = e.epsEstimated != null ? String(e.epsEstimated) : "N/A";
        const rev = e.revenueEstimated != null ? fmt(e.revenueEstimated) : "N/A";
        return `- ${e.date} (${time}) | EPS est: ${eps} | Rev est: ${rev}`;
      })
      .join("\n");
    sections.push(`<upcoming_earnings>
${earningsLines}
</upcoming_earnings>`);
  }

  // 정량 모델 결과 (Phase C)
  if (priceTargetResult != null) {
    sections.push(`<price_target_model>
정량 모델 산출 결과 (멀티플 기반):
${JSON.stringify(priceTargetResult, null, 2)}
</price_target_model>`);
  }

  const hasEarningsCall =
    inputs.earningsTranscript != null && inputs.earningsTranscript.transcript != null;
  const hasPriceTargetModel = priceTargetResult != null;

  sections.push(`
위 데이터를 기반으로 종목 분석 리포트를 JSON 형식으로 작성하세요.
데이터가 없는 섹션은 해당 사실을 명시하세요.

필수 JSON 필드 (7개):
- investmentSummary: 핵심 투자 포인트 요약 (3~5개 bullet point)
- technicalAnalysis: 기술적 분석 (Phase, RS, 이동평균, 거래량)
- fundamentalTrend: 4분기 실적 트렌드 (매출/이익 성장률, 가속 여부)${inputs.analystEstimates != null ? " + 포워드 EPS 방향성 + 서프라이즈 트랙 레코드 포함" : ""}
- valuationAnalysis: 밸류에이션 멀티플 분석${inputs.peerGroup != null ? " + 피어 대비 할인/프리미엄 포지션을 구체적 수치로 명시" : ""}${inputs.priceTargetConsensus != null ? " + 월가 목표가 괴리율 포함" : ""}
- sectorPositioning: 섹터·업종 내 포지셔닝 (RS 순위, Group Phase)
- marketContext: 현재 시장 레짐 및 토론 synthesis 요약
- riskFactors: 핵심 리스크 및 모니터링 포인트 (3~5개)
${hasEarningsCall ? "\n선택 JSON 필드 (반드시 포함):\n- earningsCallHighlights: 어닝콜 핵심 발언 + 가이던스 변화 + 톤 분석 (경영진이 강조한 성장 동력, 리스크, 향후 전망 포함)" : ""}${hasPriceTargetModel ? "\n선택 JSON 필드 (반드시 포함):\n- priceTargetAnalysis: 정량 모델 결과 해석 — 적정가 산출 근거(피어 멀티플, 가중치), 상승여력 의미, 월가 컨센서스 비교, 한계점 명시. valuationAnalysis와 중복 최소화." : ""}`);

  return sections.join("\n\n");
}

/**
 * financials 배열에서 특정 필드의 TTM(Trailing Twelve Months) 합산값을 계산한다.
 * 4분기 미만이면 부분 TTM으로 목표가가 왜곡되므로 null을 반환한다.
 */
function computeTtmSum(
  financials: AnalysisInputs['financials'],
  field: 'epsDiluted' | 'ebitda' | 'revenue',
): number | null {
  const REQUIRED_QUARTERS = 4;
  const quarters = financials.slice(0, REQUIRED_QUARTERS);
  if (quarters.length < REQUIRED_QUARTERS) return null;
  const values = quarters.map((q) => q[field]);
  if (values.every((v) => v == null)) return null;
  return values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
}

/**
 * AnalysisInputs에서 PriceTargetResult를 산출한다.
 * currentPrice가 null이면 null을 반환한다.
 */
function computePriceTargetFromInputs(inputs: AnalysisInputs): PriceTargetResult | null {
  if (inputs.currentPrice == null) return null;

  const companyMetrics: CompanyMetrics = {
    currentPrice: inputs.currentPrice,
    ttmEps: computeTtmSum(inputs.financials, 'epsDiluted'),
    ttmEbitda: computeTtmSum(inputs.financials, 'ebitda'),
    ttmRevenue: computeTtmSum(inputs.financials, 'revenue'),
    marketCap: inputs.companyProfile?.marketCap ?? null,
    sharesOutstanding: null,
  };

  const peerMultiples: PeerMultiples[] = (inputs.peerGroup ?? []).map((p) => ({
    symbol: p.symbol,
    peRatio: p.peRatio,
    evEbitda: p.evEbitda,
    psRatio: p.psRatio,
  }));

  return computePriceTarget(companyMetrics, peerMultiples, inputs.priceTargetConsensus);
}

/**
 * actualEps와 estimatedEps를 받아 서프라이즈 방향을 텍스트로 반환한다.
 */
function buildSurpriseLine(actualEps: number | null, estimatedEps: number | null): string {
  if (actualEps == null || estimatedEps == null || estimatedEps === 0) return "";
  const surprise = ((actualEps - estimatedEps) / Math.abs(estimatedEps)) * 100;
  const direction = surprise > 0 ? "Beat" : "Miss";
  return ` (${direction} ${Math.abs(surprise).toFixed(1)}%)`;
}

/**
 * XML 특수문자를 이스케이프한다.
 * 외부 데이터를 XML 태그 내에 삽입할 때 태그 구조가 깨지지 않도록 방지한다.
 */
function escapeXml(s: string): string {
  return s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
  const obj = parsed as Record<string, unknown>;
  const hasRequiredFields = REQUIRED_REPORT_FIELDS.every(
    (field) => typeof obj[field] === "string",
  );
  if (!hasRequiredFields) return false;
  // earningsCallHighlights는 선택적 — 존재하면 string이어야 한다
  if ("earningsCallHighlights" in obj && typeof obj["earningsCallHighlights"] !== "string") {
    return false;
  }
  // priceTargetAnalysis는 선택적 — 존재하면 string이어야 한다
  if ("priceTargetAnalysis" in obj && typeof obj["priceTargetAnalysis"] !== "string") {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * 종목 분석 리포트를 LLM으로 생성한다.
 *
 * @returns report + 토큰 사용량 + 정량 모델 결과
 * @throws JSON 파싱 실패 또는 필드 누락 시 에러
 */
export async function generateAnalysisReport(
  symbol: string,
  companyName: string | null,
  inputs: AnalysisInputs,
): Promise<{ report: AnalysisReport; tokensInput: number; tokensOutput: number; priceTargetResult: PriceTargetResult | null }> {
  const priceTargetResult = computePriceTargetFromInputs(inputs);
  const userPrompt = buildUserPrompt(symbol, companyName, inputs, priceTargetResult);

  logger.info("CorporateAnalyst", `${symbol} 리포트 생성 시작`);

  const response = await callWithRetry(() =>
    getAnthropicClient().messages.create({
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

  return { report: parsed, tokensInput, tokensOutput, priceTargetResult };
}

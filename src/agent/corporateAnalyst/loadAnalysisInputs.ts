/**
 * 기업 애널리스트 에이전트를 위한 종목별 분석 입력 데이터 로더.
 *
 * 6개 데이터 소스(기술적 팩터, 섹터 RS, 4분기 실적, 밸류에이션, 시장 레짐, 토론 synthesis)를
 * Promise.all로 병렬 조회하여 LLM 프롬프트에 주입할 구조화 데이터를 반환한다.
 *
 * 데이터 부재 시 graceful degradation: null 필드를 그대로 반환하고
 * 상위 레이어(corporateAnalyst)에서 섹션별 fallback 텍스트를 생성한다.
 */
import type { Pool } from "pg";
import { logger } from "@/agent/logger.js";

/** 최근 토론 synthesis를 사용하는 최대 일수 */
const DEBATE_LOOKBACK_DAYS = 7;

/** 토큰 초과 방지를 위한 debateSynthesis 최대 글자 수 */
const MAX_SYNTHESIS_CHARS = 2_000;

/** 조회할 최근 분기 실적 수 */
const FINANCIALS_QUARTERS = 4;

export interface AnalysisInputs {
  /** 기술적 데이터 (recommendation_factors) */
  technical: {
    rsScore: number | null;
    phase: number | null;
    ma150Slope: number | null;
    volRatio: number | null;
    pctFromHigh52w: number | null;
    pctFromLow52w: number | null;
    conditionsMet: string | null;
    volumeConfirmed: boolean | null;
  };

  /** 섹터·업종 RS (sector_rs_daily + industry_rs_daily) */
  sectorContext: {
    sector: string | null;
    industry: string | null;
    sectorRs: number | null;
    sectorGroupPhase: number | null;
    industryRs: number | null;
    industryGroupPhase: number | null;
    sectorChange4w: number | null;
    sectorChange8w: number | null;
  };

  /** 4분기 실적 (quarterly_financials, 최근 4행) */
  financials: Array<{
    periodEndDate: string;
    revenue: number | null;
    netIncome: number | null;
    epsDiluted: number | null;
    ebitda: number | null;
    freeCashFlow: number | null;
    grossProfit: number | null;
  }>;

  /** 밸류에이션 멀티플 (quarterly_ratios, 최근 1행) */
  ratios: {
    peRatio: number | null;
    psRatio: number | null;
    pbRatio: number | null;
    evEbitda: number | null;
    grossMargin: number | null;
    opMargin: number | null;
    netMargin: number | null;
    debtEquity: number | null;
  } | null;

  /** 시장 레짐 (market_regimes, 추천일 기준 최신 confirmed) */
  marketRegime: {
    regime: string;
    rationale: string;
    confidence: string;
  } | null;

  /** 토론 synthesis (debate_sessions, 최근 7일 이내, 2000자 truncate) */
  debateSynthesis: string | null;

  /** 종목 기본 정보 (symbols 테이블) */
  companyName: string | null;
  sector: string | null;
  industry: string | null;
}

// ---------------------------------------------------------------------------
// 내부 DB 행 타입
// ---------------------------------------------------------------------------

interface RecommendationFactorsRow {
  rs_score: number | null;
  phase: number | null;
  ma150_slope: string | null;
  vol_ratio: string | null;
  pct_from_high_52w: string | null;
  pct_from_low_52w: string | null;
  conditions_met: string | null;
  volume_confirmed: boolean | null;
  sector_rs: string | null;
  sector_group_phase: number | null;
  industry_rs: string | null;
  industry_group_phase: number | null;
}

interface SymbolRow {
  name: string | null;
  sector: string | null;
  industry: string | null;
}

interface SectorRsRow {
  avg_rs: string | null;
  group_phase: number | null;
  change_4w: string | null;
  change_8w: string | null;
}

interface IndustryRsRow {
  avg_rs: string | null;
  group_phase: number | null;
}

interface FinancialsRow {
  period_end_date: string;
  revenue: string | null;
  net_income: string | null;
  eps_diluted: string | null;
  ebitda: string | null;
  free_cash_flow: string | null;
  gross_profit: string | null;
}

interface RatiosRow {
  pe_ratio: string | null;
  ps_ratio: string | null;
  pb_ratio: string | null;
  enterprise_value_over_ebitda: string | null;
  gross_profit_margin: string | null;
  operating_profit_margin: string | null;
  net_profit_margin: string | null;
  debt_equity_ratio: string | null;
}

interface MarketRegimeRow {
  regime: string;
  rationale: string;
  confidence: string;
}

interface DebateSessionRow {
  synthesis_report: string;
}

// ---------------------------------------------------------------------------
// 개별 쿼리 함수 (에러 시 null 반환하는 safe wrapper)
// ---------------------------------------------------------------------------

/**
 * unknown 값을 number로 변환한다.
 * 변환 실패 또는 null/undefined 입력 시 null을 반환한다.
 * toNum()과 달리 유효한 값 0을 null로 손실하지 않는다.
 */
function toNumOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function safeQuery<T>(
  fn: () => Promise<{ rows: T[] }>,
  context: string,
): Promise<T[] | null> {
  try {
    const result = await fn();
    return result.rows;
  } catch (err) {
    logger.warn("loadAnalysisInputs", `쿼리 실패 (${context}): ${String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 공개 API
// ---------------------------------------------------------------------------

/**
 * 종목별 분석 입력 데이터를 병렬로 수집한다.
 *
 * 각 쿼리는 독립적으로 실행되며, 실패 또는 데이터 부재 시 해당 필드는 null로 반환된다.
 * 상위 레이어에서 null 필드에 대한 fallback 텍스트를 생성해야 한다.
 */
export async function loadAnalysisInputs(
  symbol: string,
  recommendationDate: string,
  pool: Pool,
): Promise<AnalysisInputs> {
  const debateCutoff = getDateOffset(recommendationDate, DEBATE_LOOKBACK_DAYS);

  // Phase 1: 심볼 독립 쿼리 병렬 실행 (6개)
  const [
    factorsRows,
    symbolRows,
    financialsRows,
    ratiosRows,
    regimeRows,
    debateRows,
  ] = await Promise.all([
    safeQuery<RecommendationFactorsRow>(
      () =>
        pool.query(
          `SELECT rs_score, phase, ma150_slope, vol_ratio,
                  pct_from_high_52w, pct_from_low_52w, conditions_met, volume_confirmed,
                  sector_rs, sector_group_phase, industry_rs, industry_group_phase
           FROM recommendation_factors
           WHERE symbol = $1 AND recommendation_date = $2
           LIMIT 1`,
          [symbol, recommendationDate],
        ),
      "recommendation_factors",
    ),
    safeQuery<SymbolRow>(
      () =>
        pool.query(
          `SELECT name, sector, industry FROM symbols WHERE symbol = $1 LIMIT 1`,
          [symbol],
        ),
      "symbols",
    ),
    safeQuery<FinancialsRow>(
      () =>
        pool.query(
          `SELECT period_end_date, revenue, net_income, eps_diluted,
                  ebitda, free_cash_flow, gross_profit
           FROM quarterly_financials
           WHERE symbol = $1
           ORDER BY period_end_date DESC
           LIMIT $2`,
          [symbol, FINANCIALS_QUARTERS],
        ),
      "quarterly_financials",
    ),
    safeQuery<RatiosRow>(
      () =>
        pool.query(
          `SELECT pe_ratio, ps_ratio, pb_ratio, enterprise_value_over_ebitda,
                  gross_profit_margin, operating_profit_margin, net_profit_margin, debt_equity_ratio
           FROM quarterly_ratios
           WHERE symbol = $1
           ORDER BY period_end_date DESC
           LIMIT 1`,
          [symbol],
        ),
      "quarterly_ratios",
    ),
    safeQuery<MarketRegimeRow>(
      () =>
        pool.query(
          `SELECT regime, rationale, confidence
           FROM market_regimes
           WHERE is_confirmed = true
             AND regime_date <= $1
           ORDER BY regime_date DESC
           LIMIT 1`,
          [recommendationDate],
        ),
      "market_regimes",
    ),
    safeQuery<DebateSessionRow>(
      () =>
        pool.query(
          `SELECT synthesis_report
           FROM debate_sessions
           WHERE date >= $1 AND date <= $2
           ORDER BY date DESC
           LIMIT 1`,
          [debateCutoff, recommendationDate],
        ),
      "debate_sessions",
    ),
  ]);

  // 기본 종목 정보 추출
  const symbolRow = symbolRows != null && symbolRows.length > 0 ? symbolRows[0] : null;
  const companyName = symbolRow?.name ?? null;
  const sector = symbolRow?.sector ?? null;
  const industry = symbolRow?.industry ?? null;

  // Phase 2: 섹터·업종 RS — symbolRow 의존이므로 직렬 처리
  let sectorRow: SectorRsRow | null = null;
  let industryRow: IndustryRsRow | null = null;

  if (sector != null || industry != null) {
    const [sectorRows, industryRowsResult] = await Promise.all([
      sector != null
        ? safeQuery<SectorRsRow>(
            () =>
              pool.query(
                `SELECT avg_rs, group_phase, change_4w, change_8w
                 FROM sector_rs_daily
                 WHERE sector = $1 AND date = $2
                 LIMIT 1`,
                [sector, recommendationDate],
              ),
            "sector_rs_daily",
          )
        : Promise.resolve(null),
      industry != null
        ? safeQuery<IndustryRsRow>(
            () =>
              pool.query(
                `SELECT avg_rs, group_phase
                 FROM industry_rs_daily
                 WHERE industry = $1 AND date = $2
                 LIMIT 1`,
                [industry, recommendationDate],
              ),
            "industry_rs_daily",
          )
        : Promise.resolve(null),
    ]);

    sectorRow = sectorRows != null && sectorRows.length > 0 ? sectorRows[0] : null;
    industryRow = industryRowsResult != null && industryRowsResult.length > 0 ? industryRowsResult[0] : null;
  }

  const factorsRow =
    factorsRows != null && factorsRows.length > 0 ? factorsRows[0] : null;

  // financials 조합
  const financials =
    financialsRows != null
      ? financialsRows.map((row) => ({
          periodEndDate: row.period_end_date,
          revenue: toNumOrNull(row.revenue),
          netIncome: toNumOrNull(row.net_income),
          epsDiluted: toNumOrNull(row.eps_diluted),
          ebitda: toNumOrNull(row.ebitda),
          freeCashFlow: toNumOrNull(row.free_cash_flow),
          grossProfit: toNumOrNull(row.gross_profit),
        }))
      : [];

  // ratios 조합: ratiosRows가 null이거나 비어있으면 null
  const rawRatiosRow =
    ratiosRows != null && ratiosRows.length > 0 ? ratiosRows[0] : null;

  const ratios =
    rawRatiosRow == null
      ? null
      : {
          peRatio: toNumOrNull(rawRatiosRow.pe_ratio),
          psRatio: toNumOrNull(rawRatiosRow.ps_ratio),
          pbRatio: toNumOrNull(rawRatiosRow.pb_ratio),
          evEbitda: toNumOrNull(rawRatiosRow.enterprise_value_over_ebitda),
          grossMargin: toNumOrNull(rawRatiosRow.gross_profit_margin),
          opMargin: toNumOrNull(rawRatiosRow.operating_profit_margin),
          netMargin: toNumOrNull(rawRatiosRow.net_profit_margin),
          debtEquity: toNumOrNull(rawRatiosRow.debt_equity_ratio),
        };

  // market regime 조합
  const rawRegimeRow =
    regimeRows != null && regimeRows.length > 0 ? regimeRows[0] : null;

  const marketRegime =
    rawRegimeRow == null
      ? null
      : {
          regime: rawRegimeRow.regime,
          rationale: rawRegimeRow.rationale,
          confidence: rawRegimeRow.confidence,
        };

  // debate synthesis 조합 (2000자 truncate)
  const rawSynthesisRow =
    debateRows != null && debateRows.length > 0 ? debateRows[0] : null;
  const rawSynthesis = rawSynthesisRow?.synthesis_report ?? null;

  const debateSynthesis =
    rawSynthesis == null
      ? null
      : rawSynthesis.length > MAX_SYNTHESIS_CHARS
        ? `${rawSynthesis.slice(0, MAX_SYNTHESIS_CHARS)}... (이하 생략)`
        : rawSynthesis;

  return {
    technical: {
      rsScore: factorsRow?.rs_score ?? null,
      phase: factorsRow?.phase ?? null,
      ma150Slope: toNumOrNull(factorsRow?.ma150_slope),
      volRatio: toNumOrNull(factorsRow?.vol_ratio),
      pctFromHigh52w: toNumOrNull(factorsRow?.pct_from_high_52w),
      pctFromLow52w: toNumOrNull(factorsRow?.pct_from_low_52w),
      conditionsMet: factorsRow?.conditions_met ?? null,
      volumeConfirmed: factorsRow?.volume_confirmed ?? null,
    },
    sectorContext: {
      sector,
      industry,
      sectorRs:
        sectorRow != null
          ? toNumOrNull(sectorRow.avg_rs)
          : toNumOrNull(factorsRow?.sector_rs),
      sectorGroupPhase: sectorRow?.group_phase ?? factorsRow?.sector_group_phase ?? null,
      industryRs:
        industryRow != null
          ? toNumOrNull(industryRow.avg_rs)
          : toNumOrNull(factorsRow?.industry_rs),
      industryGroupPhase:
        industryRow?.group_phase ?? factorsRow?.industry_group_phase ?? null,
      sectorChange4w: toNumOrNull(sectorRow?.change_4w),
      sectorChange8w: toNumOrNull(sectorRow?.change_8w),
    },
    financials,
    ratios,
    marketRegime,
    debateSynthesis,
    companyName,
    sector,
    industry,
  };
}

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

/**
 * date에서 days만큼 이전 날짜를 YYYY-MM-DD 형식으로 반환.
 */
function getDateOffset(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

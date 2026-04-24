/**
 * F10 테이블 (company_profiles, annual_financials, analyst_estimates 등) 조회 Repository.
 *
 * 설계 특이사항:
 * - loadAnalysisInputs의 safeQuery 패턴(graceful degradation)을 보존하기 위해
 *   pool을 직접 import하지 않고 함수 인자로 받는다.
 * - 각 메서드는 순수 쿼리만 수행한다. 에러 처리와 graceful degradation은 호출부가 담당한다.
 * - 재시도 로직은 호출부가 담당한다.
 */
import type { Pool } from "pg";
import type {
  CorporateRecommendationFactorsRow,
  CorporateSymbolRow,
  CorporateFinancialsRow,
  CorporateRatiosRow,
  CorporateMarketRegimeRow,
  CorporateDebateSessionRow,
  CorporateCompanyProfileRow,
  CorporateAnnualFinancialsRow,
  CorporateEarningCallTranscriptRow,
  CorporateAnalystEstimatesRow,
  CorporateEpsSurprisesRow,
  CorporatePeerGroupRow,
  CorporatePeerRatiosRow,
  CorporatePriceTargetConsensusRow,
  CorporateDailyPriceCloseRow,
  CorporateSectorRsRow,
  CorporateIndustryRsRow,
  CorporateAnalysisReportRow,
  CorporateActiveTrackedRow,
  CorporateStockNewsRow,
  CorporateEarningCalendarRow,
} from "./types.js";

// ---------------------------------------------------------------------------
// loadAnalysisInputs용 쿼리 (pool 인자 패턴)
// ---------------------------------------------------------------------------

export async function findRecommendationFactors(
  symbol: string,
  recommendationDate: string,
  pool: Pool,
): Promise<CorporateRecommendationFactorsRow[]> {
  const { rows } = await pool.query<CorporateRecommendationFactorsRow>(
    `SELECT rs_score, phase, ma150_slope, vol_ratio,
            pct_from_high_52w, pct_from_low_52w, conditions_met, volume_confirmed,
            sector_rs, sector_group_phase, industry_rs, industry_group_phase
     FROM recommendation_factors
     WHERE symbol = $1 AND recommendation_date = $2
     LIMIT 1`,
    [symbol, recommendationDate],
  );
  return rows;
}

export async function findSymbolInfo(
  symbol: string,
  pool: Pool,
): Promise<CorporateSymbolRow[]> {
  const { rows } = await pool.query<CorporateSymbolRow>(
    `SELECT s.company_name, s.sector, COALESCE(sio.industry, s.industry) AS industry
     FROM symbols s
     LEFT JOIN symbol_industry_overrides sio ON s.symbol = sio.symbol
     WHERE s.symbol = $1 LIMIT 1`,
    [symbol],
  );
  return rows;
}

export async function findQuarterlyFinancials(
  symbol: string,
  limit: number,
  pool: Pool,
): Promise<CorporateFinancialsRow[]> {
  const { rows } = await pool.query<CorporateFinancialsRow>(
    `SELECT period_end_date, revenue, net_income, eps_diluted,
            ebitda, free_cash_flow, gross_profit
     FROM quarterly_financials
     WHERE symbol = $1
     ORDER BY period_end_date DESC
     LIMIT $2`,
    [symbol, limit],
  );
  return rows;
}

export async function findQuarterlyRatios(
  symbol: string,
  pool: Pool,
): Promise<CorporateRatiosRow[]> {
  const { rows } = await pool.query<CorporateRatiosRow>(
    `SELECT pe_ratio, ps_ratio, pb_ratio, ev_ebitda,
            gross_margin, op_margin, net_margin, debt_equity
     FROM quarterly_ratios
     WHERE symbol = $1
     ORDER BY period_end_date DESC
     LIMIT 1`,
    [symbol],
  );
  return rows;
}

export async function findMarketRegimeByDate(
  recommendationDate: string,
  pool: Pool,
): Promise<CorporateMarketRegimeRow[]> {
  const { rows } = await pool.query<CorporateMarketRegimeRow>(
    `SELECT regime, rationale, confidence
     FROM market_regimes
     WHERE regime_date <= $1 AND is_confirmed = true
     ORDER BY regime_date DESC
     LIMIT 1`,
    [recommendationDate],
  );
  return rows;
}

export async function findDebateSessionByDateRange(
  debateCutoff: string,
  recommendationDate: string,
  pool: Pool,
): Promise<CorporateDebateSessionRow[]> {
  const { rows } = await pool.query<CorporateDebateSessionRow>(
    `SELECT synthesis_report
     FROM debate_sessions
     WHERE date >= $1 AND date <= $2
     ORDER BY date DESC
     LIMIT 1`,
    [debateCutoff, recommendationDate],
  );
  return rows;
}

export async function findCompanyProfile(
  symbol: string,
  pool: Pool,
): Promise<CorporateCompanyProfileRow[]> {
  const { rows } = await pool.query<CorporateCompanyProfileRow>(
    `SELECT description, ceo, employees, market_cap,
            website, country, exchange, ipo_date
     FROM company_profiles
     WHERE symbol = $1
     LIMIT 1`,
    [symbol],
  );
  return rows;
}

export async function findAnnualFinancials(
  symbol: string,
  limit: number,
  pool: Pool,
): Promise<CorporateAnnualFinancialsRow[]> {
  const { rows } = await pool.query<CorporateAnnualFinancialsRow>(
    `SELECT fiscal_year, revenue, net_income, eps_diluted,
            gross_profit, operating_income, ebitda, free_cash_flow
     FROM annual_financials
     WHERE symbol = $1
     ORDER BY fiscal_year DESC
     LIMIT $2`,
    [symbol, limit],
  );
  return rows;
}

export async function findEarningCallTranscript(
  symbol: string,
  pool: Pool,
): Promise<CorporateEarningCallTranscriptRow[]> {
  const { rows } = await pool.query<CorporateEarningCallTranscriptRow>(
    `SELECT quarter, year, date, transcript
     FROM earning_call_transcripts
     WHERE symbol = $1
     ORDER BY year DESC, quarter DESC
     LIMIT 1`,
    [symbol],
  );
  return rows;
}

export async function findAnalystEstimates(
  symbol: string,
  limit: number,
  pool: Pool,
): Promise<CorporateAnalystEstimatesRow[]> {
  const { rows } = await pool.query<CorporateAnalystEstimatesRow>(
    `SELECT period, estimated_eps_avg, estimated_eps_high, estimated_eps_low,
            estimated_revenue_avg, number_analyst_estimated_eps
     FROM analyst_estimates
     WHERE symbol = $1
     ORDER BY period DESC
     LIMIT $2`,
    [symbol, limit],
  );
  return rows;
}

export async function findEpsSurprises(
  symbol: string,
  limit: number,
  pool: Pool,
): Promise<CorporateEpsSurprisesRow[]> {
  const { rows } = await pool.query<CorporateEpsSurprisesRow>(
    `SELECT actual_date, actual_eps, estimated_eps
     FROM eps_surprises
     WHERE symbol = $1
     ORDER BY actual_date DESC
     LIMIT $2`,
    [symbol, limit],
  );
  return rows;
}

export async function findPeerGroup(
  symbol: string,
  pool: Pool,
): Promise<CorporatePeerGroupRow[]> {
  const { rows } = await pool.query<CorporatePeerGroupRow>(
    `SELECT peers
     FROM peer_groups
     WHERE symbol = $1
     LIMIT 1`,
    [symbol],
  );
  return rows;
}

export async function findPeerRatios(
  peerSymbols: string[],
  pool: Pool,
): Promise<CorporatePeerRatiosRow[]> {
  const { rows } = await pool.query<CorporatePeerRatiosRow>(
    `SELECT DISTINCT ON (symbol) symbol, pe_ratio, ev_ebitda, ps_ratio
     FROM quarterly_ratios
     WHERE symbol = ANY($1)
     ORDER BY symbol, period_end_date DESC`,
    [peerSymbols],
  );
  return rows;
}

export async function findPriceTargetConsensus(
  symbol: string,
  pool: Pool,
): Promise<CorporatePriceTargetConsensusRow[]> {
  const { rows } = await pool.query<CorporatePriceTargetConsensusRow>(
    `SELECT target_high, target_low, target_mean, target_median
     FROM price_target_consensus
     WHERE symbol = $1
     LIMIT 1`,
    [symbol],
  );
  return rows;
}

export async function findCurrentPrice(
  symbol: string,
  recommendationDate: string,
  pool: Pool,
): Promise<CorporateDailyPriceCloseRow[]> {
  const { rows } = await pool.query<CorporateDailyPriceCloseRow>(
    `SELECT close
     FROM daily_prices
     WHERE symbol = $1 AND date <= $2
     ORDER BY date DESC
     LIMIT 1`,
    [symbol, recommendationDate],
  );
  return rows;
}

export async function findSectorRsByDate(
  sector: string,
  date: string,
  pool: Pool,
): Promise<CorporateSectorRsRow[]> {
  const { rows } = await pool.query<CorporateSectorRsRow>(
    `SELECT avg_rs, group_phase, change_4w, change_8w
     FROM sector_rs_daily
     WHERE sector = $1 AND date = $2
     LIMIT 1`,
    [sector, date],
  );
  return rows;
}

export async function findIndustryRsByDate(
  industry: string,
  date: string,
  pool: Pool,
): Promise<CorporateIndustryRsRow[]> {
  const { rows } = await pool.query<CorporateIndustryRsRow>(
    `SELECT avg_rs, group_phase
     FROM industry_rs_daily
     WHERE industry = $1 AND date = $2
     LIMIT 1`,
    [industry, date],
  );
  return rows;
}

export async function findStockNews(
  symbol: string,
  limit: number,
  pool: Pool,
): Promise<CorporateStockNewsRow[]> {
  const { rows } = await pool.query<CorporateStockNewsRow>(
    `SELECT title, site, published_date
     FROM stock_news
     WHERE symbol = $1
     ORDER BY published_date DESC
     LIMIT $2`,
    [symbol, limit],
  );
  return rows;
}

export async function findUpcomingEarnings(
  symbol: string,
  baseDate: string,
  pool: Pool,
): Promise<CorporateEarningCalendarRow[]> {
  const { rows } = await pool.query<CorporateEarningCalendarRow>(
    `SELECT date, eps_estimated, revenue_estimated, time
     FROM earning_calendar
     WHERE symbol = $1
       AND date BETWEEN $2 AND ($2::date + INTERVAL '30 days')::date
     ORDER BY date ASC`,
    [symbol, baseDate],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// run-corporate-analyst.ts용 쿼리 (pool 인자 패턴)
// ---------------------------------------------------------------------------

/**
 * 단일 종목 ACTIVE 포트폴리오 포지션 조회.
 * 기업 분석 리포트는 portfolio_positions ACTIVE 종목 한정 (#987).
 */
export async function findActiveTrackedStockBySymbol(
  symbol: string,
  pool: Pool,
): Promise<CorporateActiveTrackedRow[]> {
  const { rows } = await pool.query<CorporateActiveTrackedRow>(
    `SELECT symbol, entry_date
     FROM portfolio_positions
     WHERE symbol = $1 AND status = 'ACTIVE'
     ORDER BY entry_date DESC
     LIMIT 1`,
    [symbol],
  );
  return rows;
}

/**
 * 후보 종목 중 이미 stock_analysis_reports가 존재하는 (symbol, recommendation_date) 쌍 조회.
 */
export async function findExistingAnalysisReports(
  candidates: Array<{ symbol: string; recommendation_date: string }>,
  pool: Pool,
): Promise<CorporateAnalysisReportRow[]> {
  if (candidates.length === 0) {
    return [];
  }

  const valuePlaceholders = candidates
    .map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2})`)
    .join(", ");
  const params = candidates.flatMap((c) => [c.symbol, c.recommendation_date]);

  const { rows } = await pool.query<CorporateAnalysisReportRow>(
    `SELECT symbol, recommendation_date
     FROM stock_analysis_reports
     WHERE (symbol, recommendation_date) IN (${valuePlaceholders})`,
    params,
  );

  return rows;
}

/**
 * 심층 분석 리포트를 stock_analysis_reports에 UPSERT한다.
 */
export async function upsertStockAnalysisReport(
  params: {
    symbol: string;
    recommendationDate: string;
    investmentSummary: string | null;
    technicalAnalysis: string | null;
    fundamentalTrend: string | null;
    valuationAnalysis: string | null;
    sectorPositioning: string | null;
    marketContext: string | null;
    riskFactors: string | null;
    earningsCallHighlights: string | null;
    priceTarget: number | null;
    priceTargetUpside: number | null;
    priceTargetData: string | null;
    priceTargetAnalysis: string | null;
    modelUsed: string;
    tokensInput: number;
    tokensOutput: number;
  },
  pool: Pool,
): Promise<void> {
  await pool.query(
    `INSERT INTO stock_analysis_reports (
      symbol, recommendation_date,
      investment_summary, technical_analysis, fundamental_trend,
      valuation_analysis, sector_positioning, market_context, risk_factors,
      earnings_call_highlights,
      price_target, price_target_upside, price_target_data, price_target_analysis,
      model_used, tokens_input, tokens_output, generated_at
    ) VALUES (
      $1, $2,
      $3, $4, $5,
      $6, $7, $8, $9,
      $10,
      $11, $12, $13, $14,
      $15, $16, $17, NOW()
    )
    ON CONFLICT (symbol, recommendation_date)
    DO UPDATE SET
      investment_summary       = EXCLUDED.investment_summary,
      technical_analysis       = EXCLUDED.technical_analysis,
      fundamental_trend        = EXCLUDED.fundamental_trend,
      valuation_analysis       = EXCLUDED.valuation_analysis,
      sector_positioning       = EXCLUDED.sector_positioning,
      market_context           = EXCLUDED.market_context,
      risk_factors             = EXCLUDED.risk_factors,
      earnings_call_highlights = EXCLUDED.earnings_call_highlights,
      price_target             = EXCLUDED.price_target,
      price_target_upside      = EXCLUDED.price_target_upside,
      price_target_data        = EXCLUDED.price_target_data,
      price_target_analysis    = EXCLUDED.price_target_analysis,
      model_used               = EXCLUDED.model_used,
      tokens_input             = EXCLUDED.tokens_input,
      tokens_output            = EXCLUDED.tokens_output,
      generated_at             = NOW()`,
    [
      params.symbol,
      params.recommendationDate,
      params.investmentSummary,
      params.technicalAnalysis,
      params.fundamentalTrend,
      params.valuationAnalysis,
      params.sectorPositioning,
      params.marketContext,
      params.riskFactors,
      params.earningsCallHighlights,
      params.priceTarget,
      params.priceTargetUpside,
      params.priceTargetData,
      params.priceTargetAnalysis,
      params.modelUsed,
      params.tokensInput,
      params.tokensOutput,
    ],
  );
}

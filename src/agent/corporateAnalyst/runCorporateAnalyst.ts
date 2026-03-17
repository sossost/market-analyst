/**
 * 기업 애널리스트 에이전트 실행 진입점.
 *
 * loadAnalysisInputs → generateAnalysisReport → DB UPSERT 흐름을 실행한다.
 * saveRecommendations에서 fire-and-forget으로 호출하므로
 * 에러 시 throw하지 않고 { success: false, error } 를 반환한다.
 */
import type { Pool } from "pg";
import { loadAnalysisInputs } from "./loadAnalysisInputs.js";
import { generateAnalysisReport, CORPORATE_ANALYST_MODEL } from "./corporateAnalyst.js";
import { logger } from "@/lib/logger.js";

export interface CorporateAnalystResult {
  success: boolean;
  symbol: string;
  error?: string;
}

/**
 * 단일 종목 심층 분석 리포트를 생성하여 stock_analysis_reports 테이블에 UPSERT한다.
 *
 * 에러가 발생해도 throw하지 않는다.
 * 호출자(saveRecommendations)는 이 함수의 실패가 추천 저장 성공에 영향을 주지 않도록
 * fire-and-forget 패턴으로 호출한다.
 */
export async function runCorporateAnalyst(
  symbol: string,
  recommendationDate: string,
  pool: Pool,
): Promise<CorporateAnalystResult> {
  try {
    logger.info("CorporateAnalyst", `${symbol} (${recommendationDate}) 분석 시작`);

    // 1. 분석 입력 데이터 수집
    const inputs = await loadAnalysisInputs(symbol, recommendationDate, pool);

    // 2. LLM 리포트 생성
    const { report, tokensInput, tokensOutput, priceTargetResult } = await generateAnalysisReport(
      symbol,
      inputs.companyName,
      inputs,
    );

    // 3. DB UPSERT
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
        symbol,                                                                          // $1
        recommendationDate,                                                              // $2
        report.investmentSummary,                                                        // $3
        report.technicalAnalysis,                                                        // $4
        report.fundamentalTrend,                                                         // $5
        report.valuationAnalysis,                                                        // $6
        report.sectorPositioning,                                                        // $7
        report.marketContext,                                                            // $8
        report.riskFactors,                                                              // $9
        report.earningsCallHighlights ?? null,                                           // $10
        priceTargetResult?.finalTarget ?? null,                                          // $11
        priceTargetResult?.finalUpside ?? null,                                          // $12
        priceTargetResult != null ? JSON.stringify(priceTargetResult) : null,            // $13
        report.priceTargetAnalysis ?? null,                                              // $14
        CORPORATE_ANALYST_MODEL,                                                         // $15
        tokensInput,                                                                     // $16
        tokensOutput,                                                                    // $17
      ],
    );

    logger.info(
      "CorporateAnalyst",
      `${symbol} (${recommendationDate}) 리포트 저장 완료`,
    );

    return { success: true, symbol };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(
      "CorporateAnalyst",
      `${symbol} (${recommendationDate}) 리포트 생성 실패: ${errorMessage}`,
    );
    return { success: false, symbol, error: errorMessage };
  }
}

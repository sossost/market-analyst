import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";

// Pool mock 팩토리: 호출 순서대로 응답을 반환
function makePool(responses: Array<{ rows: unknown[] }>): Pool {
  let callIndex = 0;
  return {
    query: vi.fn().mockImplementation(() => {
      const response = responses[callIndex] ?? { rows: [] };
      callIndex++;
      return Promise.resolve(response);
    }),
  } as unknown as Pool;
}

import { loadAnalysisInputs } from "../loadAnalysisInputs.js";

// ---------------------------------------------------------------------------
// 픽스처
// ---------------------------------------------------------------------------

const BASE_SYMBOL = "AAPL";
const BASE_DATE = "2026-03-10";

const FACTORS_ROW = {
  rs_score: 85,
  phase: 2,
  ma150_slope: "0.15",
  vol_ratio: "1.5",
  pct_from_high_52w: "-5.2",
  pct_from_low_52w: "42.3",
  conditions_met: '["ma_order", "price_above_ma150"]',
  volume_confirmed: true,
  sector_rs: "72.5",
  sector_group_phase: 2,
  industry_rs: "68.1",
  industry_group_phase: 2,
};

const SYMBOL_ROW = {
  name: "Apple Inc.",
  sector: "Technology",
  industry: "Consumer Electronics",
};

const SECTOR_RS_ROW = {
  avg_rs: "72.5",
  group_phase: 2,
  change_4w: "3.2",
  change_8w: "8.1",
};

const INDUSTRY_RS_ROW = {
  avg_rs: "68.1",
  group_phase: 2,
};

const FINANCIALS_ROWS = [
  {
    period_end_date: "2025-12-31",
    revenue: "124300000000",
    net_income: "36330000000",
    eps_diluted: "2.4",
    ebitda: "43000000000",
    free_cash_flow: "29000000000",
    gross_profit: "54000000000",
  },
  {
    period_end_date: "2025-09-30",
    revenue: "94930000000",
    net_income: "21448000000",
    eps_diluted: "1.36",
    ebitda: "31000000000",
    free_cash_flow: "21000000000",
    gross_profit: "40000000000",
  },
];

const RATIOS_ROW = {
  pe_ratio: "28.5",
  ps_ratio: "7.2",
  pb_ratio: "45.3",
  enterprise_value_over_ebitda: "22.1",
  gross_profit_margin: "43.5",
  operating_profit_margin: "30.1",
  net_profit_margin: "25.3",
  debt_equity_ratio: "1.8",
};

const REGIME_ROW = {
  regime: "EARLY_BULL",
  rationale: "시장이 저점을 확인하고 상승 전환 초입",
  confidence: "high",
};

const SYNTHESIS_ROW = {
  synthesis_report: "AI 인프라 투자가 지속되며 반도체 섹터가 주도를 이어가고 있다.",
};

const COMPANY_PROFILE_ROW = {
  description: "NVIDIA is a technology company.",
  ceo: "Jensen Huang",
  employees: 30000,
  market_cap: "2500000000000",
  website: "https://nvidia.com",
  country: "US",
  exchange: "NASDAQ",
  ipo_date: "1999-01-22",
};

const ANNUAL_FINANCIALS_ROWS = [
  {
    fiscal_year: "2024",
    revenue: "60922000000",
    net_income: "29760000000",
    eps_diluted: "11.93",
    gross_profit: "44301000000",
    operating_income: "32972000000",
    ebitda: "33000000000",
    free_cash_flow: "26949000000",
  },
];

const TRANSCRIPT_ROW = {
  quarter: 4,
  year: 2024,
  date: "2025-02-19",
  transcript: "Good evening, everyone. Our revenue grew 78% year-over-year.",
};

const ANALYST_ESTIMATES_ROWS = [
  {
    period: "2025-12-31",
    estimated_eps_avg: "3.10",
    estimated_eps_high: "3.50",
    estimated_eps_low: "2.80",
    estimated_revenue_avg: "43000000000",
    number_analyst_estimated_eps: 35,
  },
];

const EPS_SURPRISES_ROWS = [
  {
    actual_date: "2025-02-19",
    actual_eps: "0.89",
    estimated_eps: "0.84",
  },
];

const PEER_GROUP_ROW = {
  peers: ["AMD", "INTC"],
};

const PEER_RATIOS_ROWS = [
  {
    symbol: "AMD",
    pe_ratio: "45.0",
    enterprise_value_over_ebitda: "30.0",
    ps_ratio: "8.5",
  },
  {
    symbol: "INTC",
    pe_ratio: "15.0",
    enterprise_value_over_ebitda: "10.0",
    ps_ratio: "2.5",
  },
];

const PRICE_TARGET_ROW = {
  target_high: "200",
  target_low: "120",
  target_mean: "165",
  target_median: "163",
};

// ---------------------------------------------------------------------------
// 헬퍼: 전체 데이터가 있는 Pool 생성
// pool.query 호출 순서 (safeQuery 패턴):
// Phase 1 (Promise.all 13개, 병렬이지만 mock은 순서대로 소비):
//   1. recommendation_factors
//   2. symbols
//   3. quarterly_financials
//   4. quarterly_ratios
//   5. market_regimes
//   6. debate_sessions
//   7. company_profiles
//   8. annual_financials
//   9. earning_call_transcripts
//  10. analyst_estimates
//  11. eps_surprises
//  12. peer_groups
//  13. price_target_consensus
// Phase 2 (symbolRow 의존, 직렬):
//  14. sector_rs_daily (sector != null)
//  15. industry_rs_daily (industry != null)
// Phase 3 (peerGroupRow 의존, 직렬):
//  16. quarterly_ratios (peers)
// ---------------------------------------------------------------------------

function makeFullPool(): Pool {
  return makePool([
    { rows: [FACTORS_ROW] },              //  1. recommendation_factors
    { rows: [SYMBOL_ROW] },               //  2. symbols
    { rows: FINANCIALS_ROWS },            //  3. quarterly_financials
    { rows: [RATIOS_ROW] },               //  4. quarterly_ratios
    { rows: [REGIME_ROW] },               //  5. market_regimes
    { rows: [SYNTHESIS_ROW] },            //  6. debate_sessions
    { rows: [COMPANY_PROFILE_ROW] },      //  7. company_profiles
    { rows: ANNUAL_FINANCIALS_ROWS },     //  8. annual_financials
    { rows: [TRANSCRIPT_ROW] },           //  9. earning_call_transcripts
    { rows: ANALYST_ESTIMATES_ROWS },     // 10. analyst_estimates
    { rows: EPS_SURPRISES_ROWS },         // 11. eps_surprises
    { rows: [PEER_GROUP_ROW] },           // 12. peer_groups
    { rows: [PRICE_TARGET_ROW] },         // 13. price_target_consensus
    { rows: [SECTOR_RS_ROW] },            // 14. sector_rs_daily
    { rows: [INDUSTRY_RS_ROW] },          // 15. industry_rs_daily
    { rows: PEER_RATIOS_ROWS },           // 16. quarterly_ratios (peers)
  ]);
}

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe("loadAnalysisInputs", () => {
  describe("정상 케이스: 모든 데이터가 있을 때", () => {
    it("companyName과 sector, industry를 반환한다", async () => {
      const pool = makeFullPool();
      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.companyName).toBe("Apple Inc.");
      expect(result.sector).toBe("Technology");
      expect(result.industry).toBe("Consumer Electronics");
    });

    it("기술적 데이터를 올바르게 매핑한다", async () => {
      const pool = makeFullPool();
      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.technical.rsScore).toBe(85);
      expect(result.technical.phase).toBe(2);
      expect(result.technical.volumeConfirmed).toBe(true);
      expect(result.technical.conditionsMet).toBe('["ma_order", "price_above_ma150"]');
    });

    it("4분기 실적을 올바르게 매핑한다", async () => {
      const pool = makeFullPool();
      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.financials).toHaveLength(2);
      expect(result.financials[0].periodEndDate).toBe("2025-12-31");
      expect(result.financials[0].epsDiluted).toBe(2.4);
    });

    it("밸류에이션 비율을 올바르게 매핑한다", async () => {
      const pool = makeFullPool();
      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.ratios).not.toBeNull();
      expect(result.ratios?.peRatio).toBe(28.5);
      expect(result.ratios?.grossMargin).toBe(43.5);
    });

    it("시장 레짐을 올바르게 매핑한다", async () => {
      const pool = makeFullPool();
      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.marketRegime).not.toBeNull();
      expect(result.marketRegime?.regime).toBe("EARLY_BULL");
      expect(result.marketRegime?.confidence).toBe("high");
    });

    it("토론 synthesis를 반환한다", async () => {
      const pool = makeFullPool();
      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.debateSynthesis).toBe(
        "AI 인프라 투자가 지속되며 반도체 섹터가 주도를 이어가고 있다.",
      );
    });

    it("섹터 RS 4주·8주 변화를 반환한다", async () => {
      const pool = makeFullPool();
      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.sectorContext.sectorChange4w).toBe(3.2);
      expect(result.sectorContext.sectorChange8w).toBe(8.1);
    });
  });

  describe("graceful degradation: 각 데이터 소스가 빈 경우", () => {
    it("recommendation_factors가 없으면 technical 필드가 모두 null이다", async () => {
      const pool = makePool([
        { rows: [] },             //  1. factors (없음)
        { rows: [SYMBOL_ROW] },   //  2. symbols
        { rows: [] },             //  3. financials
        { rows: [] },             //  4. ratios
        { rows: [REGIME_ROW] },   //  5. regime
        { rows: [] },             //  6. debate
        { rows: [] },             //  7. company_profiles
        { rows: [] },             //  8. annual_financials
        { rows: [] },             //  9. earning_call_transcripts
        { rows: [] },             // 10. analyst_estimates
        { rows: [] },             // 11. eps_surprises
        { rows: [] },             // 12. peer_groups
        { rows: [] },             // 13. price_target_consensus
        { rows: [] },             // 14. sector_rs
        { rows: [] },             // 15. industry_rs
      ]);

      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.technical.rsScore).toBeNull();
      expect(result.technical.phase).toBeNull();
      expect(result.technical.volumeConfirmed).toBeNull();
    });

    it("quarterly_financials가 없으면 financials가 빈 배열이다", async () => {
      const pool = makePool([
        { rows: [FACTORS_ROW] },  //  1. factors
        { rows: [SYMBOL_ROW] },   //  2. symbols
        { rows: [] },             //  3. financials (없음)
        { rows: [RATIOS_ROW] },   //  4. ratios
        { rows: [REGIME_ROW] },   //  5. regime
        { rows: [SYNTHESIS_ROW] }, // 6. debate
        { rows: [] },             //  7. company_profiles
        { rows: [] },             //  8. annual_financials
        { rows: [] },             //  9. earning_call_transcripts
        { rows: [] },             // 10. analyst_estimates
        { rows: [] },             // 11. eps_surprises
        { rows: [] },             // 12. peer_groups
        { rows: [] },             // 13. price_target_consensus
        { rows: [SECTOR_RS_ROW] }, // 14. sector_rs
        { rows: [INDUSTRY_RS_ROW] }, // 15. industry_rs
      ]);

      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.financials).toHaveLength(0);
    });

    it("quarterly_ratios가 없으면 ratios가 null이다", async () => {
      const pool = makePool([
        { rows: [FACTORS_ROW] },   //  1. factors
        { rows: [SYMBOL_ROW] },    //  2. symbols
        { rows: FINANCIALS_ROWS }, //  3. financials
        { rows: [] },              //  4. ratios (없음)
        { rows: [REGIME_ROW] },    //  5. regime
        { rows: [SYNTHESIS_ROW] }, //  6. debate
        { rows: [] },              //  7. company_profiles
        { rows: [] },              //  8. annual_financials
        { rows: [] },              //  9. earning_call_transcripts
        { rows: [] },              // 10. analyst_estimates
        { rows: [] },              // 11. eps_surprises
        { rows: [] },              // 12. peer_groups
        { rows: [] },              // 13. price_target_consensus
        { rows: [SECTOR_RS_ROW] }, // 14. sector_rs
        { rows: [INDUSTRY_RS_ROW] }, // 15. industry_rs
      ]);

      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.ratios).toBeNull();
    });

    it("market_regimes가 없으면 marketRegime이 null이다", async () => {
      const pool = makePool([
        { rows: [FACTORS_ROW] },   //  1. factors
        { rows: [SYMBOL_ROW] },    //  2. symbols
        { rows: FINANCIALS_ROWS }, //  3. financials
        { rows: [RATIOS_ROW] },    //  4. ratios
        { rows: [] },              //  5. regime (없음)
        { rows: [SYNTHESIS_ROW] }, //  6. debate
        { rows: [] },              //  7. company_profiles
        { rows: [] },              //  8. annual_financials
        { rows: [] },              //  9. earning_call_transcripts
        { rows: [] },              // 10. analyst_estimates
        { rows: [] },              // 11. eps_surprises
        { rows: [] },              // 12. peer_groups
        { rows: [] },              // 13. price_target_consensus
        { rows: [SECTOR_RS_ROW] }, // 14. sector_rs
        { rows: [INDUSTRY_RS_ROW] }, // 15. industry_rs
      ]);

      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.marketRegime).toBeNull();
    });

    it("debate_sessions가 없으면 debateSynthesis가 null이다", async () => {
      const pool = makePool([
        { rows: [FACTORS_ROW] },   //  1. factors
        { rows: [SYMBOL_ROW] },    //  2. symbols
        { rows: FINANCIALS_ROWS }, //  3. financials
        { rows: [RATIOS_ROW] },    //  4. ratios
        { rows: [REGIME_ROW] },    //  5. regime
        { rows: [] },              //  6. debate (없음)
        { rows: [] },              //  7. company_profiles
        { rows: [] },              //  8. annual_financials
        { rows: [] },              //  9. earning_call_transcripts
        { rows: [] },              // 10. analyst_estimates
        { rows: [] },              // 11. eps_surprises
        { rows: [] },              // 12. peer_groups
        { rows: [] },              // 13. price_target_consensus
        { rows: [SECTOR_RS_ROW] }, // 14. sector_rs
        { rows: [INDUSTRY_RS_ROW] }, // 15. industry_rs
      ]);

      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.debateSynthesis).toBeNull();
    });

    it("symbols 테이블에 종목이 없으면 companyName/sector/industry가 null이고 sector_rs 쿼리는 실행되지 않는다", async () => {
      // symbols가 없으면 sector/industry가 null → sector_rs/industry_rs 쿼리 미실행
      // Phase 1 (13개) + Phase 2 미실행 = 총 13번 호출
      // peer_groups도 비어있으므로 peer_ratios도 미실행
      const pool = makePool([
        { rows: [FACTORS_ROW] },  //  1. factors
        { rows: [] },             //  2. symbols (없음)
        { rows: [] },             //  3. financials
        { rows: [] },             //  4. ratios
        { rows: [] },             //  5. regime
        { rows: [] },             //  6. debate
        { rows: [] },             //  7. company_profiles
        { rows: [] },             //  8. annual_financials
        { rows: [] },             //  9. earning_call_transcripts
        { rows: [] },             // 10. analyst_estimates
        { rows: [] },             // 11. eps_surprises
        { rows: [] },             // 12. peer_groups
        { rows: [] },             // 13. price_target_consensus
        // 14, 15번 sector_rs/industry_rs 쿼리는 실행되지 않아야 함
      ]);

      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.companyName).toBeNull();
      expect(result.sector).toBeNull();
      expect(result.industry).toBeNull();
      // sector_rs/industry_rs 쿼리가 실행되지 않으므로 총 13번 호출
      expect((pool.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(13);
    });

    it("모든 데이터 소스가 없어도 에러 없이 null 필드 구조를 반환한다", async () => {
      const pool = makePool([
        { rows: [] }, //  1. factors
        { rows: [] }, //  2. symbols
        { rows: [] }, //  3. financials
        { rows: [] }, //  4. ratios
        { rows: [] }, //  5. regime
        { rows: [] }, //  6. debate
        { rows: [] }, //  7. company_profiles
        { rows: [] }, //  8. annual_financials
        { rows: [] }, //  9. earning_call_transcripts
        { rows: [] }, // 10. analyst_estimates
        { rows: [] }, // 11. eps_surprises
        { rows: [] }, // 12. peer_groups
        { rows: [] }, // 13. price_target_consensus
        // 14, 15번 sector_rs/industry_rs 쿼리는 symbols 없으므로 미실행
      ]);

      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.technical.rsScore).toBeNull();
      expect(result.financials).toHaveLength(0);
      expect(result.ratios).toBeNull();
      expect(result.marketRegime).toBeNull();
      expect(result.debateSynthesis).toBeNull();
      expect(result.companyName).toBeNull();
    });
  });

  describe("debateSynthesis 2000자 truncate", () => {
    function makePoolWithSynthesis(synthesis: string): Pool {
      return makePool([
        { rows: [] },                                       //  1. factors
        { rows: [SYMBOL_ROW] },                             //  2. symbols
        { rows: [] },                                       //  3. financials
        { rows: [] },                                       //  4. ratios
        { rows: [] },                                       //  5. regime
        { rows: [{ synthesis_report: synthesis }] },        //  6. debate
        { rows: [] },                                       //  7. company_profiles
        { rows: [] },                                       //  8. annual_financials
        { rows: [] },                                       //  9. earning_call_transcripts
        { rows: [] },                                       // 10. analyst_estimates
        { rows: [] },                                       // 11. eps_surprises
        { rows: [] },                                       // 12. peer_groups
        { rows: [] },                                       // 13. price_target_consensus
        { rows: [] },                                       // 14. sector_rs
        { rows: [] },                                       // 15. industry_rs
      ]);
    }

    it("2000자 초과 synthesis는 2000자로 잘리고 '... (이하 생략)'이 붙는다", async () => {
      const longSynthesis = "A".repeat(2_100);
      const pool = makePoolWithSynthesis(longSynthesis);

      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.debateSynthesis).not.toBeNull();
      expect(result.debateSynthesis!.startsWith("A".repeat(2_000))).toBe(true);
      expect(result.debateSynthesis!.endsWith("... (이하 생략)")).toBe(true);
    });

    it("2000자 이하 synthesis는 그대로 반환한다", async () => {
      const shortSynthesis = "B".repeat(500);
      const pool = makePoolWithSynthesis(shortSynthesis);

      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.debateSynthesis).toBe(shortSynthesis);
    });
  });

  describe("Phase B 신규 데이터 로딩", () => {
    it("company_profiles 데이터를 올바르게 매핑한다", async () => {
      const pool = makeFullPool();
      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.companyProfile).not.toBeNull();
      expect(result.companyProfile?.ceo).toBe("Jensen Huang");
      expect(result.companyProfile?.employees).toBe(30000);
      expect(result.companyProfile?.marketCap).toBe(2_500_000_000_000);
    });

    it("company_profiles가 없으면 companyProfile이 null이다", async () => {
      const pool = makePool([
        { rows: [FACTORS_ROW] },  //  1. factors
        { rows: [SYMBOL_ROW] },   //  2. symbols
        { rows: [] },             //  3. financials
        { rows: [] },             //  4. ratios
        { rows: [] },             //  5. regime
        { rows: [] },             //  6. debate
        { rows: [] },             //  7. company_profiles (없음)
        { rows: [] },             //  8. annual_financials
        { rows: [] },             //  9. earning_call_transcripts
        { rows: [] },             // 10. analyst_estimates
        { rows: [] },             // 11. eps_surprises
        { rows: [] },             // 12. peer_groups
        { rows: [] },             // 13. price_target_consensus
        { rows: [] },             // 14. sector_rs
        { rows: [] },             // 15. industry_rs
      ]);

      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.companyProfile).toBeNull();
    });

    it("annual_financials 데이터를 올바르게 매핑한다", async () => {
      const pool = makeFullPool();
      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.annualFinancials).not.toBeNull();
      expect(result.annualFinancials).toHaveLength(1);
      expect(result.annualFinancials![0].fiscalYear).toBe("2024");
      expect(result.annualFinancials![0].revenue).toBe(60_922_000_000);
    });

    it("annual_financials가 없으면 null이다", async () => {
      const pool = makePool([
        { rows: [FACTORS_ROW] },  //  1. factors
        { rows: [SYMBOL_ROW] },   //  2. symbols
        { rows: [] },             //  3. financials
        { rows: [] },             //  4. ratios
        { rows: [] },             //  5. regime
        { rows: [] },             //  6. debate
        { rows: [] },             //  7. company_profiles
        { rows: [] },             //  8. annual_financials (없음)
        { rows: [] },             //  9. earning_call_transcripts
        { rows: [] },             // 10. analyst_estimates
        { rows: [] },             // 11. eps_surprises
        { rows: [] },             // 12. peer_groups
        { rows: [] },             // 13. price_target_consensus
        { rows: [] },             // 14. sector_rs
        { rows: [] },             // 15. industry_rs
      ]);

      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.annualFinancials).toBeNull();
    });

    it("earningsTranscript 데이터를 올바르게 매핑하고 3000자 이하는 그대로 반환한다", async () => {
      const pool = makeFullPool();
      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.earningsTranscript).not.toBeNull();
      expect(result.earningsTranscript?.quarter).toBe(4);
      expect(result.earningsTranscript?.year).toBe(2024);
      expect(result.earningsTranscript?.transcript).toBe(TRANSCRIPT_ROW.transcript);
    });

    it("트랜스크립트가 3000자를 초과하면 잘리고 '... (이하 생략)'이 붙는다", async () => {
      const longTranscript = "X".repeat(3_500);
      const pool = makePool([
        { rows: [FACTORS_ROW] },  //  1. factors
        { rows: [SYMBOL_ROW] },   //  2. symbols
        { rows: [] },             //  3. financials
        { rows: [] },             //  4. ratios
        { rows: [] },             //  5. regime
        { rows: [] },             //  6. debate
        { rows: [] },             //  7. company_profiles
        { rows: [] },             //  8. annual_financials
        { rows: [{ quarter: 1, year: 2025, date: "2025-05-01", transcript: longTranscript }] }, // 9.
        { rows: [] },             // 10. analyst_estimates
        { rows: [] },             // 11. eps_surprises
        { rows: [] },             // 12. peer_groups
        { rows: [] },             // 13. price_target_consensus
        { rows: [] },             // 14. sector_rs
        { rows: [] },             // 15. industry_rs
      ]);

      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.earningsTranscript?.transcript).not.toBeNull();
      expect(result.earningsTranscript!.transcript!.startsWith("X".repeat(3_000))).toBe(true);
      expect(result.earningsTranscript!.transcript!.endsWith("... (이하 생략)")).toBe(true);
    });

    it("earningsTranscript가 없으면 null이다", async () => {
      const pool = makePool([
        { rows: [FACTORS_ROW] },  //  1. factors
        { rows: [SYMBOL_ROW] },   //  2. symbols
        { rows: [] },             //  3. financials
        { rows: [] },             //  4. ratios
        { rows: [] },             //  5. regime
        { rows: [] },             //  6. debate
        { rows: [] },             //  7. company_profiles
        { rows: [] },             //  8. annual_financials
        { rows: [] },             //  9. earning_call_transcripts (없음)
        { rows: [] },             // 10. analyst_estimates
        { rows: [] },             // 11. eps_surprises
        { rows: [] },             // 12. peer_groups
        { rows: [] },             // 13. price_target_consensus
        { rows: [] },             // 14. sector_rs
        { rows: [] },             // 15. industry_rs
      ]);

      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.earningsTranscript).toBeNull();
    });

    it("analystEstimates 데이터를 올바르게 매핑한다", async () => {
      const pool = makeFullPool();
      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.analystEstimates).not.toBeNull();
      expect(result.analystEstimates).toHaveLength(1);
      expect(result.analystEstimates![0].period).toBe("2025-12-31");
      expect(result.analystEstimates![0].estimatedEpsAvg).toBe(3.10);
      expect(result.analystEstimates![0].numberAnalysts).toBe(35);
    });

    it("epsSurprises 데이터를 올바르게 매핑한다", async () => {
      const pool = makeFullPool();
      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.epsSurprises).not.toBeNull();
      expect(result.epsSurprises).toHaveLength(1);
      expect(result.epsSurprises![0].actualDate).toBe("2025-02-19");
      expect(result.epsSurprises![0].actualEps).toBe(0.89);
      expect(result.epsSurprises![0].estimatedEps).toBe(0.84);
    });

    it("peerGroup 데이터를 올바르게 매핑한다 (피어 멀티플 포함)", async () => {
      const pool = makeFullPool();
      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.peerGroup).not.toBeNull();
      expect(result.peerGroup).toHaveLength(2);
      const amd = result.peerGroup!.find((p) => p.symbol === "AMD");
      expect(amd?.peRatio).toBe(45.0);
      expect(amd?.evEbitda).toBe(30.0);
    });

    it("peer_groups가 없으면 peerGroup이 null이다", async () => {
      const pool = makePool([
        { rows: [FACTORS_ROW] },  //  1. factors
        { rows: [SYMBOL_ROW] },   //  2. symbols
        { rows: [] },             //  3. financials
        { rows: [] },             //  4. ratios
        { rows: [] },             //  5. regime
        { rows: [] },             //  6. debate
        { rows: [] },             //  7. company_profiles
        { rows: [] },             //  8. annual_financials
        { rows: [] },             //  9. earning_call_transcripts
        { rows: [] },             // 10. analyst_estimates
        { rows: [] },             // 11. eps_surprises
        { rows: [] },             // 12. peer_groups (없음)
        { rows: [] },             // 13. price_target_consensus
        { rows: [] },             // 14. sector_rs
        { rows: [] },             // 15. industry_rs
      ]);

      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.peerGroup).toBeNull();
    });

    it("priceTargetConsensus 데이터를 올바르게 매핑한다", async () => {
      const pool = makeFullPool();
      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.priceTargetConsensus).not.toBeNull();
      expect(result.priceTargetConsensus?.targetHigh).toBe(200);
      expect(result.priceTargetConsensus?.targetLow).toBe(120);
      expect(result.priceTargetConsensus?.targetMedian).toBe(163);
    });

    it("priceTargetConsensus가 없으면 null이다", async () => {
      const pool = makePool([
        { rows: [FACTORS_ROW] },  //  1. factors
        { rows: [SYMBOL_ROW] },   //  2. symbols
        { rows: [] },             //  3. financials
        { rows: [] },             //  4. ratios
        { rows: [] },             //  5. regime
        { rows: [] },             //  6. debate
        { rows: [] },             //  7. company_profiles
        { rows: [] },             //  8. annual_financials
        { rows: [] },             //  9. earning_call_transcripts
        { rows: [] },             // 10. analyst_estimates
        { rows: [] },             // 11. eps_surprises
        { rows: [] },             // 12. peer_groups
        { rows: [] },             // 13. price_target_consensus (없음)
        { rows: [] },             // 14. sector_rs
        { rows: [] },             // 15. industry_rs
      ]);

      const result = await loadAnalysisInputs(BASE_SYMBOL, BASE_DATE, pool);

      expect(result.priceTargetConsensus).toBeNull();
    });
  });
});

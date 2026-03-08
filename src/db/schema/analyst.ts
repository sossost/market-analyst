/**
 * Market-analyst owned tables.
 * These are the only tables managed by Drizzle migrations in this project.
 */
import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  smallint,
  boolean,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";

/**
 * stock_phases — Weinstein Phase for each stock per day.
 */
export const stockPhases = pgTable(
  "stock_phases",
  {
    symbol: text("symbol").notNull(),
    date: text("date").notNull(),
    phase: smallint("phase").notNull(), // 1 | 2 | 3 | 4
    prevPhase: smallint("prev_phase"),
    ma150: numeric("ma150"),
    ma150Slope: numeric("ma150_slope"),
    rsScore: integer("rs_score"),
    pctFromHigh52w: numeric("pct_from_high_52w"),
    pctFromLow52w: numeric("pct_from_low_52w"),
    conditionsMet: text("conditions_met"), // JSON array of condition strings
    volRatio: numeric("vol_ratio"), // today volume / vol_ma30
    volumeConfirmed: boolean("volume_confirmed"), // sticky: true if vol >= 2x at Phase 1→2 entry
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_stock_phases_symbol_date").on(t.symbol, t.date),
    idx_date: index("idx_stock_phases_date").on(t.date),
    idx_sym_date: index("idx_stock_phases_symbol_date").on(t.symbol, t.date),
    idx_phase_date: index("idx_stock_phases_phase_date").on(t.phase, t.date),
  }),
);

/**
 * sector_rs_daily — Sector-level RS, breadth, and fundamental metrics.
 */
export const sectorRsDaily = pgTable(
  "sector_rs_daily",
  {
    date: text("date").notNull(),
    sector: text("sector").notNull(),

    // RS metrics
    avgRs: numeric("avg_rs"),
    rsRank: integer("rs_rank"),
    stockCount: integer("stock_count"),
    change4w: numeric("change_4w"),
    change8w: numeric("change_8w"),
    change12w: numeric("change_12w"),

    // Group phase
    groupPhase: smallint("group_phase"),
    prevGroupPhase: smallint("prev_group_phase"),

    // Breadth indicators
    maOrderedRatio: numeric("ma_ordered_ratio"),
    phase2Ratio: numeric("phase2_ratio"),
    rsAbove50Ratio: numeric("rs_above50_ratio"),
    newHighRatio: numeric("new_high_ratio"),

    // Phase transition surge (5-day window)
    phase1to2Count5d: integer("phase1to2_count_5d"),
    phase2to3Count5d: integer("phase2to3_count_5d"),

    // Fundamental acceleration
    revenueAccelRatio: numeric("revenue_accel_ratio"),
    incomeAccelRatio: numeric("income_accel_ratio"),
    profitableRatio: numeric("profitable_ratio"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_sector_rs_daily_date_sector").on(t.date, t.sector),
    idx_date: index("idx_sector_rs_daily_date").on(t.date),
  }),
);

/**
 * industry_rs_daily — Industry-level RS, breadth, and fundamental metrics.
 * Same structure as sector_rs_daily but with parent sector reference.
 */
export const industryRsDaily = pgTable(
  "industry_rs_daily",
  {
    date: text("date").notNull(),
    industry: text("industry").notNull(),
    sector: text("sector"), // Parent sector for drill-down

    // RS metrics
    avgRs: numeric("avg_rs"),
    rsRank: integer("rs_rank"),
    stockCount: integer("stock_count"),
    change4w: numeric("change_4w"),
    change8w: numeric("change_8w"),
    change12w: numeric("change_12w"),

    // Group phase
    groupPhase: smallint("group_phase"),
    prevGroupPhase: smallint("prev_group_phase"),

    // Breadth indicators
    maOrderedRatio: numeric("ma_ordered_ratio"),
    phase2Ratio: numeric("phase2_ratio"),
    rsAbove50Ratio: numeric("rs_above50_ratio"),
    newHighRatio: numeric("new_high_ratio"),

    // Phase transition surge (5-day window)
    phase1to2Count5d: integer("phase1to2_count_5d"),
    phase2to3Count5d: integer("phase2to3_count_5d"),

    // Fundamental acceleration
    revenueAccelRatio: numeric("revenue_accel_ratio"),
    incomeAccelRatio: numeric("income_accel_ratio"),
    profitableRatio: numeric("profitable_ratio"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_industry_rs_daily_date_industry").on(t.date, t.industry),
    idx_date: index("idx_industry_rs_daily_date").on(t.date),
    idx_sector_date: index("idx_industry_rs_daily_sector_date").on(
      t.sector,
      t.date,
    ),
  }),
);

/**
 * recommendations — 추천 종목 성과 트래킹.
 * 주간 에이전트가 저장, 일간 ETL이 업데이트.
 */
export const recommendations = pgTable(
  "recommendations",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    recommendationDate: text("recommendation_date").notNull(),

    // 진입 시점 스냅샷
    entryPrice: numeric("entry_price").notNull(),
    entryRsScore: integer("entry_rs_score"),
    entryPhase: smallint("entry_phase").notNull(),
    entryPrevPhase: smallint("entry_prev_phase"),
    sector: text("sector"),
    industry: text("industry"),
    reason: text("reason"),

    // 현재 상태 (ETL이 매일 업데이트)
    status: text("status").notNull().default("ACTIVE"),
    currentPrice: numeric("current_price"),
    currentPhase: smallint("current_phase"),
    currentRsScore: integer("current_rs_score"),
    pnlPercent: numeric("pnl_percent"),
    maxPnlPercent: numeric("max_pnl_percent"),
    daysHeld: integer("days_held").default(0),
    lastUpdated: text("last_updated"),

    // 종료 정보
    closeDate: text("close_date"),
    closePrice: numeric("close_price"),
    closeReason: text("close_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_recommendations_symbol_date").on(
      t.symbol,
      t.recommendationDate,
    ),
    idxStatus: index("idx_recommendations_status").on(t.status),
    idxDate: index("idx_recommendations_date").on(t.recommendationDate),
  }),
);

/**
 * theses — Thesis Ledger.
 * 토론에서 나온 검증 가능한 예측을 기록하고, 시장 데이터로 검증 결과를 추적한다.
 */
export const theses = pgTable(
  "theses",
  {
    id: serial("id").primaryKey(),
    debateDate: text("debate_date").notNull(),
    agentPersona: text("agent_persona").notNull(), // 'macro' | 'tech' | 'geopolitics' | 'sentiment'
    thesis: text("thesis").notNull(),
    timeframeDays: integer("timeframe_days").notNull(), // 30 | 60 | 90
    verificationMetric: text("verification_metric").notNull(),
    targetCondition: text("target_condition").notNull(),
    invalidationCondition: text("invalidation_condition"),
    confidence: text("confidence").notNull(), // 'low' | 'medium' | 'high'
    consensusLevel: text("consensus_level").notNull(), // '4/4' | '3/4' | '2/4' | '1/4'

    category: text("category").$type<import("../../types/debate.js").ThesisCategory>(), // 'structural_narrative' | 'sector_rotation' | 'short_term_outlook'

    status: text("status").notNull().default("ACTIVE"), // ACTIVE | CONFIRMED | INVALIDATED | EXPIRED
    verificationDate: text("verification_date"),
    verificationResult: text("verification_result"),
    causalAnalysis: text("causal_analysis"), // JSON: { causalChain, keyFactors, reusablePattern, lessonsLearned }
    closeReason: text("close_reason"),
    verificationMethod: text("verification_method"), // 'quantitative' | 'llm'

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    idxStatus: index("idx_theses_status").on(t.status),
    idxDebateDate: index("idx_theses_debate_date").on(t.debateDate),
  }),
);

/**
 * agent_learnings — 장기 기억 (검증된 원칙).
 * 반복 적중 패턴을 승격하고, 적중률 하락/유효기간 만료 시 강등한다.
 */
export const agentLearnings = pgTable(
  "agent_learnings",
  {
    id: serial("id").primaryKey(),
    principle: text("principle").notNull(),
    category: text("category").notNull(), // 'confirmed' | 'caution'
    hitCount: integer("hit_count").notNull().default(0),
    missCount: integer("miss_count").notNull().default(0),
    hitRate: numeric("hit_rate"), // 0.00 ~ 1.00
    sourceThesisIds: text("source_thesis_ids"), // JSON array of thesis IDs
    firstConfirmed: text("first_confirmed"),
    lastVerified: text("last_verified"),
    expiresAt: text("expires_at"),
    isActive: boolean("is_active").default(true),
    verificationPath: text("verification_path"), // 'quantitative' | 'llm' | 'mixed' | null

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    idxActive: index("idx_agent_learnings_active").on(t.isActive),
  }),
);

/**
 * debate_sessions — 토론 세션 전체 기록.
 * 학습 루프의 핵심: 시장 조건 → 분석 → 결과를 연결하는 3종 세트.
 * few-shot 주입, 패턴 분석, 향후 파인튜닝 데이터로 활용.
 */
export const debateSessions = pgTable(
  "debate_sessions",
  {
    id: serial("id").primaryKey(),
    date: text("date").notNull(),

    // 당시 시장 조건 스냅샷
    marketSnapshot: text("market_snapshot").notNull(), // formatted market data text
    newsContext: text("news_context"), // JSON: { macro: "...", tech: "...", ... }

    // 핵심 시장 지표 (유사 세션 검색용)
    vix: numeric("vix"),
    fearGreedScore: numeric("fear_greed_score"),
    phase2Ratio: numeric("phase2_ratio"),
    topSectorRs: text("top_sector_rs"), // "Energy:73.3,Technology:41.5,..."

    // 토론 라운드 출력
    round1Outputs: text("round1_outputs").notNull(), // JSON: RoundOutput[]
    round2Outputs: text("round2_outputs").notNull(), // JSON: RoundOutput[]
    synthesisReport: text("synthesis_report").notNull(),

    // 메타데이터
    thesesCount: integer("theses_count").notNull().default(0),
    tokensInput: integer("tokens_input"),
    tokensOutput: integer("tokens_output"),
    durationMs: integer("duration_ms"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uqDate: unique("uq_debate_sessions_date").on(t.date),
    idxDate: index("idx_debate_sessions_date").on(t.date),
  }),
);

/**
 * recommendation_factors — 추천 시점 팩터 스냅샷.
 * Phase C 팩터 분석용 (현재는 저장만).
 */
/**
 * signal_log — Phase 1→2 전환 시그널 자동 기록 + 수익률 추적.
 * ETL이 매일 새 시그널 기록, 활성 시그널의 수익률 업데이트.
 */
export const signalLog = pgTable(
  "signal_log",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    entryDate: text("entry_date").notNull(),
    entryPrice: numeric("entry_price").notNull(),

    // 진입 시점 팩터 스냅샷
    rsScore: integer("rs_score"),
    volumeConfirmed: boolean("volume_confirmed"),
    sectorGroupPhase: smallint("sector_group_phase"),
    sector: text("sector"),
    industry: text("industry"),

    // 파라미터 스냅샷 (당시 적용된 기준)
    paramsSnapshot: text("params_snapshot"), // JSON: { rsThreshold, volumeRequired, sectorFilter }

    // 고정 기간 수익률 (매일 업데이트)
    return5d: numeric("return_5d"),
    return10d: numeric("return_10d"),
    return20d: numeric("return_20d"),
    return60d: numeric("return_60d"),

    // Phase 종료
    phaseExitDate: text("phase_exit_date"),
    phaseExitReturn: numeric("phase_exit_return"),

    // 최대 수익
    maxReturn: numeric("max_return"),

    // 상태
    status: text("status").notNull().default("ACTIVE"), // ACTIVE | CLOSED
    daysHeld: integer("days_held").default(0),
    lastUpdated: text("last_updated"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_signal_log_symbol_date").on(t.symbol, t.entryDate),
    idxStatus: index("idx_signal_log_status").on(t.status),
    idxDate: index("idx_signal_log_entry_date").on(t.entryDate),
  }),
);

/**
 * signal_params — 시그널 감지 파라미터 변경 이력.
 * 자율 개선 루프에서 파라미터 튜닝 시 이전/이후 값과 성과를 기록.
 */
export const signalParams = pgTable(
  "signal_params",
  {
    id: serial("id").primaryKey(),
    paramName: text("param_name").notNull(), // rs_threshold, volume_required, sector_filter
    currentValue: text("current_value").notNull(),
    previousValue: text("previous_value"),
    changeReason: text("change_reason"),
    changedAt: timestamp("changed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    performanceBefore: numeric("performance_before"),
    performanceAfter: numeric("performance_after"),
  },
  (t) => ({
    idxParam: index("idx_signal_params_name").on(t.paramName),
  }),
);

/**
 * fundamental_scores — 펀더멘탈 SEPA 스코어링 결과.
 * 전체 활성 종목 대상, scored_date별 등급/점수 저장.
 */
export const fundamentalScores = pgTable(
  "fundamental_scores",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    scoredDate: text("scored_date").notNull(), // YYYY-MM-DD (stock_phases 최신일)

    // 등급
    grade: text("grade").notNull(), // 'S' | 'A' | 'B' | 'C' | 'F'
    totalScore: integer("total_score").notNull(),
    rankScore: numeric("rank_score").notNull(),
    requiredMet: smallint("required_met").notNull(), // 0~2
    bonusMet: smallint("bonus_met").notNull(), // 0~2

    // SEPA 기준별 판정 (JSON)
    criteria: text("criteria").notNull(), // JSON: SEPACriteria

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_fundamental_scores_symbol_date").on(t.symbol, t.scoredDate),
    idx_date: index("idx_fundamental_scores_date").on(t.scoredDate),
    idx_grade_date: index("idx_fundamental_scores_grade_date").on(
      t.grade,
      t.scoredDate,
    ),
  }),
);

export const recommendationFactors = pgTable(
  "recommendation_factors",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    recommendationDate: text("recommendation_date").notNull(),

    // 종목 팩터
    rsScore: integer("rs_score"),
    phase: smallint("phase"),
    ma150Slope: numeric("ma150_slope"),
    volRatio: numeric("vol_ratio"),
    volumeConfirmed: boolean("volume_confirmed"),
    pctFromHigh52w: numeric("pct_from_high_52w"),
    pctFromLow52w: numeric("pct_from_low_52w"),
    conditionsMet: text("conditions_met"),

    // 그룹 팩터
    sectorRs: numeric("sector_rs"),
    sectorGroupPhase: smallint("sector_group_phase"),
    industryRs: numeric("industry_rs"),
    industryGroupPhase: smallint("industry_group_phase"),

    // 시장 팩터
    marketPhase2Ratio: numeric("market_phase2_ratio"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_rec_factors_symbol_date").on(
      t.symbol,
      t.recommendationDate,
    ),
  }),
);

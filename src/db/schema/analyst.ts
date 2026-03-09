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
  jsonb,
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

    // 시장 레짐 스냅샷
    marketRegime: text("market_regime"), // 추천 시점의 레짐 (EARLY_BULL 등)

    // 종료 정보
    closeDate: text("close_date"),
    closePrice: numeric("close_price"),
    closeReason: text("close_reason"),

    // 위양성 지표 (Phase 2 회귀 추적)
    failureConditions: text("failure_conditions"), // JSON: FailureConditions
    phase2RevertDate: text("phase2_revert_date"),
    maxAdverseMove: numeric("max_adverse_move"),

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

    category: text("category").$type<import("../../types/debate.js").ThesisCategory>().notNull(), // 'structural_narrative' | 'sector_rotation' | 'short_term_outlook'

    status: text("status").notNull().default("ACTIVE"), // ACTIVE | CONFIRMED | INVALIDATED | EXPIRED
    verificationDate: text("verification_date"),
    verificationResult: text("verification_result"),
    causalAnalysis: text("causal_analysis"), // JSON: { causalChain, keyFactors, reusablePattern, lessonsLearned }
    closeReason: text("close_reason"),
    verificationMethod: text("verification_method"), // 'quantitative' | 'llm'

    // Wave 1 N-1c/N-1d: 서사 레이어
    nextBottleneck: text("next_bottleneck"), // N+1 병목 예측 (structural_narrative만)
    consensusScore: integer("consensus_score"), // consensusLevel 파생 정수 (4/3/2/1)
    dissentReason: text("dissent_reason"), // 반대 의견 요약

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

    // 위양성 지표 (Phase 2 회귀 추적)
    phase2Reverted: boolean("phase2_reverted"),
    timeToRevert: integer("time_to_revert"),
    maxAdverseMove: numeric("max_adverse_move"),
    failureConditions: text("failure_conditions"), // JSON: FailureConditions

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

/**
 * failure_patterns — 조건 조합별 Phase 2 위양성 실패율.
 * ETL이 주기적으로 signal_log에서 실패 사례를 수집, 조건 조합별 실패율 + 통계 유의성을 산출.
 */
export const failurePatterns = pgTable("failure_patterns", {
  id: serial("id").primaryKey(),
  patternName: text("pattern_name").notNull(),
  conditions: text("conditions").notNull(), // JSON: FailureConditions
  failureCount: integer("failure_count").notNull().default(0),
  totalCount: integer("total_count").notNull().default(0),
  failureRate: numeric("failure_rate"),
  significance: numeric("significance"), // p-value (이항 검정)
  cohenH: numeric("cohen_h"),
  isActive: boolean("is_active").default(true),
  lastUpdated: text("last_updated"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * news_archive — 뉴스 상시 수집 아카이브.
 * 6시간마다 Brave Search로 수집, 키워드 기반 분류/감성 판정 후 DB 축적.
 * 토론 에이전트 뉴스 소스 + 후속 이슈(정책 감지, 공급 과잉, 섹터 시차) 데이터 기반.
 */
export const newsArchive = pgTable(
  "news_archive",
  {
    id: serial("id").primaryKey(),

    // 원본 데이터
    url: text("url").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    source: text("source"), // hostname (예: reuters.com)
    publishedAt: text("published_at"), // Brave age 문자열 → ISO datetime 변환, 실패 시 null
    collectedAt: timestamp("collected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    // 분류 (키워드 룰 기반)
    category: text("category").notNull(), // 'POLICY' | 'TECHNOLOGY' | 'MARKET' | 'GEOPOLITICAL' | 'CAPEX' | 'OTHER'

    // 감성 (키워드 룰 기반)
    sentiment: text("sentiment").notNull(), // 'POS' | 'NEU' | 'NEG'

    // 연관 쿼리 카테고리
    queryPersona: text("query_persona"), // 'macro' | 'tech' | 'geopolitics' | 'sentiment'
    queryText: text("query_text"), // 원본 검색 쿼리

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uqUrl: unique("uq_news_archive_url").on(t.url),
    idxCollectedAt: index("idx_news_archive_collected_at").on(t.collectedAt),
    idxCategory: index("idx_news_archive_category").on(t.category),
    idxSentiment: index("idx_news_archive_sentiment").on(t.sentiment),
    idxPersona: index("idx_news_archive_persona").on(t.queryPersona),
  }),
);

/**
 * narrative_chains — 병목 체인 독립 엔티티.
 * 메가트렌드별 병목 노드의 생애주기(식별일 → 해소일)를 추적하여
 * "이 유형의 병목은 평균 N일 후 해소된다"는 패턴 도출의 기반 데이터를 축적한다.
 */
export type NarrativeChainStatus =
  | "ACTIVE"
  | "RESOLVING"
  | "RESOLVED"
  | "OVERSUPPLY"
  | "INVALIDATED";

export const narrativeChains = pgTable(
  "narrative_chains",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),

    // 서사 구조
    megatrend: text("megatrend").notNull(), // "AI 인프라 확장"
    demandDriver: text("demand_driver").notNull(), // "데이터센터 GPU 수요 급증"
    supplyChain: text("supply_chain").notNull(), // "GPU → HBM → 광트랜시버 → 전력"
    bottleneck: text("bottleneck").notNull(), // "광트랜시버 공급 부족" (현재 병목 노드)

    // 병목 생애주기 날짜
    bottleneckIdentifiedAt: timestamp("bottleneck_identified_at", {
      withTimezone: true,
    }).notNull(),
    bottleneckResolvedAt: timestamp("bottleneck_resolved_at", {
      withTimezone: true,
    }),

    // N+1 병목 예측
    nextBottleneck: text("next_bottleneck"),

    // 상태
    status: text("status")
      .$type<NarrativeChainStatus>()
      .notNull()
      .default("ACTIVE"),

    // 수혜 섹터/종목
    beneficiarySectors: jsonb("beneficiary_sectors").$type<string[]>(),
    beneficiaryTickers: jsonb("beneficiary_tickers").$type<string[]>(),

    // 연결된 thesis IDs
    linkedThesisIds: jsonb("linked_thesis_ids").$type<number[]>(),

    // 해소까지 소요 일수 (해소 시 자동 계산)
    resolutionDays: integer("resolution_days"),
  },
  (t) => ({
    idxStatus: index("idx_narrative_chains_status").on(t.status),
    idxMegatrend: index("idx_narrative_chains_megatrend").on(t.megatrend),
  }),
);

/**
 * sector_phase_events — Phase 전이 이벤트 로그.
 * 섹터/산업이 Phase를 전환한 시점을 이벤트로 기록하여 시차 패턴 분석의 기반 데이터를 축적한다.
 */
export const sectorPhaseEvents = pgTable(
  "sector_phase_events",
  {
    id: serial("id").primaryKey(),
    date: text("date").notNull(), // YYYY-MM-DD
    entityType: text("entity_type").notNull(), // 'sector' | 'industry'
    entityName: text("entity_name").notNull(),
    fromPhase: smallint("from_phase").notNull(),
    toPhase: smallint("to_phase").notNull(),
    avgRs: numeric("avg_rs"),
    phase2Ratio: numeric("phase2_ratio"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_sector_phase_events").on(
      t.date,
      t.entityType,
      t.entityName,
      t.fromPhase,
      t.toPhase,
    ),
    idxEntityPhase: index("idx_sector_phase_events_entity_phase").on(
      t.entityType,
      t.entityName,
      t.toPhase,
      t.date,
    ),
    idxDateType: index("idx_sector_phase_events_date_type").on(
      t.date,
      t.entityType,
      t.toPhase,
    ),
  }),
);

/**
 * sector_lag_patterns — 섹터/산업 쌍별 Phase 전이 시차 통계.
 * 선행 섹터(리더)가 Phase 전이 후, 후행 섹터(팔로워)가 동일 전이까지 걸리는
 * 평균 시차를 누적 계산하여 조기 경보의 정량적 근거를 제공한다.
 */
export const sectorLagPatterns = pgTable(
  "sector_lag_patterns",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(), // 'sector' | 'industry'
    leaderEntity: text("leader_entity").notNull(),
    followerEntity: text("follower_entity").notNull(),
    transition: text("transition").notNull(), // '1to2' | '3to4'

    // 관측 통계
    sampleCount: integer("sample_count").notNull().default(0),
    avgLagDays: numeric("avg_lag_days"),
    medianLagDays: numeric("median_lag_days"),
    stddevLagDays: numeric("stddev_lag_days"),
    minLagDays: integer("min_lag_days"),
    maxLagDays: integer("max_lag_days"),

    // 신뢰도
    pValue: numeric("p_value"),
    isReliable: boolean("is_reliable").default(false), // sample_count >= 5

    // 최근 관측
    lastObservedAt: text("last_observed_at"),
    lastLagDays: integer("last_lag_days"),

    lastUpdated: text("last_updated"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_sector_lag_patterns").on(
      t.entityType,
      t.leaderEntity,
      t.followerEntity,
      t.transition,
    ),
    idxLeader: index("idx_sector_lag_patterns_leader").on(
      t.entityType,
      t.leaderEntity,
      t.transition,
    ),
  }),
);

/**
 * market_regimes — 시장 레짐 정성 태깅.
 * 토론 moderator가 macro-economist의 분석을 참조하여 시장 레짐을 판정.
 * debate_date별 UNIQUE — 하루에 하나의 레짐만 기록.
 */
export type MarketRegimeType =
  | "EARLY_BULL"
  | "MID_BULL"
  | "LATE_BULL"
  | "EARLY_BEAR"
  | "BEAR";

export type RegimeConfidence = "low" | "medium" | "high";

export const marketRegimes = pgTable(
  "market_regimes",
  {
    id: serial("id").primaryKey(),
    regimeDate: text("regime_date").notNull(), // YYYY-MM-DD
    regime: text("regime").$type<MarketRegimeType>().notNull(),
    rationale: text("rationale").notNull(), // 판정 근거 2~4줄
    confidence: text("confidence").$type<RegimeConfidence>().notNull(),
    taggedBy: text("tagged_by").notNull().default("macro"), // 향후 확장용
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uqDate: unique("uq_market_regimes_date").on(t.regimeDate),
    idxDate: index("idx_market_regimes_date").on(t.regimeDate),
  }),
);

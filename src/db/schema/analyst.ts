/**
 * Market-analyst owned tables.
 * These are the only tables managed by Drizzle migrations in this project.
 */
import {
  pgTable,
  serial,
  text,
  varchar,
  numeric,
  integer,
  smallint,
  boolean,
  timestamp,
  date,
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
    vduRatio: numeric("vdu_ratio"), // Volume Dry-Up: 5-day avg volume / 50-day avg volume
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

    // Phase D-3: 소수 의견 보존
    minorityView: jsonb("minority_view").$type<import("../../types/debate.js").MinorityView>(), // { analyst, position, reasoning, wasCorrect }

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

    // Sector Alpha Gate — 수혜 섹터의 SEPA 적합성 (null = 미평가)
    alphaCompatible: boolean("alpha_compatible"),
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
    // 히스테리시스: N일 연속 동일 판정 후 확정
    isConfirmed: boolean("is_confirmed").notNull().default(false),
    confirmedAt: text("confirmed_at"), // 확정일 (YYYY-MM-DD), null이면 pending
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uqDate: unique("uq_market_regimes_date").on(t.regimeDate),
    idxDate: index("idx_market_regimes_date").on(t.regimeDate),
    idxConfirmed: index("idx_market_regimes_confirmed").on(
      t.isConfirmed,
      t.regimeDate,
    ),
  }),
);

/**
 * weekly_qa_reports — 주간 QA 분석 결과 아카이빙.
 * run-weekly-qa.ts가 실행일(qa_date)별로 저장.
 * score < 6 또는 needsDecision === true 시 GitHub 이슈 자동 생성.
 */
export const weeklyQaReports = pgTable(
  "weekly_qa_reports",
  {
    id: serial("id").primaryKey(),
    qaDate: text("qa_date").notNull(), // YYYY-MM-DD (실행일)
    score: integer("score"), // 종합 점수 (0~10), null이면 파싱 실패
    fullReport: text("full_report").notNull(), // Claude 생성 전체 텍스트
    ceoSummary: text("ceo_summary"), // "CEO 보고 요약" 섹션 추출
    needsDecision: boolean("needs_decision").notNull().default(false), // 의사결정 필요 여부
    tokensInput: integer("tokens_input"),
    tokensOutput: integer("tokens_output"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uqDate: unique("uq_weekly_qa_reports_date").on(t.qaDate),
    idxDate: index("idx_weekly_qa_reports_date").on(t.qaDate),
  }),
);

/**
 * stock_analysis_reports — 기업 애널리스트 에이전트가 생성하는 종목별 심층 분석 리포트.
 * symbol + recommendation_date 조합으로 UNIQUE — 같은 날짜에 같은 종목은 하나만 존재.
 */
export const stockAnalysisReports = pgTable(
  "stock_analysis_reports",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    recommendationDate: text("recommendation_date").notNull(),

    // 리포트 섹션 (각 섹션은 Markdown 텍스트)
    investmentSummary: text("investment_summary").notNull(),
    technicalAnalysis: text("technical_analysis").notNull(),
    fundamentalTrend: text("fundamental_trend").notNull(),
    valuationAnalysis: text("valuation_analysis").notNull(),
    sectorPositioning: text("sector_positioning").notNull(),
    marketContext: text("market_context").notNull(),
    riskFactors: text("risk_factors").notNull(),
    earningsCallHighlights: text("earnings_call_highlights"), // Phase B 추가 — 어닝콜 핵심 발언 + 톤 분석

    // Phase C: 정량 목표주가
    priceTarget: numeric("price_target"), // 정량 모델 적정가 ($)
    priceTargetUpside: numeric("price_target_upside"), // 상승여력 (%)
    priceTargetData: text("price_target_data"), // JSON: PriceTargetResult 전체
    priceTargetAnalysis: text("price_target_analysis"), // LLM 해석 텍스트 (마크다운)

    // 메타데이터
    modelUsed: text("model_used").notNull(),
    tokensInput: integer("tokens_input"),
    tokensOutput: integer("tokens_output"),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_stock_analysis_reports_symbol_date").on(
      t.symbol,
      t.recommendationDate,
    ),
    idxSymbol: index("idx_stock_analysis_reports_symbol").on(t.symbol),
    idxDate: index("idx_stock_analysis_reports_date").on(t.recommendationDate),
  }),
);

/**
 * watchlist_stocks — 관심종목 등록/해제/이력.
 * 5중 교집합 게이트(Phase 2 + 섹터RS + 개별RS + 서사 근거 + SEPA S/A)를 통과한 종목만 등록.
 * 90일 고정 윈도우로 Phase 궤적을 추적하며, 추천 승률이 아닌 포착 선행성이 핵심 KPI.
 */
export const watchlistStocks = pgTable(
  "watchlist_stocks",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    status: text("status").notNull().default("ACTIVE"), // 'ACTIVE' | 'EXITED'
    entryDate: text("entry_date").notNull(), // 등록일 (YYYY-MM-DD)
    exitDate: text("exit_date"), // 해제일 (null이면 활성)
    exitReason: text("exit_reason"), // 해제 사유

    // 등록 시점 팩터 스냅샷
    entryPhase: smallint("entry_phase").notNull(),
    entryRsScore: integer("entry_rs_score"),
    entrySectorRs: numeric("entry_sector_rs"),
    entrySepaGrade: text("entry_sepa_grade"), // 'S' | 'A' | 'B' | 'C' | 'F'
    entryThesisId: integer("entry_thesis_id"), // 연결된 thesis (nullable)
    entrySector: text("entry_sector"),
    entryIndustry: text("entry_industry"),
    entryReason: text("entry_reason"), // 서사적 등록 근거 (자유 텍스트)

    // 90일 윈도우 트래킹
    trackingEndDate: text("tracking_end_date"), // entry_date + 90일
    currentPhase: smallint("current_phase"),
    currentRsScore: integer("current_rs_score"),
    phaseTrajectory: jsonb("phase_trajectory").$type<
      Array<{ date: string; phase: number; rsScore: number | null }>
    >(), // [{date, phase, rsScore}] — 매일 ETL 누적
    sectorRelativePerf: numeric("sector_relative_perf"), // 섹터 대비 상대 성과 (%)
    priceAtEntry: numeric("price_at_entry"),
    currentPrice: numeric("current_price"),
    pnlPercent: numeric("pnl_percent"), // 참고 지표만
    maxPnlPercent: numeric("max_pnl_percent"),
    daysTracked: integer("days_tracked").default(0),
    lastUpdated: text("last_updated"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_watchlist_stocks_symbol_date").on(t.symbol, t.entryDate),
    idxStatus: index("idx_watchlist_stocks_status").on(t.status),
    idxEntryDate: index("idx_watchlist_stocks_entry_date").on(t.entryDate),
    idxSymbol: index("idx_watchlist_stocks_symbol").on(t.symbol),
  }),
);

// ==================== Phase B: FMP API 확장 데이터 ====================

/**
 * company_profiles — 기업 프로필.
 * FMP /stable/profile 엔드포인트에서 수집.
 * symbol UNIQUE — 종목당 하나의 최신 프로필만 유지.
 */
export const companyProfiles = pgTable(
  "company_profiles",
  {
    symbol: text("symbol").primaryKey(),
    companyName: text("company_name"),
    description: text("description"), // 사업 설명 (TEXT — 수백~수천 자)
    ceo: text("ceo"),
    employees: integer("employees"),
    marketCap: numeric("market_cap"),
    sector: text("sector"),
    industry: text("industry"),
    website: text("website"),
    country: text("country"),
    exchange: text("exchange"),
    ipoDate: text("ipo_date"), // YYYY-MM-DD
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    idxSymbol: index("idx_company_profiles_symbol").on(t.symbol),
  }),
);

/**
 * annual_financials — 연간 재무제표.
 * FMP /stable/income-statement?period=annual 엔드포인트에서 수집.
 * (symbol, fiscal_year) UNIQUE — 종목·회계연도 조합으로 UPSERT.
 */
export const annualFinancials = pgTable(
  "annual_financials",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    fiscalYear: text("fiscal_year").notNull(), // "2024", "2023", ...

    // 손익계산서
    revenue: numeric("revenue"),
    netIncome: numeric("net_income"),
    epsDiluted: numeric("eps_diluted"),
    grossProfit: numeric("gross_profit"),
    operatingIncome: numeric("operating_income"),
    ebitda: numeric("ebitda"),
    freeCashFlow: numeric("free_cash_flow"),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_annual_financials_symbol_fiscal_year").on(
      t.symbol,
      t.fiscalYear,
    ),
    idxSymbol: index("idx_annual_financials_symbol").on(t.symbol),
    idxFiscalYear: index("idx_annual_financials_fiscal_year").on(t.fiscalYear),
  }),
);

/**
 * earning_call_transcripts — 어닝콜 트랜스크립트.
 * FMP /stable/earning-call-transcript 엔드포인트에서 수집.
 * (symbol, quarter, year) UNIQUE.
 * 주의: transcript는 수만 자 원문 전체 저장. 에이전트 주입 시 3,000자 트런케이트.
 */
export const earningCallTranscripts = pgTable(
  "earning_call_transcripts",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    quarter: integer("quarter").notNull(), // 1 | 2 | 3 | 4
    year: integer("year").notNull(), // 2024, 2025, ...
    date: text("date"), // YYYY-MM-DD (어닝콜 날짜)
    transcript: text("transcript"), // 원문 전체 (수만 자)

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_earning_call_transcripts_symbol_quarter_year").on(
      t.symbol,
      t.quarter,
      t.year,
    ),
    idxSymbol: index("idx_earning_call_transcripts_symbol").on(t.symbol),
  }),
);

/**
 * analyst_estimates — 애널리스트 EPS/매출 추정치.
 * FMP /stable/analyst-estimates?period=quarterly 엔드포인트에서 수집.
 * (symbol, period) UNIQUE — period는 "2026-03-31" 형식.
 */
export const analystEstimates = pgTable(
  "analyst_estimates",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    period: text("period").notNull(), // "2026-03-31" 형식 (분기말 날짜)

    estimatedEpsAvg: numeric("estimated_eps_avg"),
    estimatedEpsHigh: numeric("estimated_eps_high"),
    estimatedEpsLow: numeric("estimated_eps_low"),
    estimatedRevenueAvg: numeric("estimated_revenue_avg"),
    numberAnalystEstimatedEps: integer("number_analyst_estimated_eps"),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_analyst_estimates_symbol_period").on(t.symbol, t.period),
    idxSymbol: index("idx_analyst_estimates_symbol").on(t.symbol),
    idxPeriod: index("idx_analyst_estimates_period").on(t.period),
  }),
);

/**
 * eps_surprises — EPS 서프라이즈 히스토리.
 * FMP /api/v3/earnings-surprises/{symbol} 엔드포인트에서 수집.
 * (symbol, actual_date) UNIQUE.
 */
export const epsSurprises = pgTable(
  "eps_surprises",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    actualDate: date("actual_date").notNull(), // 실제 어닝 발표일 (YYYY-MM-DD)

    actualEps: numeric("actual_eps"),
    estimatedEps: numeric("estimated_eps"),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_eps_surprises_symbol_actual_date").on(
      t.symbol,
      t.actualDate,
    ),
    idxSymbol: index("idx_eps_surprises_symbol").on(t.symbol),
  }),
);

/**
 * peer_groups — 동종업계 피어 그룹.
 * FMP /api/v4/stock_peers 엔드포인트에서 수집.
 * symbol UNIQUE — 종목당 하나의 피어 목록만 유지.
 */
export const peerGroups = pgTable(
  "peer_groups",
  {
    symbol: text("symbol").primaryKey(),
    peers: jsonb("peers").$type<string[]>().notNull(), // 피어 종목 심볼 배열

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    idxSymbol: index("idx_peer_groups_symbol").on(t.symbol),
  }),
);

/**
 * price_target_consensus — 월가 가격 목표 컨센서스.
 * FMP /stable/price-target-consensus 엔드포인트에서 수집.
 * symbol UNIQUE — 종목당 하나의 최신 컨센서스만 유지.
 */
export const priceTargetConsensus = pgTable(
  "price_target_consensus",
  {
    symbol: text("symbol").primaryKey(),
    targetHigh: numeric("target_high"),
    targetLow: numeric("target_low"),
    targetMean: numeric("target_mean"),
    targetMedian: numeric("target_median"),
    lastUpdated: timestamp("last_updated", { withTimezone: true }), // FMP 제공 최신 업데이트 일시

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    idxSymbol: index("idx_price_target_consensus_symbol").on(t.symbol),
  }),
);

/**
 * stock_news — 종목별 최신 뉴스.
 * FMP /api/v3/stock_news?tickers={symbol}&limit=5 에서 수집.
 * Phase 2 + 관심종목 대상. 90일 초과 데이터 삭제.
 * news_archive(매크로 뉴스, symbol 없음)와 별개 테이블.
 */
export const stockNews = pgTable(
  "stock_news",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    publishedDate: text("published_date").notNull(), // YYYY-MM-DD HH:MM:SS (FMP 원본)
    title: text("title").notNull(),
    text: text("text"), // 본문 요약
    image: text("image"), // 썸네일 URL
    site: text("site"), // 소스 도메인 (예: reuters.com)
    url: text("url").notNull(), // 원본 기사 URL
    collectedAt: timestamp("collected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uqUrl: unique("uq_stock_news_url").on(t.url),
    idxSymbol: index("idx_stock_news_symbol").on(t.symbol),
    idxPublishedDate: index("idx_stock_news_published_date").on(t.publishedDate),
  }),
);

/**
 * earning_calendar — 실적 발표 일정.
 * FMP /api/v3/earning_calendar?from=YYYY-MM-DD&to=YYYY-MM-DD 에서 수집.
 * 오늘 -7일 ~ +30일 범위를 1회 조회 후 Phase 2 + 관심종목 필터링.
 * 발표 후 실제값(eps, revenue)이 채워지면 ON CONFLICT DO UPDATE.
 */
export const earningCalendar = pgTable(
  "earning_calendar",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    date: date("date").notNull(), // 실적 발표일 (YYYY-MM-DD)
    eps: numeric("eps"), // 실제 EPS (발표 전 null)
    epsEstimated: numeric("eps_estimated"),
    revenue: numeric("revenue"), // 실제 Revenue (발표 전 null)
    revenueEstimated: numeric("revenue_estimated"),
    time: text("time"), // 'amc' (After Market Close) | 'bmo' (Before Market Open)
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_earning_calendar_symbol_date").on(t.symbol, t.date),
    idxSymbol: index("idx_earning_calendar_symbol").on(t.symbol),
    idxDate: index("idx_earning_calendar_date").on(t.date),
  }),
);

/**
 * daily_reports — 일간/주간 리포트 아카이빙.
 * 기존 data/reports/ JSON 파일을 DB로 이관.
 * report_date별 UNIQUE — 같은 날짜에 같은 타입의 리포트는 하나만 존재.
 */
export const dailyReports = pgTable(
  "daily_reports",
  {
    id: serial("id").primaryKey(),
    reportDate: text("report_date").notNull(), // YYYY-MM-DD
    type: text("type").notNull().default("daily"), // 'daily' | 'weekly'

    // 추천 종목 목록
    reportedSymbols: jsonb("reported_symbols")
      .$type<
        {
          symbol: string;
          phase: number;
          prevPhase: number | null;
          rsScore: number;
          sector: string;
          industry: string;
          reason: string;
          firstReportedDate: string;
        }[]
      >()
      .notNull(),

    // 시장 요약
    marketSummary: jsonb("market_summary")
      .$type<{
        phase2Ratio: number;
        leadingSectors: string[];
        totalAnalyzed: number;
      }>()
      .notNull(),

    // 렌더링용 전체 리포트 텍스트 (있을 경우)
    fullContent: text("full_content"),

    // 실행 메타데이터
    metadata: jsonb("metadata").$type<{
      model: string;
      tokensUsed: { input: number; output: number };
      toolCalls: number;
      executionTime: number;
    }>(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uqReportDate: unique("uq_daily_reports_date_type").on(
      t.reportDate,
      t.type,
    ),
    idxDate: index("idx_daily_reports_date").on(t.reportDate),
    idxType: index("idx_daily_reports_type").on(t.type),
  }),
);

/**
 * market_breadth_daily — 일별 시장 브레드스 스냅샷.
 * ETL이 일 1회 집계하여 저장. 소비자는 단순 SELECT 조회.
 */
export const marketBreadthDaily = pgTable("market_breadth_daily", {
  date: date("date").primaryKey(),
  totalStocks:         integer("total_stocks").notNull(),
  phase1Count:         integer("phase1_count").notNull(),
  phase2Count:         integer("phase2_count").notNull(),
  phase3Count:         integer("phase3_count").notNull(),
  phase4Count:         integer("phase4_count").notNull(),
  phase2Ratio:         numeric("phase2_ratio", { precision: 5, scale: 2 }).notNull(),
  phase2RatioChange:   numeric("phase2_ratio_change", { precision: 5, scale: 2 }),
  phase1To2Count5d:    integer("phase1_to2_count_5d"),
  marketAvgRs:         numeric("market_avg_rs", { precision: 5, scale: 2 }),
  advancers:           integer("advancers"),
  decliners:           integer("decliners"),
  unchanged:           integer("unchanged"),
  adRatio:             numeric("ad_ratio", { precision: 6, scale: 2 }),
  newHighs:            integer("new_highs"),
  newLows:             integer("new_lows"),
  hlRatio:             numeric("hl_ratio", { precision: 6, scale: 2 }),
  vixClose:            numeric("vix_close", { precision: 6, scale: 2 }),
  fearGreedScore:      integer("fear_greed_score"),
  fearGreedRating:     varchar("fear_greed_rating", { length: 30 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

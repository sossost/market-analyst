/**
 * market-analyst가 소유하고 ETL을 관리하는 테이블.
 */
import {
  pgTable,
  text,
  numeric,
  timestamp,
  unique,
  index,
  boolean,
  serial,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";

export const symbols = pgTable("symbols", {
  symbol: text("symbol").primaryKey(),
  companyName: text("company_name"),
  marketCap: numeric("market_cap"),
  sector: text("sector"),
  industry: text("industry"),
  beta: numeric("beta"),
  price: numeric("price"),
  lastAnnualDividend: numeric("last_annual_dividend"),
  volume: numeric("volume"),
  exchange: text("exchange"),
  exchangeShortName: text("exchange_short_name"),
  country: text("country"),
  isEtf: boolean("is_etf").default(false),
  isFund: boolean("is_fund").default(false),
  isActivelyTrading: boolean("is_actively_trading").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const quarterlyFinancials = pgTable(
  "quarterly_financials",
  {
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol, { onDelete: "cascade" }),
    periodEndDate: text("period_end_date").notNull(),
    asOfQ: text("as_of_q").notNull(),

    // 손익계산서
    revenue: numeric("revenue"),
    netIncome: numeric("net_income"),
    operatingIncome: numeric("operating_income"),
    ebitda: numeric("ebitda"),
    grossProfit: numeric("gross_profit"),

    // 현금흐름표
    operatingCashFlow: numeric("operating_cash_flow"),
    freeCashFlow: numeric("free_cash_flow"),

    // EPS
    epsDiluted: numeric("eps_diluted"),
    epsBasic: numeric("eps_basic"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uq: unique("uq_quarterly_financials_symbol_period").on(
      t.symbol,
      t.periodEndDate,
    ),
    idx_symbol_q: index("idx_quarterly_financials_symbol_q").on(
      t.symbol,
      t.asOfQ,
    ),
  }),
);

export const quarterlyRatios = pgTable(
  "quarterly_ratios",
  {
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol, { onDelete: "cascade" }),
    periodEndDate: text("period_end_date").notNull(),
    asOfQ: text("as_of_q").notNull(),

    // Valuation
    peRatio: numeric("pe_ratio"),
    pegRatio: numeric("peg_ratio"),
    fwdPegRatio: numeric("fwd_peg_ratio"),
    psRatio: numeric("ps_ratio"),
    pbRatio: numeric("pb_ratio"),
    evEbitda: numeric("ev_ebitda"),

    // Profitability
    grossMargin: numeric("gross_margin"),
    opMargin: numeric("op_margin"),
    netMargin: numeric("net_margin"),

    // Leverage
    debtEquity: numeric("debt_equity"),
    debtAssets: numeric("debt_assets"),
    debtMktCap: numeric("debt_mkt_cap"),
    intCoverage: numeric("int_coverage"),

    // Cash flow
    pOCFRatio: numeric("p_ocf_ratio"),
    pFCFRatio: numeric("p_fcf_ratio"),
    ocfRatio: numeric("ocf_ratio"),
    fcfPerShare: numeric("fcf_per_share"),

    // Dividend
    divYield: numeric("div_yield"),
    payoutRatio: numeric("payout_ratio"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uq: unique("uq_quarterly_ratios_symbol_period").on(
      t.symbol,
      t.periodEndDate,
    ),
  }),
);

export const dailyPrices = pgTable(
  "daily_prices",
  {
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol, { onDelete: "cascade" }),
    date: text("date").notNull(),
    open: numeric("open"),
    high: numeric("high"),
    low: numeric("low"),
    close: numeric("close"),
    adjClose: numeric("adj_close"),
    volume: numeric("volume"),
    rsScore: integer("rs_score"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_daily_prices_symbol_date").on(t.symbol, t.date),
    idx_sym_date: index("idx_daily_prices_symbol_date").on(t.symbol, t.date),
  }),
);

export const dailyMa = pgTable(
  "daily_ma",
  {
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol, { onDelete: "cascade" }),
    date: text("date").notNull(),
    ma20: numeric("ma20"),
    ma50: numeric("ma50"),
    ma100: numeric("ma100"),
    ma200: numeric("ma200"),
    volMa30: numeric("vol_ma30"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_daily_ma_symbol_date").on(t.symbol, t.date),
    idx_sym_date: index("idx_daily_ma_symbol_date").on(t.symbol, t.date),
  }),
);

export const dailyRatios = pgTable(
  "daily_ratios",
  {
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol, { onDelete: "cascade" }),
    date: text("date").notNull(),

    // Valuation (종가 기준 매일 계산)
    peRatio: numeric("pe_ratio"),
    psRatio: numeric("ps_ratio"),
    pbRatio: numeric("pb_ratio"),
    pegRatio: numeric("peg_ratio"),
    evEbitda: numeric("ev_ebitda"),

    // 계산에 사용된 값 (디버깅/검증용)
    marketCap: numeric("market_cap"),
    epsTtm: numeric("eps_ttm"),
    revenueTtm: numeric("revenue_ttm"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uq: unique("uq_daily_ratios_symbol_date").on(t.symbol, t.date),
    idx_sym_date: index("idx_daily_ratios_symbol_date").on(t.symbol, t.date),
  }),
);

export const watchlist = pgTable(
  "watchlist",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    uq: unique("uq_watchlist_user_symbol").on(t.userId, t.symbol),
    idx_user: index("idx_watchlist_user").on(t.userId),
  }),
);

export const dailyBreakoutSignals = pgTable(
  "daily_breakout_signals",
  {
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol, { onDelete: "cascade" }),
    date: text("date").notNull(),
    isConfirmedBreakout: boolean("is_confirmed_breakout")
      .notNull()
      .default(false),
    breakoutPercent: numeric("breakout_percent"),
    volumeRatio: numeric("volume_ratio"),
    isPerfectRetest: boolean("is_perfect_retest").notNull().default(false),
    ma20DistancePercent: numeric("ma20_distance_percent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uq: unique("uq_daily_breakout_signals_symbol_date").on(t.symbol, t.date),
    idx_date_confirmed: index("idx_daily_breakout_signals_date_confirmed").on(
      t.date,
      t.isConfirmedBreakout,
    ),
    idx_date_retest: index("idx_daily_breakout_signals_date_retest").on(
      t.date,
      t.isPerfectRetest,
    ),
  }),
);

export const dailyNoiseSignals = pgTable(
  "daily_noise_signals",
  {
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol, { onDelete: "cascade" }),
    date: text("date").notNull(),
    avgDollarVolume20d: numeric("avg_dollar_volume_20d"),
    avgVolume20d: numeric("avg_volume_20d"),
    atr14: numeric("atr14"),
    atr14Percent: numeric("atr14_percent"),
    bbWidthCurrent: numeric("bb_width_current"),
    bbWidthAvg60d: numeric("bb_width_avg_60d"),
    isVcp: boolean("is_vcp").notNull().default(false),
    bodyRatio: numeric("body_ratio"),
    ma20Ma50DistancePercent: numeric("ma20_ma50_distance_percent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uq: unique("uq_daily_noise_signals_symbol_date").on(t.symbol, t.date),
    idx_date_vcp: index("idx_daily_noise_signals_date_vcp").on(
      t.date,
      t.isVcp,
    ),
  }),
);

// ==================== 매매일지 (Trading Journal) ====================

export const trades = pgTable(
  "trades",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().default("0"),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol, { onDelete: "cascade" }),
    status: text("status").notNull().default("OPEN"),

    // Plan
    strategy: text("strategy"),
    planEntryPrice: numeric("plan_entry_price"),
    planStopLoss: numeric("plan_stop_loss"),
    planTargetPrice: numeric("plan_target_price"),
    planTargets:
      jsonb("plan_targets").$type<{ price: number; weight: number }[]>(),
    entryReason: text("entry_reason"),
    commissionRate: numeric("commission_rate").default("0.07"),

    // Result
    finalPnl: numeric("final_pnl"),
    finalRoi: numeric("final_roi"),
    finalRMultiple: numeric("final_r_multiple"),

    // Review
    mistakeType: text("mistake_type"),
    reviewNote: text("review_note"),

    // Timestamps
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idx_user_status: index("idx_trades_user_status").on(t.userId, t.status),
    idx_user_symbol: index("idx_trades_user_symbol").on(t.userId, t.symbol),
    idx_start_date: index("idx_trades_start_date").on(t.startDate),
  }),
);

export const tradeActions = pgTable(
  "trade_actions",
  {
    id: serial("id").primaryKey(),
    tradeId: integer("trade_id")
      .notNull()
      .references(() => trades.id, { onDelete: "cascade" }),
    actionType: text("action_type").notNull(),
    actionDate: timestamp("action_date", { withTimezone: true })
      .notNull()
      .defaultNow(),
    price: numeric("price").notNull(),
    quantity: integer("quantity").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idx_trade_id: index("idx_trade_actions_trade_id").on(t.tradeId),
    idx_action_date: index("idx_trade_actions_date").on(t.actionDate),
  }),
);

// ==================== 자산 스냅샷 (Asset Snapshots) ====================

export const assetSnapshots = pgTable(
  "asset_snapshots",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().default("0"),
    date: timestamp("date", { mode: "date" }).notNull(),
    totalAssets: numeric("total_assets").notNull(),
    cash: numeric("cash").notNull(),
    positionValue: numeric("position_value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uq_user_date: unique("uq_asset_snapshots_user_date").on(t.userId, t.date),
    idx_user_date: index("idx_asset_snapshots_user_date").on(t.userId, t.date),
  }),
);

export const portfolioSettings = pgTable("portfolio_settings", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique().default("0"),
  cashBalance: numeric("cash_balance").notNull().default("0"),
  initialCashBalance: numeric("initial_cash_balance").default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const accessCodes = pgTable("access_codes", {
  code: text("code").primaryKey(),
  userId: text("user_id").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ==================== 가격 알림 (Price Alerts) ====================

export const priceAlerts = pgTable(
  "price_alerts",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol, { onDelete: "cascade" }),
    alertType: text("alert_type").notNull(),
    alertDate: text("alert_date").notNull(),
    conditionData: jsonb("condition_data"),
    notifiedAt: timestamp("notified_at", { withTimezone: true }).defaultNow(),
    notificationChannels: text("notification_channels").array(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    uq: unique("uq_price_alerts_symbol_type_date").on(
      t.symbol,
      t.alertType,
      t.alertDate,
    ),
    idx_symbol_date: index("idx_price_alerts_symbol_date").on(
      t.symbol,
      t.alertDate,
    ),
    idx_type_date: index("idx_price_alerts_type_date").on(
      t.alertType,
      t.alertDate,
    ),
  }),
);

// ==================== 푸시 알림 (Push Notifications) ====================

export const deviceTokens = pgTable(
  "device_tokens",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().default("0"),
    deviceId: text("device_id").notNull(),
    pushToken: text("push_token").notNull(),
    platform: text("platform").notNull(),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    uq: unique("uq_device_tokens_device_id").on(t.deviceId),
    idx_user: index("idx_device_tokens_user_id").on(t.userId),
    idx_active: index("idx_device_tokens_active").on(t.isActive),
  }),
);

/**
 * Read-only references to screener DB tables.
 * These tables are owned by the screener project — DO NOT migrate or modify.
 */
import {
  pgTable,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  unique,
  index,
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

export const quarterlyFinancials = pgTable(
  "quarterly_financials",
  {
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol, { onDelete: "cascade" }),
    periodEndDate: text("period_end_date").notNull(),
    asOfQ: text("as_of_q").notNull(),
    revenue: numeric("revenue"),
    netIncome: numeric("net_income"),
    operatingIncome: numeric("operating_income"),
    ebitda: numeric("ebitda"),
    grossProfit: numeric("gross_profit"),
    operatingCashFlow: numeric("operating_cash_flow"),
    freeCashFlow: numeric("free_cash_flow"),
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

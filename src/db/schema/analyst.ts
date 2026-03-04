/**
 * Market-analyst owned tables.
 * These are the only tables managed by Drizzle migrations in this project.
 */
import {
  pgTable,
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

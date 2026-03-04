CREATE TABLE "industry_rs_daily" (
	"date" text NOT NULL,
	"industry" text NOT NULL,
	"sector" text,
	"avg_rs" numeric,
	"rs_rank" integer,
	"stock_count" integer,
	"change_4w" numeric,
	"change_8w" numeric,
	"change_12w" numeric,
	"group_phase" smallint,
	"prev_group_phase" smallint,
	"ma_ordered_ratio" numeric,
	"phase2_ratio" numeric,
	"rs_above50_ratio" numeric,
	"new_high_ratio" numeric,
	"phase1to2_count_5d" integer,
	"phase2to3_count_5d" integer,
	"revenue_accel_ratio" numeric,
	"income_accel_ratio" numeric,
	"profitable_ratio" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_industry_rs_daily_date_industry" UNIQUE("date","industry")
);
--> statement-breakpoint
CREATE TABLE "sector_rs_daily" (
	"date" text NOT NULL,
	"sector" text NOT NULL,
	"avg_rs" numeric,
	"rs_rank" integer,
	"stock_count" integer,
	"change_4w" numeric,
	"change_8w" numeric,
	"change_12w" numeric,
	"group_phase" smallint,
	"prev_group_phase" smallint,
	"ma_ordered_ratio" numeric,
	"phase2_ratio" numeric,
	"rs_above50_ratio" numeric,
	"new_high_ratio" numeric,
	"phase1to2_count_5d" integer,
	"phase2to3_count_5d" integer,
	"revenue_accel_ratio" numeric,
	"income_accel_ratio" numeric,
	"profitable_ratio" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_sector_rs_daily_date_sector" UNIQUE("date","sector")
);
--> statement-breakpoint
CREATE TABLE "stock_phases" (
	"symbol" text NOT NULL,
	"date" text NOT NULL,
	"phase" smallint NOT NULL,
	"prev_phase" smallint,
	"ma150" numeric,
	"ma150_slope" numeric,
	"rs_score" integer,
	"pct_from_high_52w" numeric,
	"pct_from_low_52w" numeric,
	"conditions_met" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_stock_phases_symbol_date" UNIQUE("symbol","date")
);
--> statement-breakpoint
CREATE INDEX "idx_industry_rs_daily_date" ON "industry_rs_daily" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_industry_rs_daily_sector_date" ON "industry_rs_daily" USING btree ("sector","date");--> statement-breakpoint
CREATE INDEX "idx_sector_rs_daily_date" ON "sector_rs_daily" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_stock_phases_date" ON "stock_phases" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_stock_phases_symbol_date" ON "stock_phases" USING btree ("symbol","date");--> statement-breakpoint
CREATE INDEX "idx_stock_phases_phase_date" ON "stock_phases" USING btree ("phase","date");
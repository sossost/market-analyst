CREATE TABLE "recommendation_factors" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"recommendation_date" text NOT NULL,
	"rs_score" integer,
	"phase" smallint,
	"ma150_slope" numeric,
	"vol_ratio" numeric,
	"volume_confirmed" boolean,
	"pct_from_high_52w" numeric,
	"pct_from_low_52w" numeric,
	"conditions_met" text,
	"sector_rs" numeric,
	"sector_group_phase" smallint,
	"industry_rs" numeric,
	"industry_group_phase" smallint,
	"market_phase2_ratio" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_rec_factors_symbol_date" UNIQUE("symbol","recommendation_date")
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"recommendation_date" text NOT NULL,
	"entry_price" numeric NOT NULL,
	"entry_rs_score" integer,
	"entry_phase" smallint NOT NULL,
	"entry_prev_phase" smallint,
	"sector" text,
	"industry" text,
	"reason" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"current_price" numeric,
	"current_phase" smallint,
	"current_rs_score" integer,
	"pnl_percent" numeric,
	"max_pnl_percent" numeric,
	"days_held" integer DEFAULT 0,
	"last_updated" text,
	"close_date" text,
	"close_price" numeric,
	"close_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_recommendations_symbol_date" UNIQUE("symbol","recommendation_date")
);
--> statement-breakpoint
CREATE INDEX "idx_recommendations_status" ON "recommendations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_recommendations_date" ON "recommendations" USING btree ("recommendation_date");
CREATE TABLE "news_gap_analysis" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"theme" text NOT NULL,
	"query" text NOT NULL,
	"rationale" text NOT NULL,
	"articles_found" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_news_gap_analysis_date_theme" UNIQUE("date","theme")
);
--> statement-breakpoint
CREATE TABLE "portfolio_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"sector" text,
	"industry" text,
	"entry_date" date NOT NULL,
	"entry_price" numeric(12, 4),
	"entry_phase" integer,
	"entry_rs_score" numeric(6, 2),
	"entry_sepa_grade" text,
	"thesis_id" integer,
	"exit_date" date,
	"exit_price" numeric(12, 4),
	"exit_reason" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"tier" text DEFAULT 'standard' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_portfolio_positions_symbol_entry_date" UNIQUE("symbol","entry_date")
);
--> statement-breakpoint
ALTER TABLE "market_breadth_daily" ADD COLUMN "breadth_score_ema" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "market_breadth_daily" ADD COLUMN "pct_above_ma50" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "tracked_stocks" ADD COLUMN "phase2_since" text;--> statement-breakpoint
ALTER TABLE "portfolio_positions" ADD CONSTRAINT "portfolio_positions_thesis_id_theses_id_fk" FOREIGN KEY ("thesis_id") REFERENCES "public"."theses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_news_gap_analysis_date" ON "news_gap_analysis" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_portfolio_positions_symbol" ON "portfolio_positions" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_portfolio_positions_status" ON "portfolio_positions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_portfolio_positions_entry_date" ON "portfolio_positions" USING btree ("entry_date");
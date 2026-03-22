CREATE TABLE "watchlist_stocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"entry_date" text NOT NULL,
	"exit_date" text,
	"exit_reason" text,
	"entry_phase" smallint NOT NULL,
	"entry_rs_score" integer,
	"entry_sector_rs" numeric,
	"entry_sepa_grade" text,
	"entry_thesis_id" integer,
	"entry_sector" text,
	"entry_industry" text,
	"entry_reason" text,
	"tracking_end_date" text,
	"current_phase" smallint,
	"current_rs_score" integer,
	"phase_trajectory" jsonb,
	"sector_relative_perf" numeric,
	"price_at_entry" numeric,
	"current_price" numeric,
	"pnl_percent" numeric,
	"max_pnl_percent" numeric,
	"days_tracked" integer DEFAULT 0,
	"last_updated" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_watchlist_stocks_symbol_date" UNIQUE("symbol","entry_date")
);
--> statement-breakpoint
CREATE INDEX "idx_watchlist_stocks_status" ON "watchlist_stocks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_watchlist_stocks_entry_date" ON "watchlist_stocks" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "idx_watchlist_stocks_symbol" ON "watchlist_stocks" USING btree ("symbol");
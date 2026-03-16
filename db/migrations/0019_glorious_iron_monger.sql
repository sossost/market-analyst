CREATE TABLE "stock_analysis_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"recommendation_date" text NOT NULL,
	"investment_summary" text NOT NULL,
	"technical_analysis" text NOT NULL,
	"fundamental_trend" text NOT NULL,
	"valuation_analysis" text NOT NULL,
	"sector_positioning" text NOT NULL,
	"market_context" text NOT NULL,
	"risk_factors" text NOT NULL,
	"model_used" text NOT NULL,
	"tokens_input" integer,
	"tokens_output" integer,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_stock_analysis_reports_symbol_date" UNIQUE("symbol","recommendation_date")
);
--> statement-breakpoint
CREATE INDEX "idx_stock_analysis_reports_symbol" ON "stock_analysis_reports" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_stock_analysis_reports_date" ON "stock_analysis_reports" USING btree ("recommendation_date");
CREATE TABLE "analyst_estimates" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"period" text NOT NULL,
	"estimated_eps_avg" numeric,
	"estimated_eps_high" numeric,
	"estimated_eps_low" numeric,
	"estimated_revenue_avg" numeric,
	"number_analyst_estimated_eps" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_analyst_estimates_symbol_period" UNIQUE("symbol","period")
);
--> statement-breakpoint
CREATE TABLE "annual_financials" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"fiscal_year" text NOT NULL,
	"revenue" numeric,
	"net_income" numeric,
	"eps_diluted" numeric,
	"gross_profit" numeric,
	"operating_income" numeric,
	"ebitda" numeric,
	"free_cash_flow" numeric,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_annual_financials_symbol_fiscal_year" UNIQUE("symbol","fiscal_year")
);
--> statement-breakpoint
CREATE TABLE "company_profiles" (
	"symbol" text PRIMARY KEY NOT NULL,
	"company_name" text,
	"description" text,
	"ceo" text,
	"employees" integer,
	"market_cap" numeric,
	"sector" text,
	"industry" text,
	"website" text,
	"country" text,
	"exchange" text,
	"ipo_date" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "earning_call_transcripts" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"quarter" integer NOT NULL,
	"year" integer NOT NULL,
	"date" text,
	"transcript" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_earning_call_transcripts_symbol_quarter_year" UNIQUE("symbol","quarter","year")
);
--> statement-breakpoint
CREATE TABLE "eps_surprises" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"actual_date" date NOT NULL,
	"actual_eps" numeric,
	"estimated_eps" numeric,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_eps_surprises_symbol_actual_date" UNIQUE("symbol","actual_date")
);
--> statement-breakpoint
CREATE TABLE "peer_groups" (
	"symbol" text PRIMARY KEY NOT NULL,
	"peers" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_target_consensus" (
	"symbol" text PRIMARY KEY NOT NULL,
	"target_high" numeric,
	"target_low" numeric,
	"target_mean" numeric,
	"target_median" numeric,
	"last_updated" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_analysis_reports" ADD COLUMN "earnings_call_highlights" text;--> statement-breakpoint
CREATE INDEX "idx_analyst_estimates_symbol" ON "analyst_estimates" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_analyst_estimates_period" ON "analyst_estimates" USING btree ("period");--> statement-breakpoint
CREATE INDEX "idx_annual_financials_symbol" ON "annual_financials" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_annual_financials_fiscal_year" ON "annual_financials" USING btree ("fiscal_year");--> statement-breakpoint
CREATE INDEX "idx_company_profiles_symbol" ON "company_profiles" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_earning_call_transcripts_symbol" ON "earning_call_transcripts" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_eps_surprises_symbol" ON "eps_surprises" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_peer_groups_symbol" ON "peer_groups" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_price_target_consensus_symbol" ON "price_target_consensus" USING btree ("symbol");
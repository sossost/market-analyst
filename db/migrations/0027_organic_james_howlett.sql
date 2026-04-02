CREATE TABLE "index_prices" (
	"symbol" text NOT NULL,
	"date" text NOT NULL,
	"open" numeric,
	"high" numeric,
	"low" numeric,
	"close" numeric,
	"volume" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_index_prices_symbol_date" UNIQUE("symbol","date")
);
--> statement-breakpoint
CREATE TABLE "earning_calendar" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"date" date NOT NULL,
	"eps" numeric,
	"eps_estimated" numeric,
	"revenue" numeric,
	"revenue_estimated" numeric,
	"time" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_earning_calendar_symbol_date" UNIQUE("symbol","date")
);
--> statement-breakpoint
CREATE TABLE "market_breadth_daily" (
	"date" date PRIMARY KEY NOT NULL,
	"total_stocks" integer NOT NULL,
	"phase1_count" integer NOT NULL,
	"phase2_count" integer NOT NULL,
	"phase3_count" integer NOT NULL,
	"phase4_count" integer NOT NULL,
	"phase2_ratio" numeric(5, 2) NOT NULL,
	"phase2_ratio_change" numeric(5, 2),
	"phase1_to2_count_5d" integer,
	"market_avg_rs" numeric(5, 2),
	"advancers" integer,
	"decliners" integer,
	"unchanged" integer,
	"ad_ratio" numeric(6, 2),
	"new_highs" integer,
	"new_lows" integer,
	"hl_ratio" numeric(6, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_news" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"published_date" text NOT NULL,
	"title" text NOT NULL,
	"text" text,
	"image" text,
	"site" text,
	"url" text NOT NULL,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_stock_news_url" UNIQUE("url")
);
--> statement-breakpoint
ALTER TABLE "stock_phases" ADD COLUMN "vdu_ratio" numeric;--> statement-breakpoint
CREATE INDEX "idx_index_prices_symbol_date" ON "index_prices" USING btree ("symbol","date");--> statement-breakpoint
CREATE INDEX "idx_earning_calendar_symbol" ON "earning_calendar" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_earning_calendar_date" ON "earning_calendar" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_stock_news_symbol" ON "stock_news" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_stock_news_published_date" ON "stock_news" USING btree ("published_date");
-- stock_news 테이블: 종목별 최신 뉴스 (FMP /api/v3/stock_news)
CREATE TABLE IF NOT EXISTS "stock_news" (
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

CREATE INDEX IF NOT EXISTS "idx_stock_news_symbol" ON "stock_news" ("symbol");
CREATE INDEX IF NOT EXISTS "idx_stock_news_published_date" ON "stock_news" ("published_date");

-- earning_calendar 테이블: 실적 발표 일정 (FMP /api/v3/earning_calendar)
CREATE TABLE IF NOT EXISTS "earning_calendar" (
  "id" serial PRIMARY KEY NOT NULL,
  "symbol" text NOT NULL,
  "date" date NOT NULL,
  "eps" numeric,
  "eps_estimated" numeric,
  "revenue" numeric,
  "revenue_estimated" numeric,
  "time" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_earning_calendar_symbol_date" UNIQUE("symbol", "date")
);

CREATE INDEX IF NOT EXISTS "idx_earning_calendar_symbol" ON "earning_calendar" ("symbol");
CREATE INDEX IF NOT EXISTS "idx_earning_calendar_date" ON "earning_calendar" ("date");

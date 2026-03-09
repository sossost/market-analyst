CREATE TABLE "daily_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"report_date" text NOT NULL,
	"type" text DEFAULT 'daily' NOT NULL,
	"reported_symbols" jsonb NOT NULL,
	"market_summary" jsonb NOT NULL,
	"full_content" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_daily_reports_date_type" UNIQUE("report_date","type")
);
--> statement-breakpoint
CREATE INDEX "idx_daily_reports_date" ON "daily_reports" USING btree ("report_date");--> statement-breakpoint
CREATE INDEX "idx_daily_reports_type" ON "daily_reports" USING btree ("type");
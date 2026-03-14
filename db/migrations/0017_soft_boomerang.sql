CREATE TABLE "weekly_qa_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"qa_date" text NOT NULL,
	"score" integer,
	"full_report" text NOT NULL,
	"ceo_summary" text,
	"needs_decision" boolean DEFAULT false NOT NULL,
	"tokens_input" integer,
	"tokens_output" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_weekly_qa_reports_date" UNIQUE("qa_date")
);
--> statement-breakpoint
CREATE INDEX "idx_weekly_qa_reports_date" ON "weekly_qa_reports" USING btree ("qa_date");
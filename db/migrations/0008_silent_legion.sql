CREATE TABLE "fundamental_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"scored_date" text NOT NULL,
	"grade" text NOT NULL,
	"total_score" integer NOT NULL,
	"rank_score" numeric NOT NULL,
	"required_met" smallint NOT NULL,
	"bonus_met" smallint NOT NULL,
	"criteria" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_fundamental_scores_symbol_date" UNIQUE("symbol","scored_date")
);
--> statement-breakpoint
CREATE INDEX "idx_fundamental_scores_date" ON "fundamental_scores" USING btree ("scored_date");--> statement-breakpoint
CREATE INDEX "idx_fundamental_scores_grade_date" ON "fundamental_scores" USING btree ("grade","scored_date");
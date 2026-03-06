CREATE TABLE "agent_learnings" (
	"id" serial PRIMARY KEY NOT NULL,
	"principle" text NOT NULL,
	"category" text NOT NULL,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"miss_count" integer DEFAULT 0 NOT NULL,
	"hit_rate" numeric,
	"source_thesis_ids" text,
	"first_confirmed" text,
	"last_verified" text,
	"expires_at" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debate_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"market_snapshot" text NOT NULL,
	"news_context" text,
	"vix" numeric,
	"fear_greed_score" numeric,
	"phase2_ratio" numeric,
	"top_sector_rs" text,
	"round1_outputs" text NOT NULL,
	"round2_outputs" text NOT NULL,
	"synthesis_report" text NOT NULL,
	"theses_count" integer DEFAULT 0 NOT NULL,
	"tokens_input" integer,
	"tokens_output" integer,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_debate_sessions_date" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "theses" (
	"id" serial PRIMARY KEY NOT NULL,
	"debate_date" text NOT NULL,
	"agent_persona" text NOT NULL,
	"thesis" text NOT NULL,
	"timeframe_days" integer NOT NULL,
	"verification_metric" text NOT NULL,
	"target_condition" text NOT NULL,
	"invalidation_condition" text,
	"confidence" text NOT NULL,
	"consensus_level" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"verification_date" text,
	"verification_result" text,
	"close_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_agent_learnings_active" ON "agent_learnings" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_debate_sessions_date" ON "debate_sessions" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_theses_status" ON "theses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_theses_debate_date" ON "theses" USING btree ("debate_date");
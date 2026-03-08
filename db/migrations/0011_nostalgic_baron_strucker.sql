CREATE TABLE "failure_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"pattern_name" text NOT NULL,
	"conditions" text NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"failure_rate" numeric,
	"significance" numeric,
	"cohen_h" numeric,
	"is_active" boolean DEFAULT true,
	"last_updated" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "failure_conditions" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "phase2_revert_date" text;--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "max_adverse_move" numeric;--> statement-breakpoint
ALTER TABLE "signal_log" ADD COLUMN "phase2_reverted" boolean;--> statement-breakpoint
ALTER TABLE "signal_log" ADD COLUMN "time_to_revert" integer;--> statement-breakpoint
ALTER TABLE "signal_log" ADD COLUMN "max_adverse_move" numeric;--> statement-breakpoint
ALTER TABLE "signal_log" ADD COLUMN "failure_conditions" text;
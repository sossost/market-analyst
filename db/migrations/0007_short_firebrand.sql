ALTER TABLE "agent_learnings" ADD COLUMN IF NOT EXISTS "verification_path" text;--> statement-breakpoint
ALTER TABLE "theses" ADD COLUMN IF NOT EXISTS "verification_method" text;
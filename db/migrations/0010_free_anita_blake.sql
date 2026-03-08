ALTER TABLE "theses" ALTER COLUMN "category" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "theses" ADD COLUMN "next_bottleneck" text;--> statement-breakpoint
ALTER TABLE "theses" ADD COLUMN "consensus_score" integer;--> statement-breakpoint
ALTER TABLE "theses" ADD COLUMN "dissent_reason" text;
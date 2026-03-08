CREATE TABLE "narrative_chains" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"megatrend" text NOT NULL,
	"demand_driver" text NOT NULL,
	"supply_chain" text NOT NULL,
	"bottleneck" text NOT NULL,
	"bottleneck_identified_at" timestamp with time zone NOT NULL,
	"bottleneck_resolved_at" timestamp with time zone,
	"next_bottleneck" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"beneficiary_sectors" jsonb,
	"beneficiary_tickers" jsonb,
	"linked_thesis_ids" jsonb,
	"resolution_days" integer
);
--> statement-breakpoint
CREATE INDEX "idx_narrative_chains_status" ON "narrative_chains" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_narrative_chains_megatrend" ON "narrative_chains" USING btree ("megatrend");
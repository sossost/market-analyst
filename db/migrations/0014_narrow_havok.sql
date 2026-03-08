CREATE TABLE "sector_lag_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"leader_entity" text NOT NULL,
	"follower_entity" text NOT NULL,
	"transition" text NOT NULL,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"avg_lag_days" numeric,
	"median_lag_days" numeric,
	"stddev_lag_days" numeric,
	"min_lag_days" integer,
	"max_lag_days" integer,
	"p_value" numeric,
	"is_reliable" boolean DEFAULT false,
	"last_observed_at" text,
	"last_lag_days" integer,
	"last_updated" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_sector_lag_patterns" UNIQUE("entity_type","leader_entity","follower_entity","transition")
);
--> statement-breakpoint
CREATE TABLE "sector_phase_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_name" text NOT NULL,
	"from_phase" smallint NOT NULL,
	"to_phase" smallint NOT NULL,
	"avg_rs" numeric,
	"phase2_ratio" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_sector_phase_events" UNIQUE("date","entity_type","entity_name","from_phase","to_phase")
);
--> statement-breakpoint
CREATE INDEX "idx_sector_lag_patterns_leader" ON "sector_lag_patterns" USING btree ("entity_type","leader_entity","transition");--> statement-breakpoint
CREATE INDEX "idx_sector_phase_events_entity_phase" ON "sector_phase_events" USING btree ("entity_type","entity_name","to_phase","date");--> statement-breakpoint
CREATE INDEX "idx_sector_phase_events_date_type" ON "sector_phase_events" USING btree ("date","entity_type","to_phase");
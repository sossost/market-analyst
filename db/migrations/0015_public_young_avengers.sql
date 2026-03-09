CREATE TABLE "market_regimes" (
	"id" serial PRIMARY KEY NOT NULL,
	"regime_date" text NOT NULL,
	"regime" text NOT NULL,
	"rationale" text NOT NULL,
	"confidence" text NOT NULL,
	"tagged_by" text DEFAULT 'macro' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_market_regimes_date" UNIQUE("regime_date")
);
--> statement-breakpoint
ALTER TABLE "recommendations" ADD COLUMN "market_regime" text;--> statement-breakpoint
CREATE INDEX "idx_market_regimes_date" ON "market_regimes" USING btree ("regime_date");
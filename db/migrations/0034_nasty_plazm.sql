CREATE TABLE "narrative_chain_regimes" (
	"chain_id" integer NOT NULL,
	"regime_id" integer NOT NULL,
	"sequence_order" integer,
	"sequence_confidence" text,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "narrative_chain_regimes_chain_id_regime_id_pk" PRIMARY KEY("chain_id","regime_id")
);
--> statement-breakpoint
ALTER TABLE "narrative_chain_regimes" ADD CONSTRAINT "narrative_chain_regimes_chain_id_narrative_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."narrative_chains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narrative_chain_regimes" ADD CONSTRAINT "narrative_chain_regimes_regime_id_meta_regimes_id_fk" FOREIGN KEY ("regime_id") REFERENCES "public"."meta_regimes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ncr_regime_id" ON "narrative_chain_regimes" USING btree ("regime_id");--> statement-breakpoint
CREATE INDEX "idx_ncr_chain_id" ON "narrative_chain_regimes" USING btree ("chain_id");--> statement-breakpoint
-- 기존 meta_regime_id 데이터를 junction table로 이관
INSERT INTO "narrative_chain_regimes" ("chain_id", "regime_id", "sequence_order", "sequence_confidence", "linked_at")
SELECT "id", "meta_regime_id", "sequence_order", "sequence_confidence", NOW()
FROM "narrative_chains"
WHERE "meta_regime_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- meta_regime_id 컬럼은 deprecated 처리 (삭제하지 않고 COMMENT로 표시)
COMMENT ON COLUMN "narrative_chains"."meta_regime_id" IS 'deprecated: use narrative_chain_regimes junction table';
ALTER TABLE "market_regimes" ADD COLUMN "is_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "market_regimes" ADD COLUMN "confirmed_at" text;--> statement-breakpoint
CREATE INDEX "idx_market_regimes_confirmed" ON "market_regimes" USING btree ("is_confirmed","regime_date");--> statement-breakpoint
-- 기존 레코드는 모두 확정 처리 (히스테리시스 도입 이전 데이터는 신뢰 가능한 확정값)
UPDATE "market_regimes" SET "is_confirmed" = true, "confirmed_at" = "regime_date" WHERE "is_confirmed" = false;
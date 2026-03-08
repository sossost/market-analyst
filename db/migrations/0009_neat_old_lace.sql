ALTER TABLE "theses" ADD COLUMN "category" text;

-- Backfill: 기존 rows에 기본 카테고리 적용
UPDATE "theses" SET "category" = 'short_term_outlook' WHERE "category" IS NULL;
-- Volume Dry-Up (VDU) ratio: 5일 평균 거래량 / 50일 평균 거래량
-- Phase 1→2 전환 선행 지표 — dry-up 패턴 감지용
ALTER TABLE "stock_phases" ADD COLUMN "vdu_ratio" numeric;

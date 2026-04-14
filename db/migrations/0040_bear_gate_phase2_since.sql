-- #777: Bear 게이트 정밀화 + Phase 2 경과일 기록
-- tracked_stocks에 phase2_since 컬럼 추가.
-- Phase 2 연속 진입 첫 날을 기록하여 초입/진행/확립 구분.

ALTER TABLE tracked_stocks ADD COLUMN phase2_since TEXT;

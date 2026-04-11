-- #733: status_quo thesis 태깅 — 현상유지 예측 분리 집계
-- 생성 시점에 targetCondition이 이미 충족된 thesis를 태깅하여
-- 적중률 왜곡과 학습 루프 오염을 방지한다.

ALTER TABLE theses
  ADD COLUMN IF NOT EXISTS is_status_quo BOOLEAN;

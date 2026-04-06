-- Stale ACTIVE thesis 5건 만료 처리
-- Issue #644: 30일+ 판정 지연으로 학습 루프 오염 및 슬롯 점유
--
-- id 2,7,8: 정성적 targetCondition → 정량/LLM 검증 불가
-- id 10: WTI $95-105 목표 — 90일 내 도달 불가 판정
-- id 15: XBI $102 목표 — 90일 내 도달 불가 판정

UPDATE theses
SET
  status = 'EXPIRED',
  verification_date = CURRENT_DATE::text,
  verification_result = 'Stale thesis — 30일+ ACTIVE 상태 판정 지연, 검증 조건 측정 불가 또는 목표 도달 불가',
  close_reason = 'stale_unverifiable'
WHERE id IN (2, 7, 8, 10, 15)
  AND status = 'ACTIVE';

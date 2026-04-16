-- #845: short_term_outlook 카테고리 제거 — 기존 ACTIVE thesis 일괄 EXPIRED 처리
-- 데이터 삭제 아님. 히스토리 보존을 위해 status만 변경.
UPDATE theses
SET
  status = 'EXPIRED',
  verification_date = CURRENT_DATE::text,
  verification_result = 'short_term_outlook 카테고리 폐지 — 자동 만료 (#845)',
  close_reason = 'category_removed'
WHERE
  category = 'short_term_outlook'
  AND status = 'ACTIVE';

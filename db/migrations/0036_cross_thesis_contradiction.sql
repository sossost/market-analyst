-- #752: cross-thesis 모순 탐지 — 같은 target entity에 방향성 상반 thesis 강등
-- Round3 synthesis 후 coherence check에서 lower consensus 쪽에 플래그를 부착하여
-- 학습 루프에 상반 신호가 유입되는 것을 방지한다.

ALTER TABLE theses
  ADD COLUMN IF NOT EXISTS contradiction_detected BOOLEAN;

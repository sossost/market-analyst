/**
 * Thesis 진행률 기반 만료 임계치.
 *
 * 두 경로에서 동일한 값을 사용:
 * 1. thesisVerifier.ts — LLM HOLD 판정 시 이 진행률 이상이면 강제 만료
 * 2. thesisStore.ts (expireStalledTheses) — LLM 실패 시 독립 안전망
 *
 * 0.8 → 0.5로 하향 (#644): stale thesis 적체 방지
 */
export const THESIS_EXPIRE_PROGRESS = 0.5;

/**
 * 카테고리별 최소 timeframe (일).
 * structural_narrative: 구조적 서사 — 최소 60일 (중장기)
 * sector_rotation: 섹터 로테이션 — 최소 45일 (중기)
 * #845: short_term_outlook(30일) 제거 후, 인베스팅/스윙 철학에 맞는 하한 설정.
 */
export const STRUCTURAL_NARRATIVE_MIN_DAYS = 60;
export const SECTOR_ROTATION_MIN_DAYS = 45;

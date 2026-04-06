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

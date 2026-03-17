/**
 * Claude API 모델 ID 중앙 관리.
 *
 * 모든 에이전트/서비스는 이 파일에서 모델 ID를 import한다.
 * 모델 버전 변경 시 이 파일만 수정하면 된다.
 */

/** Claude Sonnet — 주력 모델 (토론, 리뷰, 에이전트) */
export const CLAUDE_SONNET = "claude-sonnet-4-20250514";

/** Claude Haiku — 경량 작업 */
export const CLAUDE_HAIKU = "claude-haiku-4-20250514";

/** Claude Opus — 고난도 추론 */
export const CLAUDE_OPUS = "claude-opus-4-20250514";

/**
 * 시스템 프롬프트 진입점 — 하위 호환성 유지용 re-export.
 *
 * 실제 구현은 다음 파일에 있습니다:
 * - src/agent/prompts/shared.ts  — 공유 유틸 (injectFeedbackLayers, sanitizeXml, ANALYSIS_FRAMEWORK)
 * - src/agent/prompts/daily.ts   — buildDailySystemPrompt
 * - src/agent/prompts/weekly.ts  — buildWeeklySystemPrompt
 */

export { buildDailySystemPrompt } from "./prompts/daily.js";
export { buildWeeklySystemPrompt } from "./prompts/weekly.js";

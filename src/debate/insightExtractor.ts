/**
 * 토론 synthesisReport에서 일간 에이전트가 소비할 핵심 인사이트를 추출하는 유틸리티.
 *
 * 분리 이유: run-debate-agent.ts와 sessionStore.ts 간 순환 참조 방지.
 * - run-debate-agent.ts → 이 모듈 import (발송 경로 로직)
 * - sessionStore.ts → 이 모듈 import (loadTodayDebateInsight)
 */

/**
 * synthesisReport에서 일간 에이전트 브리핑용 핵심 인사이트를 추출한다.
 *
 * 추출 우선순위:
 * 1. "### 3. 핵심 발견" 섹션 — 구조적 인사이트가 가장 밀집된 섹션
 * 2. "### 1. 핵심 한 줄" 섹션 — 짧은 대안
 * 3. fallback: 보고서 첫 300자
 *
 * @param report - debate_sessions.synthesisReport 전문
 * @returns 추출된 인사이트 문자열. 보고서가 비어있으면 빈 문자열 반환.
 */
export function extractDailyInsight(report: string): string {
  if (report.trim() === "") {
    return "";
  }

  // 우선순위 1: "### 3. 핵심 발견" 섹션 추출
  const coreFindings = report.match(
    /###\s*3\.\s*핵심 발견[^\n]*\n([\s\S]*?)(?=\n###\s*\d+\.|$)/,
  );
  if (coreFindings != null) {
    const extracted = coreFindings[1].trim();
    if (extracted.length > 0) {
      return extracted;
    }
  }

  // 우선순위 2: "### 1. 핵심 한 줄" 섹션 추출
  const headlineLine = report.match(
    /###\s*1\.\s*핵심 한 줄[^\n]*\n([\s\S]*?)(?=\n###\s*\d+\.|$)/,
  );
  if (headlineLine != null) {
    const extracted = headlineLine[1].trim();
    if (extracted.length > 0) {
      return extracted;
    }
  }

  // fallback: 첫 300자
  const FALLBACK_MAX_CHARS = 300;
  const firstChunk = report.slice(0, FALLBACK_MAX_CHARS).trim();
  if (firstChunk.length === 0) {
    return "";
  }
  return firstChunk.endsWith(".") ? firstChunk : `${firstChunk}...`;
}

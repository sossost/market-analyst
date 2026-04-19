/**
 * 토론 synthesisReport에서 일간 에이전트가 소비할 핵심 인사이트를 추출하는 유틸리티.
 *
 * 분리 이유: run-debate-agent.ts와 sessionStore.ts 간 순환 참조 방지.
 * - run-debate-agent.ts → 이 모듈 import (발송 경로 로직)
 * - sessionStore.ts → 이 모듈 import (loadTodayDebateInsight)
 */

// ─── 구조화 토론 요약 타입 ──────────────────────────────────────────────────

/** 일간 리포트용 토론 요약. synthesis_report에서 섹션별 추출. */
export interface DebateSummary {
  /** 핵심 한 줄 — 섹션 1 (굵은 글씨 안의 핵심 문장) */
  headline: string;
  /** 주요 논점 — 섹션 3 핵심 발견의 제목들 */
  keyTopics: string[];
  /** 분석가 이견 — 섹션 6 요약 */
  dissent: string;
  /** 결론 — 섹션 6의 모더레이터 판단 또는 섹션 1 fallback */
  conclusion: string;
}

// ─── 텍스트 정제 헬퍼 ─────────────────────────────────────────────────────────

/** 앞뒤 장식 따옴표/큰따옴표를 제거한다. HTML 엔티티 &quot; 방지. */
function stripQuotes(text: string): string {
  return text
    .replace(/^[\\]?[""\u201C\u201D]+|[\\]?[""\u201C\u201D]+$/g, "")
    .trim();
}

// ─── 섹션 추출 헬퍼 ──────────────────────────────────────────────────────────

/**
 * ## N. 또는 ### N. 패턴으로 시작하는 섹션의 본문을 추출한다.
 * 다음 동일 레벨 섹션이 시작되기 전까지의 텍스트를 반환.
 */
function extractSection(report: string, sectionNumber: number, titleFragment: string): string {
  const pattern = new RegExp(
    `#{2,3}\\s*${sectionNumber}\\.\\s*${titleFragment}[^\\n]*\\n([\\s\\S]*?)(?=\\n#{2,3}\\s*\\d+\\.|$)`,
  );
  const match = report.match(pattern);
  if (match != null) {
    const extracted = match[1].trim();
    if (extracted.length > 0) return extracted;
  }
  return "";
}

/**
 * 핵심 한 줄 섹션에서 **굵은 글씨** 안의 핵심 문장만 추출한다.
 * 예: "**에너지 전쟁 프리미엄 해체 자금이 Financial Services로 초기 유입**"
 */
function extractHeadline(report: string): string {
  const section = extractSection(report, 1, "핵심 한 줄");
  if (section === "") return "";

  // **...** 패턴에서 핵심 문구 추출
  const boldMatch = section.match(/\*\*(.+?)\*\*/);
  if (boldMatch != null) return stripQuotes(boldMatch[1].trim());

  // bold 없으면 첫 줄 반환
  const firstLine = section.split("\n")[0].trim();
  return stripQuotes(firstLine);
}

/**
 * 핵심 발견 섹션에서 발견 제목들을 추출한다.
 * "발견 N:", "발견 ①:", "### 발견 N" 등 다양한 넘버링 패턴을 처리.
 */
function extractKeyTopics(report: string): string[] {
  const section = extractSection(report, 3, "핵심 발견");
  if (section === "") return [];

  const topics: string[] = [];

  // 아라비아 숫자, 동그라미 숫자(①②③), 한글 숫자(일이삼) 등 모든 넘버링 패턴
  const findingPattern = /#{0,3}\s*발견\s*[\d①②③④⑤⑥⑦⑧⑨⑩]+\s*[:：]\s*(.+)/g;
  let match: RegExpExecArray | null;
  while ((match = findingPattern.exec(section)) !== null) {
    const topic = match[1].trim()
      .replace(/\*\*/g, "")
      .replace(/[""\u201C\u201D]/g, "")
      .replace(/\s*[\(（]합의\s*\d+\/\d+[\)）]\s*$/, ""); // "(합의 3/4)" 메타데이터 제거
    if (topic.length > 0) topics.push(topic);
  }

  return topics;
}

/**
 * 분석가 이견 섹션(섹션 6)의 본문을 추출한다.
 * 모더레이터 판단 부분을 별도로 분리하여 conclusion으로 사용.
 */
function extractDissent(report: string): { dissent: string; moderatorConclusion: string } {
  const section = extractSection(report, 6, "분석가 이견");
  if (section === "") return { dissent: "", moderatorConclusion: "" };

  // 모더레이터 판단/종합 부분 분리
  const moderatorPattern = /\*\*모더레이터\s*(판단|종합|결론)\*\*\s*[:：]?\s*([\s\S]*?)(?=\n#{2,3}\s*\d+\.|$)/;
  const modMatch = section.match(moderatorPattern);
  const moderatorConclusion = modMatch != null
    ? modMatch[2].trim().replace(/\n---\s*$/, "").trim() // 후행 수평선 제거
    : "";

  // 이견 제목 (### 이견: ... 패턴) — 마크다운 헤딩 접두사 제거
  const dissentTitleMatch = section.match(/#{0,3}\s*이견\s*[:：]\s*(.+)/);
  const dissentTitle = dissentTitleMatch != null
    ? dissentTitleMatch[1].trim().replace(/\*\*/g, "")
    : "";

  // 소수 의견과 다수 의견 요약 시도
  const lines = section.split("\n")
    .map(l => l.replace(/^#{1,4}\s*/, "").trim()) // 마크다운 헤딩 접두사 제거
    .filter(l => l.length > 0);
  const summaryParts: string[] = [];

  if (dissentTitle !== "") {
    summaryParts.push(dissentTitle);
  }

  // **XXX 입장**: 또는 **XXX(소수/다수)**: 패턴에서 핵심 주장 추출
  const positionPattern = /\*\*(.+?)\s*(?:입장|[\(（].+?[\)）])\s*\*\*\s*[:：]?\s*(.+)/g;
  let posMatch: RegExpExecArray | null;
  while ((posMatch = positionPattern.exec(section)) !== null) {
    const who = posMatch[1].trim();
    // 첫 문장만 추출 (너무 긴 주장 방지)
    const fullClaim = posMatch[2].trim();
    const firstSentence = fullClaim.split(/[.。]/)[0].trim();
    const claim = firstSentence.length > 0 && firstSentence.length < 200
      ? firstSentence
      : fullClaim.slice(0, 150);
    if (claim.length > 0) {
      summaryParts.push(`${who}: ${claim}`);
    }
  }

  // 모더레이터 판단이 summaryParts에 섞여 들어가는 것 방지
  const filteredParts = summaryParts.filter(p => !p.startsWith("모더레이터"));

  const dissent = filteredParts.length > 0
    ? filteredParts.join(" / ")
    : lines
        .filter(l => !l.includes("모더레이터 판단") && !l.includes("모더레이터 종합"))
        .slice(0, 3).join(" ").slice(0, 300);

  return { dissent, moderatorConclusion };
}

// ─── 구조화 토론 요약 추출 ──────────────────────────────────────────────────

/**
 * synthesisReport에서 구조화된 토론 요약을 추출한다.
 * 일간 리포트의 "오늘의 토론" 섹션 렌더링에 사용.
 *
 * @param report - debate_sessions.synthesisReport 전문
 * @returns 구조화된 토론 요약. 보고서가 비어있으면 null 반환.
 */
export function extractDebateSummary(report: string): DebateSummary | null {
  if (report.trim() === "") return null;

  const headline = extractHeadline(report);
  const keyTopics = extractKeyTopics(report);
  const { dissent, moderatorConclusion } = extractDissent(report);

  // 최소 핵심 한 줄이라도 있어야 유효한 요약
  if (headline === "" && keyTopics.length === 0) return null;

  return {
    headline,
    keyTopics,
    dissent,
    conclusion: moderatorConclusion !== "" ? moderatorConclusion : headline,
  };
}

// ─── 기존 extractDailyInsight (하위 호환) ────────────────────────────────────

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
  const coreFindings = extractSection(report, 3, "핵심 발견");
  if (coreFindings.length > 0) {
    return coreFindings;
  }

  // 우선순위 2: "### 1. 핵심 한 줄" 섹션 추출
  const headlineSection = extractSection(report, 1, "핵심 한 줄");
  if (headlineSection.length > 0) {
    return headlineSection;
  }

  // fallback: 첫 300자
  const FALLBACK_MAX_CHARS = 300;
  const firstChunk = report.slice(0, FALLBACK_MAX_CHARS).trim();
  if (firstChunk.length === 0) {
    return "";
  }
  return firstChunk.endsWith(".") ? firstChunk : `${firstChunk}...`;
}

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

// ─── 주간 토론 종합 타입 ────────────────────────────────────────────────────

/** 병목 상태 값 — 알려진 4개 + 파싱 실패 시 UNKNOWN */
export type BottleneckStatus = "ACTIVE" | "RESOLVING" | "RESOLVED" | "OVERSUPPLY" | "UNKNOWN";

/** 개별 병목 항목 */
export interface WeeklyBottleneckItem {
  /** 병목 이름 (예: "HBM 공급", "GPU 재고") */
  name: string;
  /** 해당 날짜의 상태 */
  status: BottleneckStatus;
  /** 출처 날짜 */
  date: string;
}

/** 병목 추이 — 주초 vs 주말 */
export interface WeeklyBottleneckTransition {
  name: string;
  initialStatus: BottleneckStatus;
  finalStatus: BottleneckStatus;
  changed: boolean;
}

/** 주간 주도섹터/주도주 합의 항목 */
export interface WeeklyLeadingSectorItem {
  /** 섹터 또는 종목 이름 */
  name: string;
  /** 5일 중 언급된 일수 */
  mentionCount: number;
  /** 전체 세션 수 */
  totalDays: number;
}

/** 주간 과열/위험 경고 항목 */
export interface WeeklyWarningItem {
  /** 경고 대상 (섹터 또는 종목) */
  target: string;
  /** 경고 횟수 */
  warningCount: number;
  /** 전체 세션 수 */
  totalDays: number;
}

/** 주간 토론 종합 결과 */
export interface WeeklyDebateSummary {
  /** 병목 상태 추이 (주초→주말) */
  bottleneckTransitions: WeeklyBottleneckTransition[];
  /** 주도섹터/주도주 합의 (60%+ 언급) */
  leadingSectors: WeeklyLeadingSectorItem[];
  /** 과열/위험 경고 (2회+ 반복) */
  warnings: WeeklyWarningItem[];
  /** 분석 세션 수 */
  sessionCount: number;
}

// ─── 주간 종합용 섹션 추출 (public for testing) ─────────────────────────────

/**
 * 섹션 3(핵심 발견 + 병목 상태)에서 병목 상태를 추출한다.
 * 병목 상태 패턴: "병목이름: STATUS", "병목이름 — STATUS", "**병목이름**: STATUS" 등
 */
export function extractBottleneckStatuses(report: string): Array<{ name: string; status: BottleneckStatus }> {
  const section = extractSection(report, 3, "핵심 발견");
  if (section === "") return [];

  const results: Array<{ name: string; status: BottleneckStatus }> = [];
  const VALID_STATUSES: readonly BottleneckStatus[] = ["ACTIVE", "RESOLVING", "RESOLVED", "OVERSUPPLY"];

  // 패턴 1: "**병목이름**: STATUS" 또는 "병목이름: STATUS"
  const statusPattern = /\*{0,2}([^*\n:]+?)\*{0,2}\s*[:：—]\s*(ACTIVE|RESOLVING|RESOLVED|OVERSUPPLY)/gi;
  let match: RegExpExecArray | null;
  while ((match = statusPattern.exec(section)) !== null) {
    const name = match[1].trim().replace(/^[-•]\s*/, "");
    const status = match[2].toUpperCase() as BottleneckStatus;
    if (name.length > 0 && VALID_STATUSES.includes(status)) {
      results.push({ name, status });
    }
  }

  return results;
}

/**
 * 섹션 4(기회: 주도섹터/주도주)에서 섹터/종목 이름을 추출한다.
 * 테이블 행(| 섹터/종목 | ... |) 또는 "- **이름**:" 패턴을 처리.
 */
export function extractLeadingSectorNames(report: string): string[] {
  const section = extractSection(report, 4, "기회");
  if (section === "") return [];

  const names: string[] = [];
  const seen = new Set<string>();

  // 패턴 1: 마크다운 테이블 행 — | 섹터/종목 | 근거 | 상태 |
  const tableRowPattern = /^\|\s*([^|]+?)\s*\|/gm;
  let match: RegExpExecArray | null;
  while ((match = tableRowPattern.exec(section)) !== null) {
    const raw = match[1].trim().replace(/\*\*/g, "");
    // 헤더/구분선 제외
    if (raw === "" || raw.startsWith("---") || raw === "섹터/종목" || raw === "섹터" || raw === "종목") continue;
    if (!seen.has(raw)) {
      seen.add(raw);
      names.push(raw);
    }
  }

  // 패턴 2: 볼드 텍스트 "**이름**" 또는 "- **이름**:"
  const boldPattern = /\*\*([^*]+?)\*\*/g;
  while ((match = boldPattern.exec(section)) !== null) {
    const raw = match[1].trim();
    // 가드레일/규칙 텍스트 제외
    if (raw.length > 50 || raw.includes("가드레일") || raw.includes("규칙")) continue;
    if (!seen.has(raw)) {
      seen.add(raw);
      names.push(raw);
    }
  }

  return names;
}

/**
 * 섹션 5(경고: 과열/위험 종목)에서 경고 대상을 추출한다.
 */
export function extractWarningTargets(report: string): string[] {
  const section = extractSection(report, 5, "경고");
  if (section === "") return [];

  const targets: string[] = [];
  const seen = new Set<string>();

  // 패턴 1: 볼드 텍스트 "**대상**"
  const boldPattern = /\*\*([^*]+?)\*\*/g;
  let match: RegExpExecArray | null;
  while ((match = boldPattern.exec(section)) !== null) {
    const raw = match[1].trim();
    if (raw.length > 50 || raw.includes("가드레일") || raw.includes("규칙")) continue;
    if (!seen.has(raw)) {
      seen.add(raw);
      targets.push(raw);
    }
  }

  // 패턴 2: "- 대상:" 리스트
  const listPattern = /^[-•]\s*([^:：\n]{2,40})\s*[:：]/gm;
  while ((match = listPattern.exec(section)) !== null) {
    const raw = match[1].trim().replace(/\*\*/g, "");
    if (!seen.has(raw)) {
      seen.add(raw);
      targets.push(raw);
    }
  }

  return targets;
}

/**
 * 여러 세션의 synthesis_report를 종합하여 주간 토론 요약을 생성한다.
 * 빈 세션 배열이면 null 반환.
 *
 * @param sessions - 날짜순 정렬된 세션 배열 (date + synthesisReport)
 * @returns 주간 토론 종합 요약. 세션 없으면 null.
 */
export function aggregateWeeklyDebateInsights(
  sessions: Array<{ date: string; synthesisReport: string }>,
): WeeklyDebateSummary | null {
  if (sessions.length === 0) return null;

  const totalDays = sessions.length;

  // ── 병목 추이 ──
  // 각 세션에서 병목 상태 추출 후, 주초 vs 주말 비교
  const bottleneckByDate = sessions.map((s) => ({
    date: s.date,
    bottlenecks: extractBottleneckStatuses(s.synthesisReport),
  }));

  // 모든 병목 이름 수집
  const allBottleneckNames = new Set<string>();
  for (const entry of bottleneckByDate) {
    for (const b of entry.bottlenecks) {
      allBottleneckNames.add(b.name);
    }
  }

  const bottleneckTransitions: WeeklyBottleneckTransition[] = [];
  for (const name of allBottleneckNames) {
    // 주초 = 첫 번째 세션에서의 상태, 주말 = 마지막 세션에서의 상태
    const firstEntry = bottleneckByDate.find((e) => e.bottlenecks.some((b) => b.name === name));
    const lastEntry = [...bottleneckByDate].reverse().find((e) => e.bottlenecks.some((b) => b.name === name));

    const initialStatus: BottleneckStatus = firstEntry?.bottlenecks.find((b) => b.name === name)?.status ?? "UNKNOWN";
    const finalStatus: BottleneckStatus = lastEntry?.bottlenecks.find((b) => b.name === name)?.status ?? "UNKNOWN";

    bottleneckTransitions.push({
      name,
      initialStatus,
      finalStatus,
      changed: initialStatus !== finalStatus,
    });
  }

  // ── 주도섹터/주도주 합의 ──
  // 각 세션에서 언급된 섹터/종목을 카운트 → 60%+ 기준
  const sectorMentionCount = new Map<string, number>();
  for (const session of sessions) {
    const names = extractLeadingSectorNames(session.synthesisReport);
    const uniqueNames = new Set(names);
    for (const name of uniqueNames) {
      sectorMentionCount.set(name, (sectorMentionCount.get(name) ?? 0) + 1);
    }
  }

  const CONSENSUS_THRESHOLD = 0.6;
  const minMentions = Math.ceil(totalDays * CONSENSUS_THRESHOLD);
  const leadingSectors: WeeklyLeadingSectorItem[] = [];
  for (const [name, count] of sectorMentionCount) {
    if (count >= minMentions) {
      leadingSectors.push({ name, mentionCount: count, totalDays });
    }
  }
  leadingSectors.sort((a, b) => b.mentionCount - a.mentionCount);

  // ── 과열 경고 ──
  // 2회 이상 반복 경고된 대상
  const warningMentionCount = new Map<string, number>();
  for (const session of sessions) {
    const targets = extractWarningTargets(session.synthesisReport);
    const uniqueTargets = new Set(targets);
    for (const target of uniqueTargets) {
      warningMentionCount.set(target, (warningMentionCount.get(target) ?? 0) + 1);
    }
  }

  const MIN_WARNING_COUNT = 2;
  const warnings: WeeklyWarningItem[] = [];
  for (const [target, count] of warningMentionCount) {
    if (count >= MIN_WARNING_COUNT) {
      warnings.push({ target, warningCount: count, totalDays });
    }
  }
  warnings.sort((a, b) => b.warningCount - a.warningCount);

  return {
    bottleneckTransitions,
    leadingSectors,
    warnings,
    sessionCount: totalDays,
  };
}

/**
 * WeeklyDebateSummary를 프롬프트 주입용 텍스트로 포매팅한다.
 * 3,000자 이내로 제한.
 */
export function formatWeeklyDebateForPrompt(summary: WeeklyDebateSummary): string {
  const lines: string[] = [];

  lines.push(`## 주간 토론 종합 (${summary.sessionCount}세션)`);
  lines.push("");

  // 병목 추이
  if (summary.bottleneckTransitions.length > 0) {
    lines.push("### 병목 상태 변화 (주초→주말)");
    for (const bt of summary.bottleneckTransitions) {
      const arrow = bt.changed ? "→" : "=";
      const marker = bt.changed ? " ⚡" : "";
      lines.push(`- ${bt.name}: ${bt.initialStatus} ${arrow} ${bt.finalStatus}${marker}`);
    }
    lines.push("");
  }

  // 주도섹터 합의
  if (summary.leadingSectors.length > 0) {
    lines.push("### 주간 주도섹터/주도주 합의");
    for (const ls of summary.leadingSectors) {
      lines.push(`- ${ls.name}: ${ls.mentionCount}/${ls.totalDays}일 언급`);
    }
    lines.push("");
  }

  // 과열 경고
  if (summary.warnings.length > 0) {
    lines.push("### 반복 과열/위험 경고");
    for (const w of summary.warnings) {
      lines.push(`- ${w.target}: ${w.warningCount}/${w.totalDays}일 경고`);
    }
    lines.push("");
  }

  // 데이터 없는 경우
  if (
    summary.bottleneckTransitions.length === 0 &&
    summary.leadingSectors.length === 0 &&
    summary.warnings.length === 0
  ) {
    lines.push("이번 주 토론에서 구조화 추출 가능한 데이터가 없습니다.");
    lines.push("");
  }

  const MAX_PROMPT_CHARS = 3_000;
  const result = lines.join("\n");
  return result.length > MAX_PROMPT_CHARS ? result.slice(0, MAX_PROMPT_CHARS) + "\n..." : result;
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

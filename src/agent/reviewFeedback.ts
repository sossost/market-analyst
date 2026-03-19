import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewVerdict = "OK" | "REVISE" | "REJECT";

export interface ReviewFeedbackEntry {
  date: string;
  verdict: ReviewVerdict;
  feedback: string;
  issues: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FEEDBACK_COUNT = 5;
const FEEDBACK_DIR = join(process.cwd(), "data", "review-feedback");
const REPEATED_PATTERN_THRESHOLD = 2;
const RECENT_FEEDBACK_FOR_PATTERNS = 10;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 리뷰 피드백을 JSON 파일로 저장한다.
 * 파일명: {date}.json (같은 날짜면 덮어쓰기)
 */
export function saveReviewFeedback(
  entry: ReviewFeedbackEntry,
  dir: string = FEEDBACK_DIR,
): void {
  ensureDir(dir);
  const filePath = join(dir, `${entry.date}.json`);
  writeFileSync(filePath, JSON.stringify(entry, null, 2), "utf-8");
}

/**
 * 최근 N회의 피드백을 로드한다 (date 역순).
 * OK 판정은 저장하지 않으므로, 로드된 엔트리는 모두 REVISE 또는 REJECT이다.
 */
export function loadRecentFeedback(
  count: number = DEFAULT_FEEDBACK_COUNT,
  dir: string = FEEDBACK_DIR,
): ReviewFeedbackEntry[] {
  if (!existsSync(dir)) {
    return [];
  }

  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, count);

  return files.flatMap((f) => {
    try {
      const content = readFileSync(join(dir, f), "utf-8");
      return [JSON.parse(content) as ReviewFeedbackEntry];
    } catch {
      logger.warn("ReviewFeedback", `Skipping corrupt file: ${f}`);
      return [];
    }
  });
}

// ---------------------------------------------------------------------------
// Pattern detection types
// ---------------------------------------------------------------------------

export interface RepeatedPattern {
  pattern: string;
  count: number;
  rule: string;
}

// ---------------------------------------------------------------------------
// Keyword extraction & clustering
// ---------------------------------------------------------------------------

/**
 * 이슈 문자열에서 핵심 키워드를 추출한다.
 * 한글/영문 2글자 이상의 단어를 정규화하여 반환.
 */
function extractKeywords(issue: string): string[] {
  const normalized = issue.toLowerCase().trim();
  // 한글 2글자 이상 또는 영문 3글자 이상의 단어 추출
  const words = normalized.match(/[가-힣]{2,}|[a-z]{3,}/g) ?? [];
  return words;
}

/**
 * 두 이슈 문자열이 유사한지 판별한다.
 * 핵심 키워드가 2개 이상 겹치거나, 짧은 이슈에서 50% 이상 겹치면 유사.
 */
function areIssuesSimilar(a: string, b: string): boolean {
  const keywordsA = extractKeywords(a);
  const keywordsB = extractKeywords(b);

  if (keywordsA.length === 0 || keywordsB.length === 0) {
    return false;
  }

  const setB = new Set(keywordsB);
  const overlap = keywordsA.filter((kw) => setB.has(kw)).length;
  const minLength = Math.min(keywordsA.length, keywordsB.length);

  const MIN_OVERLAP = 2;
  const OVERLAP_RATIO = 0.5;

  return overlap >= MIN_OVERLAP || overlap / minLength >= OVERLAP_RATIO;
}

// ---------------------------------------------------------------------------
// Public API — pattern detection
// ---------------------------------------------------------------------------

/**
 * 최근 피드백에서 반복 패턴(2회+)을 감지한다.
 * 유사한 이슈를 클러스터링하고, 임계값 이상 반복된 패턴을 규칙으로 변환.
 */
export function detectRepeatedPatterns(
  entries: ReviewFeedbackEntry[],
  threshold: number = REPEATED_PATTERN_THRESHOLD,
): RepeatedPattern[] {
  // 모든 이슈를 수집 (중복 제거: 같은 날의 동일 이슈)
  const allIssues: string[] = [];
  for (const entry of entries) {
    for (const issue of entry.issues) {
      allIssues.push(issue);
    }
  }

  if (allIssues.length === 0) {
    return [];
  }

  // 클러스터링: 첫 번째 이슈를 대표로 두고 유사 이슈를 묶기
  const clusters: { representative: string; members: string[] }[] = [];

  for (const issue of allIssues) {
    let matched = false;
    for (const cluster of clusters) {
      if (areIssuesSimilar(issue, cluster.representative)) {
        cluster.members.push(issue);
        matched = true;
        break;
      }
    }
    if (!matched) {
      clusters.push({ representative: issue, members: [issue] });
    }
  }

  // 임계값 이상인 클러스터만 반복 패턴으로 변환
  return clusters
    .filter((cluster) => cluster.members.length >= threshold)
    .map((cluster) => ({
      pattern: cluster.representative,
      count: cluster.members.length,
      rule: `${cluster.representative} (과거 ${cluster.members.length}회 지적)`,
    }));
}

// ---------------------------------------------------------------------------
// Public API — layered prompt builders
// ---------------------------------------------------------------------------

/**
 * 반복 패턴(2회+)을 필수 규칙 형태로 변환한다.
 * 프롬프트 상단(규칙 섹션 근처)에 삽입하기 위한 텍스트.
 */
export function buildMandatoryRules(
  entries: ReviewFeedbackEntry[],
): string {
  const patterns = detectRepeatedPatterns(entries);

  if (patterns.length === 0) {
    return "";
  }

  const header = `## 필수 규칙 (반복 지적 기반)

아래는 과거 리뷰에서 2회 이상 반복 지적된 사항입니다. 반드시 준수하세요. 위반 시 리포트가 거부됩니다.`;

  const ruleLines = patterns.map((p) => `- ${p.rule}`).join("\n");

  return `${header}\n\n${ruleLines}`;
}

/**
 * 반복 패턴이 아닌 피드백만 참고사항으로 변환한다.
 * 프롬프트 하단에 삽입하기 위한 텍스트.
 */
export function buildAdvisoryFeedback(
  entries: ReviewFeedbackEntry[],
): string {
  const patterns = detectRepeatedPatterns(entries);
  const patternRepresentatives = new Set(patterns.map((p) => p.pattern));

  // 반복 패턴에 해당하지 않는 이슈만 필터링
  const advisoryEntries = entries
    .map((entry) => {
      const nonRepeatedIssues = entry.issues.filter((issue) => {
        for (const rep of patternRepresentatives) {
          if (areIssuesSimilar(issue, rep)) {
            return false;
          }
        }
        return true;
      });
      return { ...entry, issues: nonRepeatedIssues };
    })
    .filter((entry) => entry.issues.length > 0);

  if (advisoryEntries.length === 0) {
    return "";
  }

  const header = `## 과거 리뷰 피드백 (참고사항)

아래는 이전 리포트에 대한 리뷰어의 지적사항입니다. 참고하여 리포트 품질을 개선하세요.`;

  const items = advisoryEntries.map((e) => {
    const issueLines = e.issues.map((issue) => `- ${issue}`).join("\n");
    return `### ${e.date} (${e.verdict})\n${e.feedback}\n${issueLines}`;
  });

  return `${header}\n\n${items.join("\n\n")}`;
}

/**
 * 피드백 엔트리들을 시스템 프롬프트에 주입할 텍스트로 변환한다.
 * 하위호환을 위해 기존 API를 유지하되, 내부적으로 반복 패턴 감지를 활용한다.
 */
export function buildFeedbackPromptSection(
  entries: ReviewFeedbackEntry[],
): string {
  if (entries.length === 0) {
    return "";
  }

  const mandatory = buildMandatoryRules(entries);
  const advisory = buildAdvisoryFeedback(entries);

  // 반복 패턴이 있으면 필수 규칙 + 참고사항, 없으면 기존 형태
  if (mandatory !== "") {
    const parts = [mandatory];
    if (advisory !== "") {
      parts.push(advisory);
    }
    return parts.join("\n\n");
  }

  // 반복 패턴 없음 — 기존 형태 유지
  const header = `## 과거 리뷰 피드백 (최근 ${entries.length}회)

아래는 이전 리포트에 대한 리뷰어의 지적사항입니다. 이번 리포트 작성 시 반드시 반영하세요.`;

  const items = entries.map((e) => {
    const issueLines = e.issues.map((issue) => `- ${issue}`).join("\n");
    return `### ${e.date} (${e.verdict})\n${e.feedback}\n${issueLines}`;
  });

  return `${header}\n\n${items.join("\n\n")}`;
}

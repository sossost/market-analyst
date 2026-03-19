import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewVerdict = "OK" | "REVISE" | "REJECT";

/** 피드백을 분리 저장할 리포트 타입 */
export type FeedbackReportType = "daily" | "weekly" | "debate" | "fundamental";

export interface ReviewFeedbackEntry {
  date: string;
  verdict: ReviewVerdict;
  feedback: string;
  issues: string[];
  /** 리포트 타입 — 타입별 서브디렉토리에 분리 저장 */
  reportType?: FeedbackReportType;
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
 * 피드백 저장 디렉토리를 결정한다.
 * reportType이 있으면 서브디렉토리, 없으면 기본 디렉토리.
 */
function resolveFeedbackDir(
  baseDir: string,
  reportType?: FeedbackReportType,
): string {
  if (reportType == null) return baseDir;
  return join(baseDir, reportType);
}

/**
 * 리뷰 피드백을 JSON 파일로 저장한다.
 * reportType이 있으면 타입별 서브디렉토리에 저장.
 * 파일명: {date}.json (같은 날짜면 덮어쓰기)
 */
export function saveReviewFeedback(
  entry: ReviewFeedbackEntry,
  dir: string = FEEDBACK_DIR,
): void {
  const targetDir = resolveFeedbackDir(dir, entry.reportType);
  ensureDir(targetDir);
  const filePath = join(targetDir, `${entry.date}.json`);
  writeFileSync(filePath, JSON.stringify(entry, null, 2), "utf-8");
}

/**
 * 최근 N회의 피드백을 로드한다 (date 역순).
 * reportType을 지정하면 해당 타입의 서브디렉토리에서 로드.
 * 지정하지 않으면 기본 디렉토리(레거시 호환).
 */
export function loadRecentFeedback(
  count: number = DEFAULT_FEEDBACK_COUNT,
  dir: string = FEEDBACK_DIR,
  reportType?: FeedbackReportType,
): ReviewFeedbackEntry[] {
  const targetDir = resolveFeedbackDir(dir, reportType);
  if (!existsSync(targetDir)) {
    return [];
  }

  const files = readdirSync(targetDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, count);

  return files.flatMap((f) => {
    try {
      const content = readFileSync(join(targetDir, f), "utf-8");
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

// ---------------------------------------------------------------------------
// Public API — verdict statistics
// ---------------------------------------------------------------------------

export interface VerdictStats {
  total: number;
  ok: number;
  revise: number;
  reject: number;
  /** OK / total — 발송 성공률 */
  okRate: number;
}

/**
 * 최근 피드백에서 판정 통계를 계산한다.
 * OK 판정이 저장되어야 의미 있는 결과를 반환한다.
 */
export function getVerdictStats(
  entries: ReviewFeedbackEntry[],
): VerdictStats {
  const total = entries.length;
  let ok = 0;
  let revise = 0;
  let reject = 0;

  for (const entry of entries) {
    switch (entry.verdict) {
      case "OK":
        ok++;
        break;
      case "REVISE":
        revise++;
        break;
      case "REJECT":
        reject++;
        break;
    }
  }

  const okRate = total > 0 ? ok / total : 0;

  return { total, ok, revise, reject, okRate };
}

// ---------------------------------------------------------------------------
// Migration — legacy flat feedback → type-specific subdirectories
// ---------------------------------------------------------------------------

/**
 * 기존 플랫 디렉토리의 피드백 파일을 지정 타입의 서브디렉토리로 이동한다.
 * 이미 서브디렉토리에 같은 파일이 있으면 스킵.
 * 원본 파일은 이동 후 삭제한다.
 */
export function migrateFeedbackToType(
  targetType: FeedbackReportType,
  dir: string = FEEDBACK_DIR,
): number {
  if (!existsSync(dir)) return 0;

  const files = readdirSync(dir).filter((f) =>
    /^\d{4}-\d{2}-\d{2}\.json$/.test(f),
  );

  if (files.length === 0) return 0;

  const targetDir = join(dir, targetType);
  ensureDir(targetDir);

  let migrated = 0;
  for (const f of files) {
    const srcPath = join(dir, f);
    const destPath = join(targetDir, f);

    if (existsSync(destPath)) {
      logger.info("Migration", `Skipping ${f} — already exists in ${targetType}/`);
      continue;
    }

    try {
      const content = readFileSync(srcPath, "utf-8");
      const entry = JSON.parse(content) as ReviewFeedbackEntry;
      entry.reportType = targetType;
      writeFileSync(destPath, JSON.stringify(entry, null, 2), "utf-8");
      unlinkSync(srcPath);
      migrated++;
    } catch {
      logger.warn("Migration", `Failed to migrate ${f}`);
    }
  }

  logger.info("Migration", `Migrated ${migrated}/${files.length} files to ${targetType}/`);
  return migrated;
}

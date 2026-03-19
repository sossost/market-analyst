/**
 * 종목 리포트 QA 검출 시스템 (#229).
 *
 * 발행 직후 호출되는 패턴 기반 QA. LLM 없음 — 정규식/문자열 분석만.
 * 검출만 한다 — 리포트를 수정하지 않고, 발행 흐름을 막지 않는다.
 * 문제 발견 시 GitHub 이슈 자동 생성 (report-feedback 라벨).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../logger.js";
import { saveReviewFeedback } from "../reviewFeedback.js";

const execFileAsync = promisify(execFile);

// ─── 체크 ID 상수 ─────────────────────────────────────────────────────

const CHECK_MARGIN_RAW_DECIMAL = "MARGIN_RAW_DECIMAL";
const CHECK_SECTION_MISSING = "SECTION_MISSING";
const CHECK_NO_RISK_MENTION = "NO_RISK_MENTION";
const CHECK_EPS_INCONSISTENCY = "EPS_INCONSISTENCY";

// 섹션 누락 탐지: S등급 리포트 필수 5개 섹션
const REQUIRED_SECTION_NUMBERS = ["1", "2", "3", "4", "5"] as const;

// 리스크 미언급 — 하나라도 있으면 통과
const RISK_MENTION_KEYWORDS = [
  "리스크",
  "주의",
  "모멘텀 둔화",
  "경고",
  "확인 필요",
] as const;

// ─── 인터페이스 ──────────────────────────────────────────────────────

export interface QAIssue {
  checkId: string;
  severity: "HIGH" | "MEDIUM";
  description: string;
}

export interface QAResult {
  symbol: string;
  date: string;
  passed: boolean; // 이슈 0개이면 true
  issues: QAIssue[];
}

// ─── 순수 검출 함수 ──────────────────────────────────────────────────

/**
 * 종목 리포트 마크다운에 대해 패턴 기반 QA를 수행.
 * 순수 함수 — 비동기 없음, 외부 의존 없음.
 */
export function runStockReportQA(symbol: string, reportMd: string): QAResult {
  const date = new Date().toISOString().slice(0, 10);
  const issues: QAIssue[] = [
    checkMarginRawDecimal(reportMd),
    checkSectionMissing(reportMd),
    checkNoRiskMention(reportMd),
    checkEpsInconsistency(reportMd),
  ].filter((issue): issue is QAIssue => issue != null);

  return {
    symbol,
    date,
    passed: issues.length === 0,
    issues,
  };
}

// ─── 개별 체크 함수 ──────────────────────────────────────────────────

/**
 * 이익률 열에 소수점 미변환 값(0.1~0.9 범위)이 있는지 탐지.
 *
 * 정상: `| 23.5% |`
 * 이상: `| 0.235 |`
 *
 * 테이블 셀 패턴: 파이프로 둘러싸인 `0.숫자` 형태.
 * 단, 이익률 0% 미만(음수) 또는 100% 초과 케이스는 다른 문법이므로 제외.
 */
function checkMarginRawDecimal(reportMd: string): QAIssue | null {
  // 테이블 셀에서 `| 0.숫자 |` 패턴 탐색
  // 0.10 ~ 0.99 범위 — 소수점 미변환 이익률 의심
  const pattern = /\|\s*0\.[1-9]\d*\s*\|/g;
  const match = pattern.exec(reportMd);
  if (match == null) return null;

  return {
    checkId: CHECK_MARGIN_RAW_DECIMAL,
    severity: "HIGH",
    description: `이익률 열에 소수점 미변환 값 발견: \`${match[0].trim()}\` — 퍼센트 변환이 적용되지 않았을 가능성`,
  };
}

/**
 * 필수 5개 섹션(`## 1.`~`## 5.`)이 모두 존재하는지 확인.
 *
 * S등급 리포트는 technical 데이터를 항상 포함하므로 5개 섹션을 기대.
 */
function checkSectionMissing(reportMd: string): QAIssue | null {
  const missingSections: string[] = [];

  for (const num of REQUIRED_SECTION_NUMBERS) {
    // `## 1.`, `## 2.` 등 섹션 헤더 패턴
    const sectionPattern = new RegExp(`^##\\s+${num}\\.`, "m");
    if (!sectionPattern.test(reportMd)) {
      missingSections.push(`## ${num}.`);
    }
  }

  if (missingSections.length === 0) return null;

  return {
    checkId: CHECK_SECTION_MISSING,
    severity: "HIGH",
    description: `필수 섹션 누락: ${missingSections.join(", ")} — 리포트 구조가 불완전할 수 있음`,
  };
}

/**
 * 리스크/주의 관련 키워드가 하나도 없으면 플래그.
 *
 * S등급이라도 리스크 서술이 없으면 독자 판단을 왜곡할 수 있다.
 */
function checkNoRiskMention(reportMd: string): QAIssue | null {
  const hasRiskMention = RISK_MENTION_KEYWORDS.some((keyword) =>
    reportMd.includes(keyword),
  );

  if (hasRiskMention) return null;

  return {
    checkId: CHECK_NO_RISK_MENTION,
    severity: "HIGH",
    description: `리스크/주의 관련 키워드(${RISK_MENTION_KEYWORDS.join(", ")})가 전혀 없음 — S등급 종목에도 리스크 서술 필수`,
  };
}

/**
 * 분기별 실적 테이블에 데이터 행이 없으면 EPS 구조 이상으로 플래그.
 *
 * 테이블 헤더(분기|EPS|...) 다음에 구분선 행(`|---|...`) 이후
 * 실제 데이터 행이 0개이면 이상.
 */
function checkEpsInconsistency(reportMd: string): QAIssue | null {
  // 분기별 실적 테이블 헤더 탐색
  const tableHeaderPattern = /\|\s*분기\s*\|\s*EPS\s*\|/;
  if (!tableHeaderPattern.test(reportMd)) return null;

  // 테이블 헤더 위치 이후 구분선 행(`|---|`) 탐색
  const headerMatch = tableHeaderPattern.exec(reportMd);
  if (headerMatch == null) return null;

  const afterHeader = reportMd.slice(headerMatch.index + headerMatch[0].length);

  // 구분선 행 탐색: `|---|` 패턴
  const separatorPattern = /^\s*\|[\s-|]+\|/m;
  const separatorMatch = separatorPattern.exec(afterHeader);
  if (separatorMatch == null) return null;

  // 구분선 이후 첫 번째 실제 데이터 행 탐색
  const afterSeparator = afterHeader.slice(
    separatorMatch.index + separatorMatch[0].length,
  );

  // 데이터 행: `|` 로 시작하는 비어있지 않은 행
  const dataRowPattern = /^\s*\|[^|]+\|/m;
  const hasDataRow = dataRowPattern.test(afterSeparator);

  if (hasDataRow) return null;

  return {
    checkId: CHECK_EPS_INCONSISTENCY,
    severity: "HIGH",
    description: `분기별 실적 테이블에 데이터 행이 없음 — EPS/매출 실적 데이터 누락 의심`,
  };
}

// ─── GitHub 이슈 생성 ────────────────────────────────────────────────

/**
 * 같은 날짜+종목의 기존 이슈 번호를 검색한다.
 * 없으면 null 반환. gh CLI 실패 시에도 null 반환.
 */
export async function findExistingQAIssue(
  symbol: string,
  date: string,
): Promise<number | null> {
  try {
    const searchQuery = `[QA] ${symbol} 리포트 품질 이슈 (${date})`;
    const { stdout } = await execFileAsync("gh", [
      "issue",
      "list",
      "--label",
      "report-feedback",
      "--search",
      searchQuery,
      "--json",
      "number,title",
      "--limit",
      "5",
    ]);
    const issues = JSON.parse(stdout) as Array<{ number: number; title: string }>;
    const exactTitle = `[QA] ${symbol} 리포트 품질 이슈 (${date})`;
    const match = issues.find((i) => i.title === exactTitle);
    return match?.number ?? null;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("StockReportQA", `기존 QA 이슈 검색 실패 (${symbol}, ${date}): ${reason}`);
    return null;
  }
}

/**
 * QA 결과를 피드백 시스템에 저장한다.
 * 다음 리포트 생성 시 프롬프트에 반영되도록 saveReviewFeedback 호출.
 */
export function bridgeQAToFeedback(result: QAResult): void {
  if (result.passed) return;

  const issueDescriptions = result.issues.map((i) => `[${i.checkId}] ${i.description}`);

  saveReviewFeedback({
    date: result.date,
    verdict: "REVISE",
    feedback: `${result.symbol} 종목 리포트 QA에서 ${result.issues.length}건 이슈 검출`,
    issues: issueDescriptions,
  });

  logger.info(
    "StockReportQA",
    `${result.symbol} 피드백 시스템에 저장 완료 (${result.issues.length}건)`,
  );
}

/**
 * QA 결과를 GitHub 이슈로 생성하고 피드백 시스템에 연결한다.
 * `result.passed === true`이면 no-op.
 * 같은 날짜+종목 이슈가 이미 있으면 코멘트 추가 (중복 방지).
 * `gh` CLI 실패 시 warn 로그만 기록하고 반환 — 발행 흐름을 막지 않음.
 */
export async function reportQAIssueToGitHub(result: QAResult): Promise<void> {
  if (result.passed) return;

  // 피드백 시스템에 저장 (프롬프트 주입용)
  bridgeQAToFeedback(result);

  const title = `[QA] ${result.symbol} 리포트 품질 이슈 (${result.date})`;
  const body = buildIssueBody(result);

  try {
    // 중복 방지: 같은 날짜+종목 이슈가 있으면 코멘트 추가
    const existingIssueNumber = await findExistingQAIssue(result.symbol, result.date);

    if (existingIssueNumber != null) {
      await execFileAsync("gh", [
        "issue",
        "comment",
        String(existingIssueNumber),
        "--body",
        `## 추가 QA 결과\n\n${body}`,
      ]);
      logger.info(
        "StockReportQA",
        `${result.symbol} 기존 이슈 #${existingIssueNumber}에 코멘트 추가`,
      );
      return;
    }

    await execFileAsync("gh", [
      "issue",
      "create",
      "--title",
      title,
      "--body",
      body,
      "--label",
      "report-feedback",
    ]);
    logger.info(
      "StockReportQA",
      `${result.symbol} GitHub 이슈 생성 완료 (${result.issues.length}개 이슈)`,
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(
      "StockReportQA",
      `${result.symbol} GitHub 이슈 생성 실패 (계속 진행): ${reason}`,
    );
  }
}

/**
 * QA 결과를 GitHub 이슈 본문 마크다운으로 포맷.
 */
function buildIssueBody(result: QAResult): string {
  const severityEmoji = (severity: "HIGH" | "MEDIUM"): string =>
    severity === "HIGH" ? "🔴" : "🟡";

  const issueLines = result.issues.map(
    (issue) =>
      `- [x] ${severityEmoji(issue.severity)} **[${issue.checkId}]** ${issue.description}`,
  );

  return [
    `## ${result.symbol} 리포트 QA 결과 (${result.date})`,
    "",
    `검출된 이슈: **${result.issues.length}개**`,
    "",
    "### 이슈 목록",
    "",
    ...issueLines,
    "",
    "---",
    "",
    "> 자동 생성 — `runStockReportQA` (#229)",
    "> 이 이슈는 리포트를 무효화하지 않습니다. 프롬프트/로직 개선을 위한 축적용입니다.",
  ].join("\n");
}

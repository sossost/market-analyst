/**
 * 주간 시스템 감사 스크립트.
 * 데이터 무결성, 코드-DB 정합성, 파이프라인 연결성, 테스트/빌드를 자동 점검하고
 * 발견된 문제를 GitHub 이슈로 생성한다.
 *
 * 실행: npx tsx src/scripts/weekly-system-audit.ts
 * 스케줄: 토요일 KST 06:00 (launchd)
 */

import "dotenv/config";
import { pool } from "@/db/client";
import { logger } from "@/lib/logger";
import { execSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// ─── 타입 ───────────────────────────────────────────────────

export interface AuditFinding {
  category: "data-integrity" | "code-db-consistency" | "pipeline-connectivity" | "test-build";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  title: string;
  detail: string;
}

export interface AuditResult {
  findings: AuditFinding[];
  summary: { total: number; critical: number; high: number; medium: number; low: number };
}

// ─── 상수 ───────────────────────────────────────────────────

const STALE_THRESHOLD_DAYS = 7;
const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");

// ─── 1. 데이터 무결성 검증 ──────────────────────────────────

export async function checkDataIntegrity(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // 1-1. daily_prices 주말 레코드
  const weekendRows = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM daily_prices
     WHERE EXTRACT(DOW FROM date::date) IN (0, 6)
     AND date::date > CURRENT_DATE - INTERVAL '30 days'`,
  );
  const weekendCount = parseInt(weekendRows.rows[0].cnt, 10);
  if (weekendCount > 0) {
    findings.push({
      category: "data-integrity",
      severity: "HIGH",
      title: "daily_prices에 주말 날짜 레코드 존재",
      detail: `최근 30일 내 주말 레코드 ${weekendCount}건 발견. 주말 데이터가 유입되면 MA/RS 계산이 왜곡된다.`,
    });
  }

  // 1-2. tracked_stocks ACTIVE인데 trajectory/current null
  const nullTrajectory = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM tracked_stocks
     WHERE status = 'ACTIVE'
     AND (phase_trajectory IS NULL OR current_phase IS NULL OR current_rs_score IS NULL)`,
  );
  const nullCount = parseInt(nullTrajectory.rows[0].cnt, 10);
  if (nullCount > 0) {
    findings.push({
      category: "data-integrity",
      severity: "HIGH",
      title: "tracked_stocks ACTIVE 종목에 null 필드 존재",
      detail: `phase_trajectory/current_phase/current_rs_score가 NULL인 ACTIVE 종목 ${nullCount}건. 궤적 추적 및 리포트 생성 시 오류 발생 가능.`,
    });
  }

  // 1-3. narrative_chains megatrend=bottleneck 오염
  const bottleneckPollution = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM narrative_chains
     WHERE megatrend = bottleneck_node`,
  );
  const pollutionCount = parseInt(bottleneckPollution.rows[0].cnt, 10);
  if (pollutionCount > 0) {
    findings.push({
      category: "data-integrity",
      severity: "MEDIUM",
      title: "narrative_chains에 megatrend=bottleneck 오염 레코드 존재",
      detail: `megatrend와 bottleneck_node가 동일한 레코드 ${pollutionCount}건. 서사 체인 분석의 정확도가 저하된다.`,
    });
  }

  // 1-4. fundamental_scores stale 체크
  const staleScores = await pool.query<{ latest_date: string | null }>(
    `SELECT MAX(scored_date) as latest_date FROM fundamental_scores`,
  );
  const latestDate = staleScores.rows[0].latest_date;
  if (latestDate == null) {
    findings.push({
      category: "data-integrity",
      severity: "CRITICAL",
      title: "fundamental_scores 테이블이 비어 있음",
      detail: "MAX(scored_date)가 NULL — 스코어링 ETL이 한 번도 실행되지 않았거나 모든 레코드가 삭제됨.",
    });
  } else {
    const daysSinceScored = Math.floor(
      (Date.now() - new Date(latestDate).getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysSinceScored > STALE_THRESHOLD_DAYS) {
      findings.push({
        category: "data-integrity",
        severity: "HIGH",
        title: "fundamental_scores가 stale 상태",
        detail: `최신 scored_date: ${latestDate} (${daysSinceScored}일 전). ${STALE_THRESHOLD_DAYS}일 이상 갱신되지 않으면 SEPA 게이트가 무의미해진다.`,
      });
    }
  }

  return findings;
}

// ─── 2. 코드-DB 정합성 검증 ─────────────────────────────────

export function checkCodeDbConsistency(): AuditFinding[] {
  const findings: AuditFinding[] = [];

  // 2-1. Shell Companies 필터 존재 여부 (stockPhaseRepository에 있어야 함)
  const shellFilterExists = fileContains(
    path.join(PROJECT_ROOT, "src/db/repositories/stockPhaseRepository.ts"),
    "Shell Companies",
  );
  if (!shellFilterExists) {
    findings.push({
      category: "code-db-consistency",
      severity: "CRITICAL",
      title: "stockPhaseRepository에 Shell Companies 필터 누락",
      detail: "Shell Companies 필터가 없으면 SPAC 종목이 Phase 2 포착에 유입되어 오탐이 발생한다.",
    });
  }

  // 2-2. 전략 리뷰 프롬프트가 deprecated 테이블 참조하는지
  const promptContent = safeReadFile(
    path.join(PROJECT_ROOT, "scripts/strategic-review-prompt.md"),
  );
  if (promptContent != null) {
    const deprecatedTables = ["FROM recommendations", "FROM watchlist_stocks"];
    for (const table of deprecatedTables) {
      if (promptContent.includes(table)) {
        findings.push({
          category: "code-db-consistency",
          severity: "HIGH",
          title: `전략 리뷰 프롬프트가 deprecated 테이블 참조: ${table}`,
          detail: `scripts/strategic-review-prompt.md에서 ${table}을 사용 중. tracked_stocks로 교체 필요.`,
        });
      }
    }
  }

  // 2-3. src/ 내 코드가 deprecated 테이블을 직접 참조하는지
  const deprecatedRefs = grepInDir(
    path.join(PROJECT_ROOT, "src"),
    /FROM\s+(recommendations|watchlist_stocks)\b/,
    ["*.ts"],
  );
  if (deprecatedRefs.length > 0) {
    findings.push({
      category: "code-db-consistency",
      severity: "MEDIUM",
      title: "src/ 코드가 deprecated 테이블을 SQL로 참조",
      detail: `${deprecatedRefs.length}건 발견: ${deprecatedRefs.slice(0, 5).join(", ")}. 이관이 완료되었다면 tracked_stocks로 교체 필요.`,
    });
  }

  return findings;
}

// ─── 3. 파이프라인 연결성 검증 ──────────────────────────────

export async function checkPipelineConnectivity(): Promise<AuditFinding[]> {
  const findings: AuditFinding[] = [];

  // 3-1. thesis_aligned 소스 종목 존재 여부
  const thesisAligned = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM tracked_stocks WHERE source = 'thesis_aligned'`,
  );
  const thesisCount = parseInt(thesisAligned.rows[0].cnt, 10);
  // thesis_aligned 경로가 존재하지만 한 번도 사용되지 않았다면 연동 검증 필요
  const scanFileExists = fileContains(
    path.join(PROJECT_ROOT, "src/etl/jobs/scan-thesis-aligned-candidates.ts"),
    "thesis_aligned",
  );
  if (scanFileExists && thesisCount === 0) {
    findings.push({
      category: "pipeline-connectivity",
      severity: "MEDIUM",
      title: "thesis_aligned 경로에 등록된 종목이 0건",
      detail: "scan-thesis-aligned-candidates.ts가 존재하지만 tracked_stocks에 thesis_aligned 종목이 없음. 파이프라인이 연결되었는지 확인 필요.",
    });
  }

  // 3-2. 최근 7일 일간 리포트의 reported_symbols 빈 배열 여부
  const emptyReports = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM daily_reports
     WHERE type = 'daily'
     AND report_date > (CURRENT_DATE - INTERVAL '7 days')::text
     AND (reported_symbols IS NULL OR reported_symbols::text = '[]')`,
  );
  const emptyCount = parseInt(emptyReports.rows[0].cnt, 10);
  if (emptyCount > 0) {
    findings.push({
      category: "pipeline-connectivity",
      severity: "HIGH",
      title: "최근 일간 리포트에 reported_symbols 빈 배열",
      detail: `최근 7일 내 ${emptyCount}건의 일간 리포트에 추천 종목이 없음. 포착 파이프라인 장애 가능성.`,
    });
  }

  // 3-3. failure_patterns가 존재하는지 (collect-failure-patterns ETL이 돌았는지)
  const failurePatterns = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM failure_patterns
     WHERE created_at > NOW() - INTERVAL '30 days'`,
  );
  const fpCount = parseInt(failurePatterns.rows[0].cnt, 10);
  if (fpCount === 0) {
    findings.push({
      category: "pipeline-connectivity",
      severity: "MEDIUM",
      title: "최근 30일 failure_patterns 데이터 없음",
      detail: "collect-failure-patterns ETL이 실행되지 않았거나 실패 패턴이 수집되지 않고 있음.",
    });
  }

  return findings;
}

// ─── 4. 테스트/빌드 검증 ────────────────────────────────────

export function checkTestBuild(): AuditFinding[] {
  const findings: AuditFinding[] = [];

  // 4-1. TypeScript 타입 체크
  try {
    execSync("npx tsc --noEmit", { cwd: PROJECT_ROOT, timeout: 120_000, stdio: "pipe" });
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? "";
    const errorLines = stderr.split("\n").filter((l) => l.includes("error TS")).length;
    findings.push({
      category: "test-build",
      severity: "HIGH",
      title: "TypeScript 타입 체크 실패",
      detail: `tsc --noEmit 실패. 에러 ${errorLines}건.`,
    });
  }

  // 4-2. 테스트 실행
  try {
    execSync("npx vitest run --reporter=json", {
      cwd: PROJECT_ROOT,
      timeout: 300_000,
      stdio: "pipe",
    });
  } catch (err) {
    const stdout = (err as { stdout?: Buffer }).stdout?.toString() ?? "";
    let failCount = 0;
    try {
      const result = JSON.parse(stdout);
      failCount = result.numFailedTests ?? 0;
    } catch {
      failCount = -1; // JSON 파싱 실패 — 테스트 러너 자체 에러
    }
    findings.push({
      category: "test-build",
      severity: "CRITICAL",
      title: "테스트 실패",
      detail: failCount >= 0
        ? `vitest run 실패. ${failCount}건 테스트 실패.`
        : "vitest 실행 자체가 실패함. 테스트 러너 구성 점검 필요.",
    });
  }

  return findings;
}

// ─── GitHub 이슈 생성 ───────────────────────────────────────

const SEVERITY_TO_LABEL: Record<AuditFinding["severity"], string> = {
  CRITICAL: "P0: critical",
  HIGH: "P1: high",
  MEDIUM: "P2: medium",
  LOW: "P3: low",
};

const MAX_ISSUES_PER_RUN = 5;

export async function createGitHubIssues(findings: AuditFinding[]): Promise<string[]> {
  // severity 순으로 정렬 (CRITICAL > HIGH > MEDIUM > LOW)
  const severityOrder: AuditFinding["severity"][] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  const sorted = [...findings].sort(
    (a, b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity),
  );

  // 기존 open 이슈 조회
  const existingIssues = getOpenAuditIssues();

  const createdUrls: string[] = [];
  for (const finding of sorted) {
    if (createdUrls.length >= MAX_ISSUES_PER_RUN) break;

    const issueTitle = `[system-audit] ${finding.title}`;

    // 중복 체크: 동일 제목의 open 이슈가 있으면 스킵
    if (existingIssues.some((t) => t === issueTitle)) {
      logger.info("AUDIT", `이슈 스킵 (중복): ${issueTitle}`);
      continue;
    }

    const body = [
      `## 카테고리: ${finding.category}`,
      `## 심각도: ${finding.severity}`,
      "",
      finding.detail,
      "",
      "---",
      "_이 이슈는 주간 시스템 감사 스크립트에 의해 자동 생성되었습니다._",
    ].join("\n");

    const priorityLabel = SEVERITY_TO_LABEL[finding.severity];
    try {
      const url = execSync(
        'gh issue create --title "$ISSUE_TITLE" --body "$ISSUE_BODY" --label "system-audit" --label "$ISSUE_LABEL"',
        {
          cwd: PROJECT_ROOT,
          timeout: 30_000,
          stdio: "pipe",
          env: { ...process.env, ISSUE_TITLE: issueTitle, ISSUE_BODY: body, ISSUE_LABEL: priorityLabel },
        },
      ).toString().trim();
      createdUrls.push(url);
      existingIssues.push(issueTitle);
      logger.info("AUDIT", `이슈 생성: ${url}`);
    } catch (err) {
      logger.error("AUDIT", `이슈 생성 실패: ${issueTitle} — ${(err as Error).message}`);
    }
  }

  return createdUrls;
}

export function getOpenAuditIssues(): string[] {
  try {
    const output = execSync(
      'gh issue list --label "system-audit" --state open --json title --jq ".[].title"',
      { cwd: PROJECT_ROOT, timeout: 30_000, stdio: "pipe" },
    ).toString().trim();
    if (output === "") return [];
    return output.split("\n");
  } catch {
    logger.warn("AUDIT", "기존 이슈 조회 실패 — 중복 체크 없이 진행");
    return [];
  }
}

// ─── 유틸 ───────────────────────────────────────────────────

function fileContains(filePath: string, searchString: string): boolean {
  const content = safeReadFile(filePath);
  return content != null && content.includes(searchString);
}

function safeReadFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function grepInDir(dir: string, pattern: RegExp, globs: string[]): string[] {
  const includeArgs = globs.flatMap((g) => ["--include", g]);
  try {
    const output = execFileSync(
      "grep",
      ["-rl", pattern.source, ...includeArgs, dir],
      { timeout: 30_000, stdio: "pipe" },
    ).toString().trim();
    if (output === "") return [];
    return output.split("\n");
  } catch {
    return [];
  }
}

// ─── 메인 실행 ──────────────────────────────────────────────

export async function runAudit(): Promise<AuditResult> {
  logger.info("AUDIT", "=== 주간 시스템 감사 시작 ===");

  const allFindings: AuditFinding[] = [];

  // 1~3은 병렬 실행 (독립적)
  const [dataFindings, pipelineFindings] = await Promise.all([
    checkDataIntegrity(),
    checkPipelineConnectivity(),
  ]);

  const codeFindings = checkCodeDbConsistency();
  const testFindings = checkTestBuild();

  allFindings.push(...dataFindings, ...codeFindings, ...pipelineFindings, ...testFindings);

  const summary = {
    total: allFindings.length,
    critical: allFindings.filter((f) => f.severity === "CRITICAL").length,
    high: allFindings.filter((f) => f.severity === "HIGH").length,
    medium: allFindings.filter((f) => f.severity === "MEDIUM").length,
    low: allFindings.filter((f) => f.severity === "LOW").length,
  };

  logger.info("AUDIT", `감사 완료: ${summary.total}건 발견 (C:${summary.critical} H:${summary.high} M:${summary.medium} L:${summary.low})`);

  // GitHub 이슈 생성
  if (allFindings.length > 0) {
    const urls = await createGitHubIssues(allFindings);
    logger.info("AUDIT", `GitHub 이슈 ${urls.length}건 생성`);
  }

  logger.info("AUDIT", "=== 주간 시스템 감사 완료 ===");
  return { findings: allFindings, summary };
}

// 직접 실행 시
const isDirectRun = process.argv[1]?.includes("weekly-system-audit") === true;

if (isDirectRun) {
  runAudit()
    .then((result) => {
      if (result.summary.critical > 0) {
        process.exit(1);
      }
    })
    .catch((err) => {
      logger.error("AUDIT", `감사 실패: ${(err as Error).message}`);
      process.exit(1);
    })
    .finally(() => {
      pool.end();
    });
}

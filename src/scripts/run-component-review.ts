/**
 * 컴포넌트별 주간 자가 점검 스크립트.
 * 6개 컴포넌트의 KPI를 DB에서 쿼리하고, 임계치 이탈 시 GitHub 이슈를 자동 생성한다.
 * memory/component-health.md를 갱신하여 브리핑 파일로 활용 가능하게 한다.
 *
 * 실행: npx tsx src/scripts/run-component-review.ts
 * 스케줄: 일요일 KST 06:00 (launchd)
 *
 * LLM 호출 없음 — 모든 KPI 판단은 숫자 비교로만 수행.
 */

import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pool } from "@/db/client";
import { logger } from "@/lib/logger";
import {
  queryComponentKpiEtl,
  queryComponentKpiNarrativeChains,
  queryComponentKpiCorporateAnalyst,
  queryWeeklyQaDetectionLag,
  type ComponentKpiEtlRow,
  type ComponentKpiNarrativeChainsRow,
  type ComponentKpiCorporateAnalystRow,
  type WeeklyQaDetectionLagRow,
} from "@/db/repositories/index.js";

// ─── 타입 ───────────────────────────────────────────────────

export interface IssueSpec {
  title: string;
  body: string;
  labels: string[];
}

export interface ComponentCheckResult {
  name: string;
  kpiName: string;
  currentValue: string;
  status: "OK" | "ALERT" | "QUERY_FAILED";
  issues: IssueSpec[];
  errorMessage?: string;
}

interface ThesisHitRateRow {
  category: string;
  confirmed: number;
  invalidated: number;
  active: number;
}

interface NarrativeFreshnessRow {
  latest_identified_at: string | null;
}

// ─── 상수 ───────────────────────────────────────────────────

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../..");
const HEALTH_FILE = path.join(PROJECT_ROOT, "memory/component-health.md");

const DETECTION_LAG_THRESHOLD = 10;
const DETECTION_LAG_MIN_SAMPLE = 5;
const THESIS_HIT_RATE_THRESHOLD = 0.40;
const THESIS_HIT_RATE_MIN_N = 20;
const DAILY_REPORT_MIN_7D = 3;
const WEEKLY_REPORT_MIN_14D = 1;
const CORPORATE_ANALYST_MIN_FEATURED = 3;
const CORPORATE_ANALYST_COVERAGE_THRESHOLD = 50;
const NARRATIVE_FRESHNESS_DAYS = 7;

// ─── queryOrNull 패턴 ────────────────────────────────────────

async function queryOrNull<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("ComponentReview", `${label} 쿼리 실패: ${reason}`);
    return null;
  }
}

// ─── C1. etl_auto 체크 ──────────────────────────────────────

export function checkEtlAuto(
  data: ComponentKpiEtlRow,
): ComponentCheckResult {
  const { new_count_7d, phase2_transition_7d, total_active_etl } = data;

  const kpiName = "신규 등록 7d";
  const currentValue = `${new_count_7d}건`;

  if (new_count_7d !== 0) {
    return { name: "etl_auto", kpiName, currentValue, status: "OK", issues: [] };
  }

  const causeHint =
    phase2_transition_7d === 0
      ? "phase2_transition_7d가 0 → 시장 원인 (Phase 2 전환 자체 없음)"
      : `phase2_transition_7d = ${phase2_transition_7d} → ETL 로직 원인 의심`;

  const body = [
    "## etl_auto KPI 이탈",
    `- 최근 7일 신규 등록: 0건`,
    `- Phase 2 전환 수 (7일): ${phase2_transition_7d}건`,
    `- 현재 ACTIVE etl_auto: ${total_active_etl}건`,
    "",
    "## 가능한 원인",
    "- ETL scan-recommendation-candidates 실패",
    "- 게이트 조건 과도하게 엄격 (시장 상황 변화)",
    "- Phase 2 전환 자체가 없는 경우 (시장 조건 — 정상일 수 있음)",
    "",
    causeHint,
    "",
    "---",
    "_이 이슈는 컴포넌트 리뷰 스크립트에 의해 자동 생성되었습니다._",
  ].join("\n");

  return {
    name: "etl_auto",
    kpiName,
    currentValue,
    status: "ALERT",
    issues: [
      {
        title: "[component-reviewer] etl_auto — 최근 7일 신규 등록 0건",
        body,
        labels: ["component-reviewer", "P1: high"],
      },
    ],
  };
}

// ─── C2. tracked_stocks (포착 선행성) 체크 ──────────────────

export function checkDetectionLag(
  rows: WeeklyQaDetectionLagRow[],
): ComponentCheckResult {
  const totalCnt = rows.reduce((sum, r) => sum + r.cnt, 0);
  const weightedAvg =
    totalCnt === 0
      ? null
      : rows.reduce((sum, r) => sum + (r.avg_lag ?? 0) * r.cnt, 0) / totalCnt;

  const avgDisplay = weightedAvg == null ? "N/A" : `${weightedAvg.toFixed(1)}일`;
  const kpiName = "avg detection_lag";
  const currentValue = `${avgDisplay} (n=${totalCnt})`;

  // 샘플 5건 미만이면 판단 보류
  if (totalCnt < DETECTION_LAG_MIN_SAMPLE || weightedAvg == null) {
    return { name: "tracked_stocks", kpiName, currentValue, status: "OK", issues: [] };
  }

  if (weightedAvg <= DETECTION_LAG_THRESHOLD) {
    return { name: "tracked_stocks", kpiName, currentValue, status: "OK", issues: [] };
  }

  const sourceTable = rows
    .map(
      (r) =>
        `| ${r.source} | ${r.cnt}건 | ${r.avg_lag == null ? "N/A" : `${r.avg_lag}일`} | ${r.median_lag == null ? "N/A" : `${r.median_lag}일`} | ${r.early_cnt}/${r.normal_cnt}/${r.late_cnt} |`,
    )
    .join("\n");

  const body = [
    `## tracked_stocks KPI 이탈`,
    `- 전체 가중평균 detection_lag: **${weightedAvg.toFixed(1)}일** (임계치 ${DETECTION_LAG_THRESHOLD}일 초과)`,
    `- 총 샘플: ${totalCnt}건`,
    "",
    "## source별 상세",
    "| source | cnt | avg_lag | median_lag | 초입/초기/후행 |",
    "|--------|-----|---------|------------|--------------|",
    sourceTable,
    "",
    "## 판단 기준",
    "- 초입: 0~3일 / 초기: 4~7일 / 후행: 8일+",
    `- 임계치: 가중평균 > ${DETECTION_LAG_THRESHOLD}일 AND 샘플 >= ${DETECTION_LAG_MIN_SAMPLE}건`,
    "",
    "---",
    "_이 이슈는 컴포넌트 리뷰 스크립트에 의해 자동 생성되었습니다._",
  ].join("\n");

  return {
    name: "tracked_stocks",
    kpiName,
    currentValue,
    status: "ALERT",
    issues: [
      {
        title: `[component-reviewer] tracked_stocks — detection_lag 평균 ${weightedAvg.toFixed(1)}일 (임계치 초과)`,
        body,
        labels: ["component-reviewer", "P2: medium"],
      },
    ],
  };
}

// ─── C3. thesis/debate 체크 ─────────────────────────────────

export function checkThesisHitRate(
  rows: ThesisHitRateRow[],
): ComponentCheckResult {
  const issues: IssueSpec[] = [];
  const alertCategories: string[] = [];

  for (const row of rows) {
    const n = row.confirmed + row.invalidated;
    if (n < THESIS_HIT_RATE_MIN_N) continue;

    const hitRate = row.confirmed / n;
    if (hitRate >= THESIS_HIT_RATE_THRESHOLD) continue;

    const hitRatePct = Math.round(hitRate * 100);
    const body = [
      `## thesis/debate KPI 이탈 — ${row.category}`,
      `- hit_rate: **${hitRatePct}%** (임계치 ${Math.round(THESIS_HIT_RATE_THRESHOLD * 100)}% 미달)`,
      `- n = ${n} (CONFIRMED: ${row.confirmed}, INVALIDATED: ${row.invalidated})`,
      `- 현재 ACTIVE: ${row.active}건`,
      "",
      "## 해석",
      `- ${row.category} 카테고리 thesis 적중률이 기준 이하입니다.`,
      "- 해당 카테고리의 thesis 생성 기준 또는 분석 품질을 점검하세요.",
      "",
      "---",
      "_이 이슈는 컴포넌트 리뷰 스크립트에 의해 자동 생성되었습니다._",
    ].join("\n");

    issues.push({
      title: `[component-reviewer] thesis/debate — ${row.category} hit_rate ${hitRatePct}% (n=${n}, 임계치 40% 미달)`,
      body,
      labels: ["component-reviewer", "P2: medium"],
    });
    alertCategories.push(`${row.category}(${hitRatePct}%)`);
  }

  const firstAlert = rows.find((r) => {
    const n = r.confirmed + r.invalidated;
    return n >= THESIS_HIT_RATE_MIN_N && r.confirmed / n < THESIS_HIT_RATE_THRESHOLD;
  });

  const kpiName = "hit_rate";
  const currentValue =
    firstAlert == null
      ? `OK (${rows.length}개 카테고리)`
      : `이탈: ${alertCategories.join(", ")}`;

  return {
    name: "thesis/debate",
    kpiName,
    currentValue,
    status: issues.length > 0 ? "ALERT" : "OK",
    issues,
  };
}

// ─── C4. 일간/주간 리포트 체크 ──────────────────────────────

export function checkReports(
  rows: { report_date: string; type: string }[],
  now: Date,
): ComponentCheckResult[] {
  // 일간 리포트: 최근 7일 (date string 비교로 시간대 경계 문제 방지)
  const cutoff7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const dailyCount = rows.filter(
    (r) => r.type === "daily" && r.report_date >= cutoff7d,
  ).length;

  // 주간 리포트: 최근 14일
  const cutoff14d = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const weeklyCount = rows.filter(
    (r) => r.type === "weekly" && r.report_date >= cutoff14d,
  ).length;

  const dailyResult: ComponentCheckResult = (() => {
    if (dailyCount >= DAILY_REPORT_MIN_7D) {
      return {
        name: "일간 리포트",
        kpiName: "발행 수 7d",
        currentValue: `${dailyCount}건`,
        status: "OK" as const,
        issues: [],
      };
    }

    const body = [
      "## 일간 리포트 KPI 이탈",
      `- 최근 7일 발행 수: **${dailyCount}건** (기준 ${DAILY_REPORT_MIN_7D}건 미달)`,
      "",
      "## 가능한 원인",
      "- 일간 에이전트(run-daily-agent.ts) 실패",
      "- 미장 휴일이 연속되어 리포트 생략 (정상일 수 있음)",
      "- DB 저장 단계 실패",
      "",
      "---",
      "_이 이슈는 컴포넌트 리뷰 스크립트에 의해 자동 생성되었습니다._",
    ].join("\n");

    return {
      name: "일간 리포트",
      kpiName: "발행 수 7d",
      currentValue: `${dailyCount}건`,
      status: "ALERT" as const,
      issues: [
        {
          title: `[component-reviewer] 일간 리포트 — 최근 7일 발행 ${dailyCount}건 (기준 3건 미달)`,
          body,
          labels: ["component-reviewer", "P1: high"],
        },
      ],
    };
  })();

  const weeklyResult: ComponentCheckResult = (() => {
    if (weeklyCount >= WEEKLY_REPORT_MIN_14D) {
      return {
        name: "주간 리포트",
        kpiName: "발행 수 14d",
        currentValue: `${weeklyCount}건`,
        status: "OK" as const,
        issues: [],
      };
    }

    const body = [
      "## 주간 리포트 KPI 이탈",
      `- 최근 14일 발행 수: **${weeklyCount}건** (기준 ${WEEKLY_REPORT_MIN_14D}건 미달)`,
      "",
      "## 가능한 원인",
      "- 주간 에이전트(run-weekly-agent.ts) 실패",
      "- qa-weekly.sh 또는 agent-weekly.sh 스케줄 이상",
      "- DB 저장 단계 실패",
      "",
      "---",
      "_이 이슈는 컴포넌트 리뷰 스크립트에 의해 자동 생성되었습니다._",
    ].join("\n");

    return {
      name: "주간 리포트",
      kpiName: "발행 수 14d",
      currentValue: `${weeklyCount}건`,
      status: "ALERT" as const,
      issues: [
        {
          title: "[component-reviewer] 주간 리포트 — 최근 14일 발행 없음",
          body,
          labels: ["component-reviewer", "P1: high"],
        },
      ],
    };
  })();

  return [dailyResult, weeklyResult];
}

// ─── C5. 기업 분석 체크 ─────────────────────────────────────

export function checkCorporateAnalyst(
  data: ComponentKpiCorporateAnalystRow,
): ComponentCheckResult {
  const { total_featured_active, covered_count, coverage_rate } = data;
  const coverageDisplay =
    coverage_rate == null ? "N/A" : `${coverage_rate}%`;
  const kpiName = "featured 커버리지";
  const currentValue = `${coverageDisplay} (${covered_count}/${total_featured_active})`;

  // featured 3개 미만이면 판단 의미 없음
  if (total_featured_active < CORPORATE_ANALYST_MIN_FEATURED) {
    return { name: "기업 분석", kpiName, currentValue, status: "OK", issues: [] };
  }

  if (coverage_rate != null && coverage_rate >= CORPORATE_ANALYST_COVERAGE_THRESHOLD) {
    return { name: "기업 분석", kpiName, currentValue, status: "OK", issues: [] };
  }

  const coveragePct =
    coverage_rate == null ? "N/A" : `${coverage_rate}%`;

  const body = [
    "## 기업 분석 KPI 이탈",
    `- featured 커버리지: **${coveragePct}** (임계치 ${CORPORATE_ANALYST_COVERAGE_THRESHOLD}% 미달)`,
    `- featured ACTIVE 종목: ${total_featured_active}개`,
    `- 분석 리포트 보유: ${covered_count}개`,
    "",
    "## 조치 방향",
    "- corporateAnalyst를 수동 또는 자동으로 실행하여 미커버 종목 분석 생성",
    "- 미커버 종목: tracked_stocks(featured, ACTIVE) 중 stock_analysis_reports 없는 종목 확인",
    "",
    "---",
    "_이 이슈는 컴포넌트 리뷰 스크립트에 의해 자동 생성되었습니다._",
  ].join("\n");

  return {
    name: "기업 분석",
    kpiName,
    currentValue,
    status: "ALERT",
    issues: [
      {
        title: `[component-reviewer] 기업 분석 — featured 커버리지 ${coveragePct} (${covered_count}/${total_featured_active}, 임계치 50% 미달)`,
        body,
        labels: ["component-reviewer", "P2: medium"],
      },
    ],
  };
}

// ─── C6. narrative_chains 체크 ──────────────────────────────

export function checkNarrativeChains(
  data: ComponentKpiNarrativeChainsRow,
  latestIdentifiedAt: string | null,
  now: Date,
): ComponentCheckResult {
  const issues: IssueSpec[] = [];
  const { active_chain_count } = data;

  // 조건 A: 활성 체인 0건
  if (active_chain_count === 0) {
    const body = [
      "## narrative_chains KPI 이탈",
      "- 활성 체인 수: **0건**",
      "",
      "## 가능한 원인",
      "- 토론 에이전트(debate)가 오랫동안 실행되지 않음",
      "- 모든 체인이 RESOLVED/STALE 상태로 전환됨",
      "- 새 메가트렌드/병목 체인 생성 로직 문제",
      "",
      "---",
      "_이 이슈는 컴포넌트 리뷰 스크립트에 의해 자동 생성되었습니다._",
    ].join("\n");

    issues.push({
      title: "[component-reviewer] narrative_chains — 활성 체인 0건",
      body,
      labels: ["component-reviewer", "P2: medium"],
    });
  }

  // 조건 B: 최신 체인 7일 이상 미갱신
  if (latestIdentifiedAt != null) {
    const latestDate = new Date(latestIdentifiedAt);
    const daysSince = Math.floor(
      (now.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysSince > NARRATIVE_FRESHNESS_DAYS) {
      const body = [
        "## narrative_chains freshness 이탈",
        `- 가장 최근 체인 생성: **${daysSince}일 전** (임계치 ${NARRATIVE_FRESHNESS_DAYS}일 초과)`,
        `- 마지막 bottleneck_identified_at: ${latestIdentifiedAt}`,
        "",
        "## 가능한 원인",
        "- 토론 에이전트가 새 narrative chain을 생성하지 않고 있음",
        "- 기존 체인 갱신만 되고 신규 chain 생성 없음",
        "",
        "---",
        "_이 이슈는 컴포넌트 리뷰 스크립트에 의해 자동 생성되었습니다._",
      ].join("\n");

      issues.push({
        title: `[component-reviewer] narrative_chains — 최신 체인 ${daysSince}일 미갱신`,
        body,
        labels: ["component-reviewer", "P2: medium"],
      });
    }
  }

  const freshnessDisplay =
    latestIdentifiedAt == null
      ? "없음"
      : `${Math.floor((now.getTime() - new Date(latestIdentifiedAt).getTime()) / (1000 * 60 * 60 * 24))}일 전`;

  return {
    name: "narrative_chains",
    kpiName: "활성 체인 / 최신",
    currentValue: `${active_chain_count}개 / ${freshnessDisplay}`,
    status: issues.length > 0 ? "ALERT" : "OK",
    issues,
  };
}

// ─── GitHub 이슈 중복 체크 ──────────────────────────────────

export function getOpenComponentReviewerIssues(): string[] {
  try {
    const output = spawnSync(
      "gh",
      [
        "issue",
        "list",
        "--label",
        "component-reviewer",
        "--state",
        "open",
        "--json",
        "title",
        "--jq",
        ".[].title",
      ],
      { encoding: "utf-8", cwd: PROJECT_ROOT },
    );
    if (output.status !== 0 || output.stdout.trim() === "") return [];
    return output.stdout.trim().split("\n");
  } catch {
    logger.warn("ComponentReview", "기존 이슈 조회 실패 — 중복 체크 없이 진행");
    return [];
  }
}

// ─── GitHub 이슈 생성 ───────────────────────────────────────

function createGitHubIssue(
  issue: IssueSpec,
  existingTitles: string[],
): { created: boolean; skipped: boolean; url?: string } {
  if (existingTitles.includes(issue.title)) {
    logger.info("ComponentReview", `이슈 스킵 (중복): ${issue.title}`);
    return { created: false, skipped: true };
  }

  const labelArgs = issue.labels.flatMap((label) => ["--label", label]);

  try {
    const result = spawnSync(
      "gh",
      ["issue", "create", "--title", issue.title, "--body", issue.body, ...labelArgs],
      { encoding: "utf-8", cwd: PROJECT_ROOT },
    );

    if (result.status !== 0) {
      logger.warn("ComponentReview", `이슈 생성 실패: ${issue.title} — ${result.stderr}`);
      return { created: false, skipped: false };
    }

    const url = result.stdout.trim();
    logger.info("ComponentReview", `이슈 생성: ${url}`);
    return { created: true, skipped: false, url };
  } catch (err) {
    logger.warn("ComponentReview", `이슈 생성 예외: ${issue.title} — ${(err as Error).message}`);
    return { created: false, skipped: false };
  }
}

// ─── component-health.md 갱신 ───────────────────────────────

function formatKstTimestamp(date: Date): string {
  return date.toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildHealthReport(
  results: ComponentCheckResult[],
  createdCount: number,
  skippedCount: number,
  now: Date,
): string {
  const timestamp = formatKstTimestamp(now);

  const rows = results.map((r) => {
    const statusIcon = r.status === "OK" ? "OK" : r.status === "ALERT" ? "ALERT" : "FAILED";
    const issueLinks =
      r.issues.length === 0 ? "-" : r.issues.map(() => "-").join(", ");

    // 이슈 번호는 생성 후 알 수 없으므로 "-" 처리 (gh 이슈 URL은 로그에서 확인 가능)
    return `| ${r.name} | ${r.kpiName} | ${r.currentValue} | ${statusIcon} | ${issueLinks} |`;
  });

  const failedComponents = results.filter((r) => r.status === "QUERY_FAILED");
  const failedSummary =
    failedComponents.length === 0
      ? "없음"
      : failedComponents
          .map((r) => `${r.name} (에러: ${r.errorMessage ?? "알 수 없음"})`)
          .join(", ");

  return [
    `# Component Health (${timestamp} KST)`,
    "",
    "| 컴포넌트 | KPI | 현재값 | 판정 | 이슈 |",
    "|---------|-----|--------|------|------|",
    ...rows,
    "",
    "## 실행 로그",
    `- 실행 시각: ${timestamp} KST`,
    `- 총 이슈 생성: ${createdCount}건 (스킵: ${skippedCount}건 — 중복)`,
    `- 실패한 컴포넌트: ${failedSummary}`,
  ].join("\n");
}

// ─── 메인 실행 ──────────────────────────────────────────────

export async function runComponentReview(): Promise<void> {
  logger.info("ComponentReview", "=== 컴포넌트 리뷰 시작 ===");

  const now = new Date();

  // [1] 병렬 KPI 쿼리
  const [
    etlData,
    detectionLagData,
    narrativeData,
    corporateData,
    reportData,
    thesisRows,
    freshnessRow,
  ] = await Promise.all([
    queryOrNull("etl_kpi", () => queryComponentKpiEtl(pool)),
    queryOrNull("detection_lag", () => queryWeeklyQaDetectionLag(pool)),
    queryOrNull("narrative_chains_kpi", () => queryComponentKpiNarrativeChains(pool)),
    queryOrNull("corporate_analyst_kpi", () => queryComponentKpiCorporateAnalyst(pool)),
    queryOrNull("reports_14d", async () => {
      const { rows } = await pool.query<{ report_date: string; type: string }>(
        `SELECT report_date::date::text AS report_date, type
         FROM daily_reports
         WHERE report_date::date > (NOW() - INTERVAL '14 days')::date
         ORDER BY report_date DESC`,
      );
      return rows;
    }),
    queryOrNull("thesis_hit_rate", async () => {
      const { rows } = await pool.query<ThesisHitRateRow>(
        `SELECT category,
                COUNT(*) FILTER (WHERE status = 'CONFIRMED')::int AS confirmed,
                COUNT(*) FILTER (WHERE status = 'INVALIDATED')::int AS invalidated,
                COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active
         FROM theses
         WHERE is_status_quo IS NOT TRUE
         GROUP BY category`,
      );
      return rows;
    }),
    queryOrNull("narrative_freshness", async () => {
      const { rows } = await pool.query<NarrativeFreshnessRow>(
        `SELECT MAX(bottleneck_identified_at) AS latest_identified_at
         FROM narrative_chains
         WHERE status IN ('ACTIVE', 'RESOLVING')`,
      );
      return rows[0] ?? { latest_identified_at: null };
    }),
  ]);

  // [3] 컴포넌트별 임계치 판단
  const results: ComponentCheckResult[] = [];

  // C1. etl_auto
  if (etlData == null) {
    results.push({
      name: "etl_auto",
      kpiName: "신규 등록 7d",
      currentValue: "쿼리 실패",
      status: "QUERY_FAILED",
      issues: [],
      errorMessage: "queryComponentKpiEtl 실패",
    });
  } else {
    results.push(checkEtlAuto(etlData));
  }

  // C2. tracked_stocks
  if (detectionLagData == null) {
    results.push({
      name: "tracked_stocks",
      kpiName: "avg detection_lag",
      currentValue: "쿼리 실패",
      status: "QUERY_FAILED",
      issues: [],
      errorMessage: "queryWeeklyQaDetectionLag 실패",
    });
  } else {
    results.push(checkDetectionLag(detectionLagData));
  }

  // C3. thesis/debate
  if (thesisRows == null) {
    results.push({
      name: "thesis/debate",
      kpiName: "hit_rate",
      currentValue: "쿼리 실패",
      status: "QUERY_FAILED",
      issues: [],
      errorMessage: "thesis hit_rate 쿼리 실패",
    });
  } else {
    results.push(checkThesisHitRate(thesisRows));
  }

  // C4. 리포트 (일간 + 주간) — 14일 단일 쿼리 결과로 판단
  if (reportData == null) {
    results.push(
      {
        name: "일간 리포트",
        kpiName: "발행 수 7d",
        currentValue: "쿼리 실패",
        status: "QUERY_FAILED",
        issues: [],
        errorMessage: "reports_14d 쿼리 실패",
      },
      {
        name: "주간 리포트",
        kpiName: "발행 수 14d",
        currentValue: "쿼리 실패",
        status: "QUERY_FAILED",
        issues: [],
        errorMessage: "reports_14d 쿼리 실패",
      },
    );
  } else {
    results.push(...checkReports(reportData, now));
  }

  // C5. 기업 분석
  if (corporateData == null) {
    results.push({
      name: "기업 분석",
      kpiName: "featured 커버리지",
      currentValue: "쿼리 실패",
      status: "QUERY_FAILED",
      issues: [],
      errorMessage: "queryComponentKpiCorporateAnalyst 실패",
    });
  } else {
    results.push(checkCorporateAnalyst(corporateData));
  }

  // C6. narrative_chains
  if (narrativeData == null) {
    results.push({
      name: "narrative_chains",
      kpiName: "활성 체인 / 최신",
      currentValue: "쿼리 실패",
      status: "QUERY_FAILED",
      issues: [],
      errorMessage: "queryComponentKpiNarrativeChains 실패",
    });
  } else {
    const latestIdentifiedAt =
      freshnessRow == null ? null : freshnessRow.latest_identified_at;
    results.push(checkNarrativeChains(narrativeData, latestIdentifiedAt, now));
  }

  // [4] 중복 체크 후 GitHub 이슈 생성
  const existingTitles = getOpenComponentReviewerIssues();

  let createdCount = 0;
  let skippedCount = 0;

  for (const result of results) {
    for (const issue of result.issues) {
      const { created, skipped } = createGitHubIssue(issue, existingTitles);
      if (created) {
        createdCount++;
        existingTitles.push(issue.title); // 같은 실행 내 중복 방지
      }
      if (skipped) {
        skippedCount++;
      }
    }
  }

  // [5] memory/component-health.md 갱신
  const healthReport = buildHealthReport(results, createdCount, skippedCount, now);
  writeFileSync(HEALTH_FILE, healthReport, "utf-8");
  logger.info("ComponentReview", `component-health.md 갱신 완료`);

  // [6] 완료 로그
  const alertCount = results.filter((r) => r.status === "ALERT").length;
  const failedCount = results.filter((r) => r.status === "QUERY_FAILED").length;

  logger.info(
    "ComponentReview",
    `=== 컴포넌트 리뷰 완료: 총 ${results.length}개 체크 | ALERT ${alertCount}건 | 이슈 생성 ${createdCount}건 (스킵 ${skippedCount}건) | 쿼리 실패 ${failedCount}건 ===`,
  );

  // 전체 쿼리 실패 시 exit 1
  if (failedCount === results.length) {
    throw new Error("모든 컴포넌트 KPI 쿼리 실패 — 전체 실행 중단");
  }
}

// 직접 실행 시
const isDirectRun = process.argv[1]?.includes("run-component-review") === true;

if (isDirectRun) {
  runComponentReview()
    .catch((err) => {
      logger.error("ComponentReview", `컴포넌트 리뷰 실패: ${(err as Error).message}`);
      process.exit(1);
    })
    .finally(() => {
      pool.end();
    });
}

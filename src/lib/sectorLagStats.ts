import { db, pool } from "../db/client.js";
import { sectorPhaseEvents, sectorLagPatterns } from "../db/schema/analyst.js";
import { eq, and, gte } from "drizzle-orm";

// ── Constants ──────────────────────────────────────────────────

export const MIN_SAMPLE = 5;
export const LAG_SEARCH_WINDOW_DAYS = 180;

// ── Types ──────────────────────────────────────────────────────

export interface LagObservation {
  leaderDate: string;
  followerDate: string;
  lagDays: number;
}

export interface ComputedLagStats {
  avgLagDays: number;
  medianLagDays: number;
  stddevLagDays: number;
  minLagDays: number;
  maxLagDays: number;
  sampleCount: number;
  isReliable: boolean;
}

export interface ActiveLeadingAlert {
  leaderEntity: string;
  leaderPhase2Date: string;
  followerEntity: string;
  entityType: "sector" | "industry";
  avgLagDays: number;
  stddevLagDays: number;
  sampleCount: number;
  windowStart: string;
  windowEnd: string;
}

// ── Pure Functions (no DB) ──────────────────────────────────────

/**
 * 날짜 문자열 간의 일수 차이를 계산한다.
 */
function daysBetween(dateA: string, dateB: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  return Math.round((b - a) / msPerDay);
}

/**
 * 날짜 문자열에 일수를 더한다.
 */
function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * 리더 이벤트 시계열과 팔로워 이벤트 시계열에서 시차 관측을 계산한다.
 *
 * 규칙:
 * - 팔로워가 리더보다 나중에 진입한 경우(lagDays >= 0)만 유효
 * - LAG_SEARCH_WINDOW_DAYS 이내에 발생한 팔로워 이벤트만 매칭
 * - 하나의 리더 이벤트에 가장 가까운 팔로워 1개만 매칭
 */
export function calculateLagObservations(
  leaderDates: string[],
  followerDates: string[],
): LagObservation[] {
  if (leaderDates.length === 0 || followerDates.length === 0) {
    return [];
  }

  const sortedFollower = [...followerDates].sort();
  const observations: LagObservation[] = [];

  for (const leaderDate of leaderDates) {
    let bestMatch: { followerDate: string; lagDays: number } | null = null;

    for (const followerDate of sortedFollower) {
      const lag = daysBetween(leaderDate, followerDate);

      // 음수 시차 제외 (팔로워가 먼저 진입한 경우는 리더/팔로워 관계 반전)
      if (lag < 0) continue;

      // 탐색 윈도우 초과
      if (lag > LAG_SEARCH_WINDOW_DAYS) break;

      // 정렬된 배열에서 첫 번째 유효 팔로워가 최솟값
      if (bestMatch == null || lag < bestMatch.lagDays) {
        bestMatch = { followerDate, lagDays: lag };
        break;
      }
    }

    if (bestMatch != null) {
      observations.push({
        leaderDate,
        followerDate: bestMatch.followerDate,
        lagDays: bestMatch.lagDays,
      });
    }
  }

  return observations;
}

/**
 * lag_days 배열에서 통계를 계산한다.
 * 샘플이 MIN_SAMPLE 미만이면 null을 반환한다.
 */
export function calculateLagStats(lagDays: number[]): ComputedLagStats | null {
  if (lagDays.length === 0) return null;

  const sorted = [...lagDays].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, d) => acc + d, 0);
  const avg = sum / sorted.length;

  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

  const variance =
    sorted.reduce((acc, d) => acc + (d - avg) ** 2, 0) / sorted.length;
  const stddev = Math.sqrt(variance);

  const isReliable = sorted.length >= MIN_SAMPLE;

  return {
    avgLagDays: Math.round(avg * 10) / 10,
    medianLagDays: Math.round(median * 10) / 10,
    stddevLagDays: Math.round(stddev * 10) / 10,
    minLagDays: sorted[0],
    maxLagDays: sorted[sorted.length - 1],
    sampleCount: sorted.length,
    isReliable,
  };
}

// ── DB Functions ──────────────────────────────────────────────

/**
 * 현재 활성 선행 섹터 경보를 생성한다.
 *
 * 1. 최근 N일 내 Phase 2에 진입한 리더 섹터 조회
 * 2. 해당 리더의 신뢰 가능한 팔로워 패턴 조회
 * 3. 아직 Phase 2에 진입하지 않은 팔로워만 필터링
 * 4. 예상 진입 윈도우 계산
 */
export async function getActiveLeadingAlerts(
  currentDate: string,
  lookbackDays: number = 14,
): Promise<ActiveLeadingAlert[]> {
  const cutoffDate = addDays(currentDate, -lookbackDays);

  // 1. 최근 Phase 2 진입 리더 이벤트
  const recentLeaderEvents = await db
    .select({
      entityType: sectorPhaseEvents.entityType,
      entityName: sectorPhaseEvents.entityName,
      date: sectorPhaseEvents.date,
    })
    .from(sectorPhaseEvents)
    .where(
      and(
        eq(sectorPhaseEvents.toPhase, 2),
        eq(sectorPhaseEvents.fromPhase, 1),
        gte(sectorPhaseEvents.date, cutoffDate),
      ),
    );

  if (recentLeaderEvents.length === 0) return [];

  // 2. 신뢰 가능한 팔로워 패턴 조회
  const reliablePatterns = await db
    .select()
    .from(sectorLagPatterns)
    .where(
      and(
        eq(sectorLagPatterns.isReliable, true),
        eq(sectorLagPatterns.transition, "1to2"),
      ),
    );

  if (reliablePatterns.length === 0) return [];

  // 3. 현재 Phase 2인 엔티티 조회 (sector_rs_daily + industry_rs_daily)
  const { rows: sectorPhase2Rows } = await pool.query<{ entity_name: string }>(
    `SELECT DISTINCT sector AS entity_name FROM sector_rs_daily
     WHERE date = (SELECT MAX(date) FROM sector_rs_daily)
       AND group_phase = 2`,
  );
  const { rows: industryPhase2Rows } = await pool.query<{ entity_name: string }>(
    `SELECT DISTINCT industry AS entity_name FROM industry_rs_daily
     WHERE date = (SELECT MAX(date) FROM industry_rs_daily)
       AND group_phase = 2`,
  );

  const alreadyPhase2 = new Set([
    ...sectorPhase2Rows.map((r) => `sector:${r.entity_name}`),
    ...industryPhase2Rows.map((r) => `industry:${r.entity_name}`),
  ]);

  // 4. 경보 생성
  const alerts: ActiveLeadingAlert[] = [];

  for (const leader of recentLeaderEvents) {
    const matchingPatterns = reliablePatterns.filter(
      (p) =>
        p.entityType === leader.entityType &&
        p.leaderEntity === leader.entityName,
    );

    for (const pattern of matchingPatterns) {
      const followerKey = `${pattern.entityType}:${pattern.followerEntity}`;

      // 리더 자신은 제외 + 이미 Phase 2에 진입한 팔로워 제외
      if (
        pattern.followerEntity === leader.entityName ||
        alreadyPhase2.has(followerKey)
      ) {
        continue;
      }

      const avgLag = Number(pattern.avgLagDays ?? 0);
      const stddev = Number(pattern.stddevLagDays ?? 0);

      const windowStart = addDays(leader.date, Math.max(0, Math.round(avgLag - stddev)));
      const windowEnd = addDays(leader.date, Math.round(avgLag + stddev));

      alerts.push({
        leaderEntity: leader.entityName,
        leaderPhase2Date: leader.date,
        followerEntity: pattern.followerEntity,
        entityType: leader.entityType as "sector" | "industry",
        avgLagDays: avgLag,
        stddevLagDays: stddev,
        sampleCount: pattern.sampleCount,
        windowStart,
        windowEnd,
      });
    }
  }

  return alerts;
}

/**
 * 주간 에이전트 프롬프트 주입용 포맷.
 * 신뢰 가능한 패턴이 없으면 빈 문자열을 반환한다.
 */
export async function formatLeadingSectorsForPrompt(
  currentDate: string,
): Promise<string> {
  const alerts = await getActiveLeadingAlerts(currentDate);
  if (alerts.length === 0) return "";

  const lines: string[] = [
    "## 섹터 시차 기반 조기 경보\n",
    "현재 선행 섹터 움직임 기반 주시 대상:\n",
    "| 리더 섹터 | Phase 2 진입일 | 팔로워 섹터 | 예상 진입 윈도우 | 과거 평균 시차 | 관측 횟수 |",
    "|---------|-------------|-----------|---------------|-------------|---------|",
  ];

  for (const alert of alerts) {
    const lagDisplay = `${Math.round(alert.avgLagDays)}일 (±${Math.round(alert.stddevLagDays)}일)`;
    lines.push(
      `| ${alert.leaderEntity} | ${alert.leaderPhase2Date} | ${alert.followerEntity} | ${alert.windowStart} ~ ${alert.windowEnd} | ${lagDisplay} | ${alert.sampleCount}회 |`,
    );
  }

  lines.push(
    "",
    "※ 예상 진입 윈도우 내에 팔로워 섹터 RS 상승 조짐이 보이면 집중 주시.",
    "※ 관측 5회 미만 패턴은 신뢰도 부족으로 표시하지 않습니다.",
  );

  return lines.join("\n");
}

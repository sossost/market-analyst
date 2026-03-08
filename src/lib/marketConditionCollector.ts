/**
 * 시장 조건 수집 헬퍼.
 *
 * Phase 2 위양성 분석을 위해 특정 종목·날짜의 시장 조건을 수집한다.
 * - marketBreadthDirection: 전체 시장 Phase 2 비율의 4주 추세
 * - sectorRsIsolated: 해당 섹터만 RS 상승하고 인접 섹터는 미동반인지 여부
 * - volumeConfirmed: Phase 1→2 진입 시 거래량 확인 여부
 * - sepaGrade: 펀더멘탈 SEPA 등급
 */
import { sql } from "drizzle-orm";
import type { FailureConditions } from "../types/failure.js";

// db.execute 결과의 최소 인터페이스 — 테스트 모킹용
export interface DbExecutor {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: unknown[] }>;
}

const BREADTH_LOOKBACK_DAYS = 20; // 4주 (영업일)
const MIN_CO_RISING_SECTORS = 2; // 동반 상승 최소 섹터 수
const TOP_SECTOR_COUNT = 5; // RS 상위 섹터 수

// ─── Public API ─────────────────────────────────────────────────────

export async function collectFailureConditions(
  symbol: string,
  date: string,
  db: DbExecutor,
): Promise<FailureConditions> {
  const [breadth, isolated, volume, grade] = await Promise.all([
    getMarketBreadthDirection(date, db),
    getSectorRsIsolated(symbol, date, db),
    getVolumeConfirmed(symbol, date, db),
    getSepaGrade(symbol, date, db),
  ]);

  return {
    marketBreadthDirection: breadth,
    sectorRsIsolated: isolated,
    volumeConfirmed: volume,
    sepaGrade: grade,
  };
}

// ─── Market Breadth Direction ───────────────────────────────────────

/**
 * sector_rs_daily에서 전체 시장의 phase2_ratio 평균을 최근 20영업일 조회하여
 * 선형 기울기로 추세를 판단한다.
 *
 * 기울기 > 0.001 → "improving"
 * 기울기 < -0.001 → "declining"
 * 그 외 → "neutral"
 */
export async function getMarketBreadthDirection(
  date: string,
  db: DbExecutor,
): Promise<FailureConditions["marketBreadthDirection"]> {
  const result = await db.execute(sql`
    SELECT date, AVG(phase2_ratio::numeric) AS avg_phase2_ratio
    FROM sector_rs_daily
    WHERE date <= ${date}
    GROUP BY date
    ORDER BY date DESC
    LIMIT ${BREADTH_LOOKBACK_DAYS}
  `);

  const rows = result.rows as Array<{
    date: string;
    avg_phase2_ratio: string | null;
  }>;

  if (rows.length < 2) return null;

  // rows는 최신순 → 시간순으로 뒤집어 기울기 계산
  const values = rows
    .reverse()
    .map((r) => (r.avg_phase2_ratio != null ? Number(r.avg_phase2_ratio) : null))
    .filter((v): v is number => v != null);

  if (values.length < 2) return null;

  const slope = calcLinearSlope(values);
  return classifySlope(slope);
}

// ─── Sector RS Isolated ─────────────────────────────────────────────

/**
 * 해당 종목의 섹터를 찾고, 해당 날짜 RS 상위 5개 섹터 중
 * change_4w > 0 인 섹터가 2개 미만이면 고립(isolated)으로 판단.
 */
export async function getSectorRsIsolated(
  symbol: string,
  date: string,
  db: DbExecutor,
): Promise<boolean | null> {
  // 1. 종목의 섹터 찾기
  const sectorResult = await db.execute(sql`
    SELECT sector FROM symbols WHERE symbol = ${symbol}
  `);

  const sectorRows = sectorResult.rows as Array<{ sector: string | null }>;
  const sector = sectorRows[0]?.sector;

  if (sector == null) return null;

  // 2. 해당 날짜 RS 상위 5개 섹터 조회
  const topSectorsResult = await db.execute(sql`
    SELECT sector, change_4w
    FROM sector_rs_daily
    WHERE date = ${date}
    ORDER BY avg_rs DESC NULLS LAST
    LIMIT ${TOP_SECTOR_COUNT}
  `);

  const topSectors = topSectorsResult.rows as Array<{
    sector: string;
    change_4w: string | null;
  }>;

  if (topSectors.length === 0) return null;

  // 3. 동반 RS 상승 섹터 수 계산 (해당 섹터 제외)
  const coRisingSectors = topSectors.filter(
    (s) =>
      s.sector !== sector &&
      s.change_4w != null &&
      Number(s.change_4w) > 0,
  );

  return coRisingSectors.length < MIN_CO_RISING_SECTORS;
}

// ─── Volume Confirmed ───────────────────────────────────────────────

/**
 * stock_phases 테이블에서 해당 종목의 volume_confirmed 조회.
 * 해당 날짜에 가장 가까운 레코드를 사용한다.
 */
export async function getVolumeConfirmed(
  symbol: string,
  date: string,
  db: DbExecutor,
): Promise<boolean | null> {
  const result = await db.execute(sql`
    SELECT volume_confirmed
    FROM stock_phases
    WHERE symbol = ${symbol}
      AND date <= ${date}
    ORDER BY date DESC
    LIMIT 1
  `);

  const rows = result.rows as Array<{ volume_confirmed: boolean | null }>;

  if (rows.length === 0) return null;
  return rows[0].volume_confirmed ?? null;
}

// ─── SEPA Grade ─────────────────────────────────────────────────────

/**
 * fundamental_scores 테이블에서 해당 종목의 최근 등급 조회.
 */
export async function getSepaGrade(
  symbol: string,
  date: string,
  db: DbExecutor,
): Promise<FailureConditions["sepaGrade"]> {
  const result = await db.execute(sql`
    SELECT grade
    FROM fundamental_scores
    WHERE symbol = ${symbol}
      AND scored_date <= ${date}
    ORDER BY scored_date DESC
    LIMIT 1
  `);

  const rows = result.rows as Array<{ grade: string | null }>;

  if (rows.length === 0) return null;

  const grade = rows[0].grade;
  if (grade == null) return null;

  const validGrades = new Set(["S", "A", "B", "C", "F"]);

  if (!validGrades.has(grade)) return null;
  return grade as FailureConditions["sepaGrade"];
}

// ─── Pure calculation helpers (exported for testing) ────────────────

const SLOPE_THRESHOLD = 0.001;

/**
 * 단순 선형 회귀 기울기 계산.
 * values는 시간순 (oldest first).
 */
export function calcLinearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

/**
 * 기울기를 방향으로 분류.
 */
export function classifySlope(
  slope: number,
): "improving" | "declining" | "neutral" {
  if (slope > SLOPE_THRESHOLD) return "improving";
  if (slope < -SLOPE_THRESHOLD) return "declining";
  return "neutral";
}

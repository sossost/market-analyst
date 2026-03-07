/**
 * 펀더멘탈 스코어 DB 조회 헬퍼.
 *
 * 초입 포착 도구, 일간/주간 에이전트 등 소비처에서
 * fundamental_scores 테이블을 편리하게 조회할 수 있는 함수 제공.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import type {
  FundamentalGrade,
  FundamentalScore,
  SEPACriteria,
} from "../types/fundamental.js";

/**
 * 특정 날짜 기준 종목들의 펀더멘탈 등급 조회.
 * 초입 포착 도구(getPhase1LateStocks 등)에서 교집합 필터에 사용.
 *
 * @param symbols - 조회할 종목 심볼 배열
 * @param scoredDate - 기준일 (미지정 시 최신 scored_date 사용)
 * @returns symbol → FundamentalGrade 맵
 */
export async function getFundamentalGrades(
  symbols: string[],
  scoredDate?: string,
): Promise<Map<string, FundamentalGrade>> {
  if (symbols.length === 0) return new Map();

  const dateCondition =
    scoredDate != null
      ? sql`scored_date = ${scoredDate}`
      : sql`scored_date = (SELECT MAX(scored_date) FROM fundamental_scores)`;

  const BATCH_SIZE = 500;
  const result = new Map<string, FundamentalGrade>();

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const rows = await db.execute(sql`
      SELECT symbol, grade
      FROM fundamental_scores
      WHERE ${dateCondition}
        AND symbol IN ${sql`(${sql.join(batch.map((s) => sql`${s}`), sql`, `)})`}
    `);

    for (const row of rows.rows as unknown as Array<{
      symbol: string;
      grade: string;
    }>) {
      result.set(row.symbol, row.grade as FundamentalGrade);
    }
  }

  return result;
}

/**
 * 최신 날짜 기준 특정 등급 이상 종목 전체 조회.
 * 주간 에이전트 fundamentalSupplement 생성에 사용.
 *
 * @param minGrade - 최소 등급 (기본값: "B"). S > A > B > C > F 순서.
 * @param scoredDate - 기준일 (미지정 시 최신 scored_date 사용)
 * @returns FundamentalScore 배열 (등급 순 정렬)
 */
export async function getTopGradeScores(
  minGrade: FundamentalGrade = "B",
  scoredDate?: string,
): Promise<FundamentalScore[]> {
  const grades = getGradesAbove(minGrade);

  if (grades.length === 0) return [];

  const dateCondition =
    scoredDate != null
      ? sql`scored_date = ${scoredDate}`
      : sql`scored_date = (SELECT MAX(scored_date) FROM fundamental_scores)`;

  const rows = await db.execute(sql`
    SELECT symbol, grade, total_score, rank_score, required_met, bonus_met, criteria
    FROM fundamental_scores
    WHERE ${dateCondition}
      AND grade IN ${sql`(${sql.join(grades.map((g) => sql`${g}`), sql`, `)})`}
    ORDER BY
      CASE grade
        WHEN 'S' THEN 0
        WHEN 'A' THEN 1
        WHEN 'B' THEN 2
        WHEN 'C' THEN 3
        WHEN 'F' THEN 4
      END,
      rank_score DESC
  `);

  return (
    rows.rows as unknown as Array<{
      symbol: string;
      grade: string;
      total_score: number;
      rank_score: string;
      required_met: number;
      bonus_met: number;
      criteria: string;
    }>
  ).map((r) => ({
    symbol: r.symbol,
    grade: r.grade as FundamentalGrade,
    totalScore: r.total_score,
    rankScore: Number(r.rank_score),
    requiredMet: r.required_met,
    bonusMet: r.bonus_met,
    criteria: JSON.parse(r.criteria) as SEPACriteria,
  }));
}

// ─── Internal ───────────────────────────────────────────────────────

const GRADE_ORDER: Record<FundamentalGrade, number> = {
  S: 0,
  A: 1,
  B: 2,
  C: 3,
  F: 4,
};

/**
 * minGrade 이상의 등급 목록 반환.
 */
function getGradesAbove(minGrade: FundamentalGrade): FundamentalGrade[] {
  const threshold = GRADE_ORDER[minGrade];
  return (Object.keys(GRADE_ORDER) as FundamentalGrade[]).filter(
    (g) => GRADE_ORDER[g] <= threshold,
  );
}

/**
 * 펀더멘탈 검증 파이프라인.
 *
 * 전체 활성 종목 스코어링 → DB 저장 → S등급 LLM 분석 → 리포트 발행.
 * 주간 에이전트에서 호출하거나 독립 실행 가능.
 */
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { loadFundamentalData } from "../../lib/fundamental-data-loader.js";
import {
  scoreFundamentals,
  promoteTopToS,
} from "../../lib/fundamental-scorer.js";
import { analyzeFundamentals } from "./fundamentalAgent.js";
import { generateStockReport, publishStockReport } from "./stockReport.js";
import { logger } from "../logger.js";
import type { FundamentalInput, FundamentalScore } from "../../types/fundamental.js";

export interface ValidationResult {
  scores: FundamentalScore[];
  reportsPublished: string[]; // symbols that got individual reports
  totalTokens: { input: number; output: number };
}

/**
 * 전체 활성 종목 펀더멘탈 검증 수행.
 */
export async function runFundamentalValidation(
  options?: {
    /** 특정 종목만 검증 (테스트용) */
    symbols?: string[];
    /** 리포트 발행 건너뛰기 */
    skipPublish?: boolean;
    /** true면 당일 스코어가 있어도 재실행 */
    forceRescore?: boolean;
  },
): Promise<ValidationResult> {
  const totalTokens = { input: 0, output: 0 };
  const reportsPublished: string[] = [];

  // 1. 스코어링 기준일 결정
  const scoredDate = await getScoredDate();

  // ── 스코어 획득 단계 ──────────────────────────────────────────────
  // canSkip이면 DB 기존 스코어 재사용, 아니면 전체 재계산
  let scores: FundamentalScore[];
  let inputs: FundamentalInput[];

  const canSkip =
    options?.symbols == null &&
    options?.forceRescore !== true &&
    (await canSkipScoring(scoredDate));

  if (canSkip) {
    // 기존 스코어 DB 로드
    scores = await loadExistingScores(scoredDate);

    // S등급 종목만 LLM 분석용 실적 데이터 로드
    const sSymbols = scores
      .filter((s) => s.grade === "S")
      .map((s) => s.symbol);
    inputs = sSymbols.length > 0 ? await loadFundamentalData(sSymbols) : [];
  } else {
    // 2. 대상 종목 리스트
    const symbols = options?.symbols ?? (await getAllScoringSymbols());
    logger.info("Fundamental", `${symbols.length}개 종목 검증 시작`);

    if (symbols.length === 0) {
      logger.warn("Fundamental", "스코어링 대상 종목 없음 — 검증 생략");
      return { scores: [], reportsPublished, totalTokens };
    }

    // 3. DB에서 분기 실적 로드 (500개씩 배치)
    const BATCH_SIZE = 500;
    inputs = [];
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const batchInputs = await loadFundamentalData(batch);
      inputs.push(...batchInputs);
    }
    logger.info(
      "Fundamental",
      `${inputs.length}개 종목 실적 데이터 로드 완료`,
    );

    // 4. 정량 스코어링 + S등급 승격
    scores = promoteTopToS(inputs.map(scoreFundamentals));

    const gradeCount = { S: 0, A: 0, B: 0, C: 0, F: 0 };
    for (const s of scores) gradeCount[s.grade]++;
    logger.info(
      "Fundamental",
      `등급 분포: S=${gradeCount.S}, A=${gradeCount.A}, B=${gradeCount.B}, C=${gradeCount.C}, F=${gradeCount.F}`,
    );

    // 5. DB 저장 (symbols 직접 지정 시 저장 안 함 — S등급 전체 기준 불일치 방지)
    if (options?.symbols == null) {
      await saveFundamentalScoresToDB(scores, scoredDate);
    }
  }

  // 6. S급 종목에 대해 LLM 분석 (기술적 데이터 선로딩)
  const client = new Anthropic();
  const sGradeScores = scores.filter((s) => s.grade === "S");

  // 기술적 데이터를 LLM 분석 전에 로드하여 프롬프트에 포함
  const technicalMap = new Map<string, Awaited<ReturnType<typeof loadTechnicalData>>>();
  for (const score of sGradeScores) {
    const tech = await loadTechnicalData(score.symbol);
    if (tech != null) {
      technicalMap.set(score.symbol, tech);
    }
  }

  const analyses = new Map<string, string>();

  for (const score of sGradeScores) {
    const input = inputs.find((i) => i.symbol === score.symbol);
    if (input == null) continue;

    try {
      const technical = technicalMap.get(score.symbol);
      const analysis = await analyzeFundamentals(client, score, input, technical);
      analyses.set(score.symbol, analysis.narrative);
      totalTokens.input += analysis.tokensUsed.input;
      totalTokens.output += analysis.tokensUsed.output;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error(
        "Fundamental",
        `${score.symbol} LLM 분석 실패: ${reason}`,
      );
    }
  }

  // 7. S급 종목만 리포트 발행
  if (options?.skipPublish !== true) {
    for (const score of sGradeScores) {
      const input = inputs.find((i) => i.symbol === score.symbol);
      const narrative = analyses.get(score.symbol);
      if (input == null || narrative == null) continue;

      // technicalMap에 항상 존재해야 하나, 6번 스텝에서 DB 조회 실패 시 누락될 수 있어 방어적으로 재시도
      const technical = technicalMap.get(score.symbol) ?? await loadTechnicalData(score.symbol);
      const reportMd = generateStockReport({
        score,
        input,
        narrative,
        technical,
      });

      try {
        await publishStockReport(score.symbol, reportMd);
        reportsPublished.push(score.symbol);
        logger.info("Fundamental", `${score.symbol} 리포트 발행 완료`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.error(
          "Fundamental",
          `${score.symbol} 리포트 발행 실패: ${reason}`,
        );
      }
    }
  }

  return { scores, reportsPublished, totalTokens };
}

/**
 * 주간 리포트용 펀더멘탈 보조 정보 생성.
 * B 이상: 핵심 실적 한 줄, C/F: 경고 표시.
 */
export function formatFundamentalSupplement(
  scores: FundamentalScore[],
  options?: { includeHeader?: boolean },
): string {
  if (scores.length === 0) return "";

  const includeHeader = options?.includeHeader !== false;
  const lines: string[] = includeHeader
    ? ["## 펀더멘탈 검증 결과", ""]
    : [];

  const sorted = [...scores].sort(
    (a, b) => gradeOrder(a.grade) - gradeOrder(b.grade),
  );

  let cCount = 0;
  let fCount = 0;

  for (const s of sorted) {
    const { criteria } = s;

    if (s.grade === "S" || s.grade === "A" || s.grade === "B") {
      const emoji = s.grade === "S" ? "⭐" : s.grade === "A" ? "🟢" : "🔵";
      const detail =
        criteria.epsGrowth.value != null
          ? `EPS YoY +${criteria.epsGrowth.value}%`
          : "";
      lines.push(`${emoji} **${s.symbol}** [${s.grade}] — ${detail}`);
    } else if (s.grade === "C") {
      cCount++;
    } else {
      fCount++;
    }
  }

  if (cCount > 0 || fCount > 0) {
    lines.push("");
    lines.push(
      `🟡 C등급 ${cCount}개, 🔴 F등급 ${fCount}개 — 기술적 Phase 2이나 실적 미달`,
    );
  }

  return lines.join("\n");
}

// ─── DB helpers ─────────────────────────────────────────────────────

/**
 * stock_phases의 MAX(date)를 스코어링 기준일로 사용.
 */
async function getScoredDate(): Promise<string> {
  const rows = await db.execute(
    sql`SELECT MAX(date)::text AS max_date FROM stock_phases`,
  );
  const row = (rows.rows as unknown as { max_date: string | null }[])[0];
  return row?.max_date ?? new Date().toISOString().slice(0, 10);
}

/**
 * 재스코어링을 건너뛸 수 있는지 판단.
 *
 * 조건: 기존 스코어가 있고, 그 이후로 새 분기 실적이 들어오지 않았으면 스킵.
 * quarterly_financials.created_at > fundamental_scores.created_at 이면 새 실적 존재.
 */
async function canSkipScoring(scoredDate: string): Promise<boolean> {
  // 1. 기존 스코어의 마지막 저장 시점
  const scoreRows = await db.execute(sql`
    SELECT MAX(created_at) AS last_scored_at
    FROM fundamental_scores
    WHERE scored_date = ${scoredDate}
  `);
  const lastScoredAt = (
    scoreRows.rows as unknown as { last_scored_at: string | null }[]
  )[0]?.last_scored_at;

  if (lastScoredAt == null) return false; // 스코어 없음 → 실행 필요

  // 2. 마지막 스코어링 이후 새 실적이 들어왔는지
  const finRows = await db.execute(sql`
    SELECT COUNT(*)::int AS cnt
    FROM quarterly_financials
    WHERE created_at > ${lastScoredAt}::timestamptz
  `);
  const newFinancials =
    (finRows.rows as unknown as { cnt: number }[])[0]?.cnt ?? 0;

  if (newFinancials > 0) {
    logger.info(
      "Fundamental",
      `새 실적 ${newFinancials}건 감지 — 재스코어링 실행`,
    );
    return false;
  }

  logger.info(
    "Fundamental",
    `${scoredDate} 기준 스코어 존재 + 새 실적 없음 — 재사용`,
  );
  return true;
}

/**
 * 이미 DB에 저장된 스코어를 로드하여 ValidationResult로 반환.
 */
async function loadExistingScores(
  scoredDate: string,
): Promise<FundamentalScore[]> {
  const rows = await db.execute(sql`
    SELECT symbol, grade, total_score, rank_score, required_met, bonus_met, criteria
    FROM fundamental_scores
    WHERE scored_date = ${scoredDate}
    ORDER BY symbol
  `);

  const scores: FundamentalScore[] = (
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
    grade: r.grade as FundamentalScore["grade"],
    totalScore: r.total_score,
    rankScore: Number(r.rank_score),
    requiredMet: r.required_met,
    bonusMet: r.bonus_met,
    criteria: JSON.parse(r.criteria),
  }));

  logger.info(
    "Fundamental",
    `DB에서 ${scores.length}개 기존 스코어 로드 (${scoredDate})`,
  );

  return scores;
}

/**
 * 전체 활성 종목 중 분기 실적 데이터가 있는 종목 조회.
 */
async function getAllScoringSymbols(): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT f.symbol
    FROM quarterly_financials f
    JOIN symbols s ON f.symbol = s.symbol
    WHERE s.is_actively_trading = true
      AND (s.country = 'US' OR s.country IS NULL)
    ORDER BY f.symbol
  `);
  return (rows.rows as unknown as { symbol: string }[]).map((r) => r.symbol);
}

/**
 * 스코어를 DB에 배치 upsert.
 */
async function saveFundamentalScoresToDB(
  scores: FundamentalScore[],
  scoredDate: string,
): Promise<void> {
  if (scores.length === 0) return;

  const UPSERT_BATCH = 500;
  for (let i = 0; i < scores.length; i += UPSERT_BATCH) {
    const batch = scores.slice(i, i + UPSERT_BATCH);
    await db.execute(sql`
      INSERT INTO fundamental_scores
        (symbol, scored_date, grade, total_score, rank_score, required_met, bonus_met, criteria)
      VALUES
        ${sql.join(
          batch.map(
            (s) => sql`(
              ${s.symbol}, ${scoredDate}, ${s.grade},
              ${s.totalScore}, ${s.rankScore.toString()},
              ${s.requiredMet}, ${s.bonusMet},
              ${JSON.stringify(s.criteria)}
            )`,
          ),
          sql`, `,
        )}
      ON CONFLICT (symbol, scored_date) DO UPDATE SET
        grade = EXCLUDED.grade,
        total_score = EXCLUDED.total_score,
        rank_score = EXCLUDED.rank_score,
        required_met = EXCLUDED.required_met,
        bonus_met = EXCLUDED.bonus_met,
        criteria = EXCLUDED.criteria
    `);
  }

  logger.info(
    "Fundamental",
    `${scores.length}개 스코어 DB 저장 완료 (${scoredDate})`,
  );
}

// ─── Internal helpers ───────────────────────────────────────────────

async function loadTechnicalData(
  symbol: string,
): Promise<
  | {
      phase: number;
      rsScore: number;
      volumeConfirmed: boolean;
      pctFromHigh52w: number;
      marketCapB: number;
      sector: string;
      industry: string;
    }
  | undefined
> {
  const rows = await db.execute(sql`
    SELECT
      sp.phase,
      sp.rs_score,
      sp.volume_confirmed,
      sp.pct_from_high_52w,
      s.market_cap,
      s.sector,
      s.industry
    FROM stock_phases sp
    JOIN symbols s ON sp.symbol = s.symbol
    WHERE sp.symbol = ${symbol}
      AND sp.date = (SELECT MAX(date) FROM stock_phases)
    LIMIT 1
  `);

  const row = (
    rows.rows as unknown as Array<{
      phase: number;
      rs_score: number;
      volume_confirmed: boolean;
      pct_from_high_52w: string;
      market_cap: string;
      sector: string;
      industry: string;
    }>
  )[0];

  if (row == null) return undefined;

  return {
    phase: row.phase,
    rsScore: row.rs_score,
    volumeConfirmed: row.volume_confirmed ?? false,
    pctFromHigh52w: Number(row.pct_from_high_52w) * 100,
    marketCapB: Number(row.market_cap) / 1_000_000_000,
    sector: row.sector ?? "Unknown",
    industry: row.industry ?? "Unknown",
  };
}

function gradeOrder(grade: string): number {
  const order: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, F: 4 };
  return order[grade] ?? 99;
}

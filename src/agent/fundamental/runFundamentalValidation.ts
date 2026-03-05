/**
 * 펀더멘탈 검증 파이프라인.
 *
 * Phase 2 종목 리스트 → 스코어링 → A/B급 LLM 분석 → A급 리포트 발행.
 * 주간 에이전트에서 호출하거나 독립 실행 가능.
 */
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { loadFundamentalData } from "../../lib/fundamental-data-loader.js";
import { scoreFundamentals, promoteTopToS } from "../../lib/fundamental-scorer.js";
import { analyzeFundamentals } from "./fundamentalAgent.js";
import { generateStockReport, publishStockReport } from "./stockReport.js";
import { logger } from "../logger.js";
import type { FundamentalScore, FundamentalInput } from "../../types/fundamental.js";

export interface ValidationResult {
  scores: FundamentalScore[];
  reportsPublished: string[]; // symbols that got individual reports
  totalTokens: { input: number; output: number };
}

/**
 * Phase 2 종목을 가져와 펀더멘탈 검증 수행.
 */
export async function runFundamentalValidation(
  options?: {
    /** 특정 종목만 검증 (테스트용) */
    symbols?: string[];
    /** 리포트 발행 건너뛰기 */
    skipPublish?: boolean;
  },
): Promise<ValidationResult> {
  const totalTokens = { input: 0, output: 0 };
  const reportsPublished: string[] = [];

  // 1. Phase 2 종목 리스트 가져오기
  const symbols = options?.symbols ?? (await getPhase2Symbols());
  logger.info("Fundamental", `${symbols.length}개 종목 검증 시작`);

  if (symbols.length === 0) {
    logger.warn("Fundamental", "Phase 2 종목 없음 — 검증 생략");
    return { scores: [], reportsPublished, totalTokens };
  }

  // 2. DB에서 분기 실적 로드
  const inputs = await loadFundamentalData(symbols);
  logger.info("Fundamental", `${inputs.length}개 종목 실적 데이터 로드 완료`);

  // 3. 정량 스코어링 + S등급 승격
  const scores = promoteTopToS(inputs.map(scoreFundamentals));

  const gradeCount = { S: 0, A: 0, B: 0, C: 0, F: 0 };
  for (const s of scores) gradeCount[s.grade]++;
  logger.info("Fundamental", `등급 분포: S=${gradeCount.S}, A=${gradeCount.A}, B=${gradeCount.B}, C=${gradeCount.C}, F=${gradeCount.F}`);

  // 4. S/A/B급 종목에 대해 LLM 분석
  const client = new Anthropic();
  const aOrBScores = scores.filter((s) => s.grade === "S" || s.grade === "A" || s.grade === "B");

  const analyses = new Map<string, string>();

  for (const score of aOrBScores) {
    const input = inputs.find((i) => i.symbol === score.symbol);
    if (input == null) continue;

    try {
      const analysis = await analyzeFundamentals(client, score, input);
      analyses.set(score.symbol, analysis.narrative);
      totalTokens.input += analysis.tokensUsed.input;
      totalTokens.output += analysis.tokensUsed.output;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error("Fundamental", `${score.symbol} LLM 분석 실패: ${reason}`);
    }
  }

  // 5. S급 종목만 리포트 발행 (A급 top 3)
  if (options?.skipPublish !== true) {
    const aGradeScores = scores.filter((s) => s.grade === "S");

    for (const score of aGradeScores) {
      const input = inputs.find((i) => i.symbol === score.symbol);
      const narrative = analyses.get(score.symbol);
      if (input == null || narrative == null) continue;

      const technical = await loadTechnicalData(score.symbol);
      const reportMd = generateStockReport({ score, input, narrative, technical });

      try {
        await publishStockReport(score.symbol, reportMd);
        reportsPublished.push(score.symbol);
        logger.info("Fundamental", `${score.symbol} 리포트 발행 완료`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        logger.error("Fundamental", `${score.symbol} 리포트 발행 실패: ${reason}`);
      }
    }
  }

  return { scores, reportsPublished, totalTokens };
}

/**
 * 주간 리포트용 펀더멘탈 보조 정보 생성.
 * B 이상: 핵심 실적 한 줄, C/F: 경고 표시.
 */
export function formatFundamentalSupplement(scores: FundamentalScore[]): string {
  if (scores.length === 0) return "";

  const lines: string[] = ["## 펀더멘탈 검증 결과", ""];

  const sorted = [...scores].sort((a, b) => gradeOrder(a.grade) - gradeOrder(b.grade));

  for (const s of sorted) {
    const { criteria } = s;
    const emoji = s.grade === "S" ? "⭐" : s.grade === "A" ? "🟢" : s.grade === "B" ? "🔵" : s.grade === "C" ? "🟡" : "🔴";

    if (s.grade === "S" || s.grade === "A" || s.grade === "B") {
      const detail = criteria.epsGrowth.value != null ? `EPS YoY +${criteria.epsGrowth.value}%` : "";
      lines.push(`${emoji} **${s.symbol}** [${s.grade}] — ${detail}`);
    } else if (s.grade === "C") {
      lines.push(`${emoji} **${s.symbol}** [C] — 기술적으로만 Phase 2, 실적 주의`);
    } else {
      lines.push(`${emoji} **${s.symbol}** [F] — 펀더멘탈 미달`);
    }
  }

  return lines.join("\n");
}

// ─── Internal helpers ───────────────────────────────────────────────

async function getPhase2Symbols(): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT symbol
    FROM stock_phases
    WHERE phase = 2
      AND date = (SELECT MAX(date) FROM stock_phases)
    ORDER BY symbol
  `);
  return (rows.rows as unknown as { symbol: string }[]).map((r) => r.symbol);
}

async function loadTechnicalData(
  symbol: string,
): Promise<{
  phase: number;
  rsScore: number;
  volumeConfirmed: boolean;
  pctFromHigh52w: number;
  marketCapB: number;
  sector: string;
  industry: string;
} | undefined> {
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

  const row = (rows.rows as unknown as Array<{
    phase: number;
    rs_score: number;
    volume_confirmed: boolean;
    pct_from_high_52w: string;
    market_cap: string;
    sector: string;
    industry: string;
  }>)[0];

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

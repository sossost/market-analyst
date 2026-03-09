import { db } from "../../db/client.js";
import {
  marketRegimes,
  type MarketRegimeType,
  type RegimeConfidence,
} from "../../db/schema/analyst.js";
import { desc, sql } from "drizzle-orm";
import { logger } from "../logger.js";

const VALID_REGIMES = new Set<string>([
  "EARLY_BULL",
  "MID_BULL",
  "LATE_BULL",
  "EARLY_BEAR",
  "BEAR",
]);

const VALID_CONFIDENCE = new Set<string>(["low", "medium", "high"]);

export interface MarketRegimeInput {
  regime: MarketRegimeType;
  rationale: string;
  confidence: RegimeConfidence;
}

export interface MarketRegimeRow {
  regimeDate: string;
  regime: MarketRegimeType;
  rationale: string;
  confidence: RegimeConfidence;
}

/**
 * Validate raw regime object from LLM output.
 * Returns normalized input or null if invalid.
 */
export function validateRegimeInput(raw: unknown): MarketRegimeInput | null {
  if (raw == null || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.regime !== "string" || !VALID_REGIMES.has(obj.regime)) {
    logger.warn("RegimeStore", `Invalid regime: ${String(obj.regime)}`);
    return null;
  }
  if (typeof obj.rationale !== "string" || obj.rationale.length === 0) {
    logger.warn("RegimeStore", "Missing rationale");
    return null;
  }
  const confidence =
    typeof obj.confidence === "string" && VALID_CONFIDENCE.has(obj.confidence)
      ? obj.confidence
      : "low"; // fallback

  return {
    regime: obj.regime as MarketRegimeType,
    rationale: obj.rationale,
    confidence: confidence as RegimeConfidence,
  };
}

/**
 * Save regime to DB. Upserts on regime_date (UNIQUE constraint).
 */
export async function saveRegime(
  date: string,
  input: MarketRegimeInput,
): Promise<void> {
  await db
    .insert(marketRegimes)
    .values({
      regimeDate: date,
      regime: input.regime,
      rationale: input.rationale,
      confidence: input.confidence,
    })
    .onConflictDoUpdate({
      target: marketRegimes.regimeDate,
      set: {
        regime: sql`excluded.regime`,
        rationale: sql`excluded.rationale`,
        confidence: sql`excluded.confidence`,
      },
    });

  logger.info(
    "RegimeStore",
    `Regime saved: ${date} → ${input.regime} (${input.confidence})`,
  );
}

/**
 * Load the most recent regime.
 */
export async function loadLatestRegime(): Promise<MarketRegimeRow | null> {
  const rows = await db
    .select({
      regimeDate: marketRegimes.regimeDate,
      regime: marketRegimes.regime,
      rationale: marketRegimes.rationale,
      confidence: marketRegimes.confidence,
    })
    .from(marketRegimes)
    .orderBy(desc(marketRegimes.regimeDate))
    .limit(1);

  return (rows[0] as MarketRegimeRow | undefined) ?? null;
}

/**
 * Load recent N days of regimes, ordered newest first.
 */
export async function loadRecentRegimes(
  days: number,
): Promise<MarketRegimeRow[]> {
  return db
    .select({
      regimeDate: marketRegimes.regimeDate,
      regime: marketRegimes.regime,
      rationale: marketRegimes.rationale,
      confidence: marketRegimes.confidence,
    })
    .from(marketRegimes)
    .orderBy(desc(marketRegimes.regimeDate))
    .limit(days) as Promise<MarketRegimeRow[]>;
}

const REGIME_LABEL: Record<MarketRegimeType, string> = {
  EARLY_BULL: "초기 강세",
  MID_BULL: "중기 강세",
  LATE_BULL: "후기 강세 (과열 경계)",
  EARLY_BEAR: "초기 약세 (방어 전환)",
  BEAR: "약세장 (위양성 주의)",
};

const REGIME_GUIDE: Record<MarketRegimeType, string> = {
  EARLY_BULL: "바닥 돌파 신호 적극 포착. Phase 1→2 전환 종목에 주목.",
  MID_BULL: "정상적 상승 국면. 주도섹터/주도주 포착에 집중.",
  LATE_BULL: "과열 경계. 소수 종목 집중, 브레드스 약화 주의. 신규 추천에 보수적 접근.",
  EARLY_BEAR: "방어 전환 필요. 신규 Phase 2 추천 최소화. 기존 포지션 재평가.",
  BEAR: "약세장. Phase 2 신호 신뢰도 매우 낮음. 현금 비중 확대 고려.",
};

/**
 * Format recent regimes for prompt injection.
 * Returns empty string if no data.
 */
export function formatRegimeForPrompt(rows: MarketRegimeRow[]): string {
  if (rows.length === 0) return "";

  const latest = rows[0];
  const label = REGIME_LABEL[latest.regime] ?? latest.regime;
  const lines = [
    `## 시장 레짐 현황`,
    ``,
    `**현재 레짐: ${latest.regime} — ${label}** (${latest.confidence} confidence)`,
    `근거: ${latest.rationale}`,
  ];

  if (rows.length > 1) {
    lines.push("", "### 최근 레짐 히스토리");
    for (const r of rows.slice(0, 14)) {
      lines.push(`- ${r.regimeDate}: ${r.regime} (${r.confidence})`);
    }
  }

  // 레짐별 행동 가이드
  lines.push("", "### 레짐별 참고 사항");
  const guide = REGIME_GUIDE[latest.regime] ?? `레짐 ${latest.regime}에 대한 가이드 없음`;
  lines.push(`- ${guide}`);

  return lines.join("\n");
}

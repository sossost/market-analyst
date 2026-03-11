import { pool } from "@/db/client";
import { logger } from "./logger";

export interface SendGateResult {
  shouldSend: boolean;
  reasons: string[];
}

const PHASE1_TO_2_THRESHOLD = 10;
const UNUSUAL_STOCK_THRESHOLD = 3;

/**
 * 투자 브리핑 발송 게이트.
 * 5개 OR 조건 중 하나라도 충족하면 shouldSend: true.
 * DB 오류 시 안전하게 shouldSend: true 반환 (발송 누락 방지).
 */
export async function evaluateDailySendGate(
  targetDate: string,
): Promise<SendGateResult> {
  const reasons: string[] = [];

  try {
    const results = await Promise.allSettled([
      checkSectorTransition(targetDate),
      checkRsNewEntrant(targetDate),
      checkRegimeChange(targetDate),
      checkUnusualPhaseStocks(targetDate),
      checkPhase1to2Surge(targetDate),
    ]);

    let hasError = false;
    for (const result of results) {
      if (result.status === "fulfilled" && result.value != null) {
        reasons.push(result.value);
      }
      if (result.status === "rejected") {
        logger.warn("SendGate", `Condition check failed: ${result.reason}`);
        hasError = true;
      }
    }

    if (hasError) {
      reasons.push("게이트 조건 일부 평가 실패 — 안전 발송 포함");
    }

    return { shouldSend: reasons.length > 0, reasons };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("SendGate", `Gate evaluation failed: ${msg}`);
    return { shouldSend: true, reasons: ["게이트 평가 실패 — 안전 발송"] };
  }
}

/** 조건 1: 섹터 group_phase 1→2 전환 */
async function checkSectorTransition(date: string): Promise<string | null> {
  const { rows } = await pool.query<{ sector: string }>(
    `SELECT sector FROM sector_rs_daily
     WHERE date = $1 AND group_phase = 2 AND prev_group_phase = 1`,
    [date],
  );

  if (rows.length === 0) return null;

  const sectors = rows.map((r) => r.sector).join(", ");
  return `섹터 Phase 1→2 전환: ${sectors}`;
}

/** 조건 2: change_4w 상위 3위에 새 섹터 진입 */
async function checkRsNewEntrant(date: string): Promise<string | null> {
  const { rows } = await pool.query<{ sector: string; is_new: boolean }>(
    `WITH today AS (
       SELECT sector, change_4w::numeric AS c4w,
              ROW_NUMBER() OVER (ORDER BY change_4w::numeric DESC) AS rn
       FROM sector_rs_daily WHERE date = $1
     ),
     prev AS (
       SELECT sector, change_4w::numeric AS c4w,
              ROW_NUMBER() OVER (ORDER BY change_4w::numeric DESC) AS rn
       FROM sector_rs_daily WHERE date = (
         SELECT MAX(date) FROM sector_rs_daily WHERE date < $1
       )
     )
     SELECT t.sector, NOT EXISTS (
       SELECT 1 FROM prev p WHERE p.sector = t.sector AND p.rn <= 3
     ) AS is_new
     FROM today t WHERE t.rn <= 3`,
    [date],
  );

  const newEntrants = rows.filter((r) => r.is_new);
  if (newEntrants.length === 0) return null;

  const sectors = newEntrants.map((r) => r.sector).join(", ");
  return `RS 급상승 신규 진입: ${sectors}`;
}

/** 조건 3: 최근 2일간 레짐 변경 */
async function checkRegimeChange(date: string): Promise<string | null> {
  const { rows } = await pool.query<{ regime: string }>(
    `SELECT regime FROM market_regimes
     WHERE regime_date <= $1
     ORDER BY regime_date DESC LIMIT 2`,
    [date],
  );

  if (rows.length < 2) return null;
  if (rows[0].regime === rows[1].regime) return null;

  return `레짐 변화 감지: ${rows[1].regime} → ${rows[0].regime}`;
}

/** 조건 4: Phase 1→2 전환 + 거래량 2배 이상 종목 N개 이상 */
async function checkUnusualPhaseStocks(date: string): Promise<string | null> {
  const { rows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM stock_phases
     WHERE date = $1
       AND phase = 2 AND prev_phase = 1
       AND vol_ratio >= 2.0`,
    [date],
  );

  const count = Number(rows[0]?.cnt ?? 0);
  if (count < UNUSUAL_STOCK_THRESHOLD) return null;

  return `Phase 1→2 전환 + 거래량 급증 종목 ${count}개`;
}

/** 조건 5: phase1to2_count_5d 상위 2개 섹터 합산 N개 이상 */
async function checkPhase1to2Surge(date: string): Promise<string | null> {
  const { rows } = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(phase1to2_count_5d), 0)::text AS total
     FROM (
       SELECT phase1to2_count_5d FROM sector_rs_daily
       WHERE date = $1
       ORDER BY phase1to2_count_5d DESC
       LIMIT 2
     ) sub`,
    [date],
  );

  const total = Number(rows[0]?.total ?? 0);
  if (total < PHASE1_TO_2_THRESHOLD) return null;

  return `Phase 1→2 다수 전환: 상위 2개 섹터 합산 ${total}개`;
}

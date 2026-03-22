import {
  findSectorsWithPhaseTransition,
  findRsNewEntrants,
  findRecentRegimes,
  countUnusualPhaseStocks,
  findPhase1to2SurgeSectors,
} from "@/db/repositories/index.js";
import { logger } from "@/lib/logger";

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
  const rows = await findSectorsWithPhaseTransition(date);

  if (rows.length === 0) return null;

  const sectors = rows.map((r) => r.sector).join(", ");
  return `섹터 Phase 1→2 전환: ${sectors}`;
}

/** 조건 2: change_4w 상위 3위에 새 섹터 진입 */
async function checkRsNewEntrant(date: string): Promise<string | null> {
  const rows = await findRsNewEntrants(date);

  const newEntrants = rows.filter((r) => r.is_new);
  if (newEntrants.length === 0) return null;

  const sectors = newEntrants.map((r) => r.sector).join(", ");
  return `RS 급상승 신규 진입: ${sectors}`;
}

/** 조건 3: 최근 2일간 레짐 변경 */
async function checkRegimeChange(date: string): Promise<string | null> {
  const rows = await findRecentRegimes(date, 2);

  if (rows.length < 2) return null;
  if (rows[0].regime === rows[1].regime) return null;

  return `레짐 변화 감지: ${rows[1].regime} → ${rows[0].regime}`;
}

/** 조건 4: Phase 1→2 전환 + 거래량 2배 이상 종목 N개 이상 */
async function checkUnusualPhaseStocks(date: string): Promise<string | null> {
  const row = await countUnusualPhaseStocks(date);

  const count = Number(row.cnt ?? 0);
  if (count < UNUSUAL_STOCK_THRESHOLD) return null;

  return `Phase 1→2 전환 + 거래량 급증 종목 ${count}개`;
}

/** 조건 5: phase1to2_count_5d 상위 2개 섹터 합산 N개 이상 */
async function checkPhase1to2Surge(date: string): Promise<string | null> {
  const row = await findPhase1to2SurgeSectors(date);

  const total = Number(row.total ?? 0);
  if (total < PHASE1_TO_2_THRESHOLD) return null;

  return `Phase 1→2 다수 전환: 상위 2개 섹터 합산 ${total}개`;
}

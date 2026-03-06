/**
 * signal_log 백필 스크립트.
 *
 * 과거 Phase 1→2 전환 시그널을 signal_log 테이블에 일괄 INSERT하고,
 * 이후 가격 데이터를 기반으로 수익률까지 계산하여 CLOSED 상태로 저장한다.
 *
 * - 기존 record-new-signals.ts가 "오늘 하루" 처리한다면,
 *   이 스크립트는 과거 전체 범위를 한 번에 처리.
 * - 이미 존재하는 (symbol, entry_date) 조합은 스킵.
 *
 * Usage:
 *   npx tsx scripts/backfill-signal-log.ts
 *   npx tsx scripts/backfill-signal-log.ts --from 2025-10-01
 *   npx tsx scripts/backfill-signal-log.ts --dry-run
 */
import "dotenv/config";
import { pool } from "../src/db/client.js";
import {
  filterSignalsByParams,
  computeSignalReturns,
  DEFAULT_SIGNAL_PARAMS,
} from "../src/lib/signal-logic.js";
import type { RawSignal } from "../src/lib/signal-logic.js";

const HOLD_PERIODS = [5, 10, 20, 60] as const;
const MAX_HOLD = 60;
const BATCH_SIZE = 200;

interface BackfillSignal extends RawSignal {
  entryPrice: number;
}

async function main() {
  const { from, dryRun } = parseArgs();

  console.log("=== signal_log 백필 ===");
  if (dryRun) console.log("  (DRY RUN — DB 변경 없음)");

  // 1. Phase 1→2 전환 시그널 전체 조회
  const signals = await findPhase2Entries(from);
  console.log(`Phase 1→2 전환: ${signals.length}건`);

  if (signals.length === 0) {
    await pool.end();
    return;
  }

  // 2. 이미 기록된 시그널 제외
  const { rows: existingRows } = await pool.query<{
    symbol: string;
    entry_date: string;
  }>(`SELECT symbol, entry_date FROM signal_log`);

  const existingKeys = new Set(
    existingRows.map((r) => `${r.symbol}:${r.entry_date}`),
  );

  const newSignals = signals.filter(
    (s) => !existingKeys.has(`${s.symbol}:${s.date}`),
  );
  console.log(`이미 기록: ${signals.length - newSignals.length}건, 신규: ${newSignals.length}건`);

  if (newSignals.length === 0) {
    console.log("백필할 시그널 없음.");
    await pool.end();
    return;
  }

  // 3. 파라미터 기준 필터링 (기본값 사용)
  const params = DEFAULT_SIGNAL_PARAMS;
  const filtered = filterSignalsByParams(newSignals, params);
  console.log(
    `파라미터 필터 (RS>=${params.rsThreshold}, Vol=${params.volumeRequired}): ${filtered.length}건 통과`,
  );

  if (filtered.length === 0) {
    await pool.end();
    return;
  }

  // 4. 각 시그널의 수익률 계산 + INSERT
  const paramsJson = JSON.stringify(params);
  let insertCount = 0;
  let closedCount = 0;

  for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
    const batch = filtered.slice(i, i + BATCH_SIZE);

    for (const signal of batch) {
      const returnData = await calculateHistoricalReturns(signal);

      if (dryRun) {
        insertCount++;
        if (returnData.status === "CLOSED") closedCount++;
        continue;
      }

      await pool.query(
        `INSERT INTO signal_log (
          symbol, entry_date, entry_price,
          rs_score, volume_confirmed, sector_group_phase, sector, industry,
          params_snapshot,
          return_5d, return_10d, return_20d, return_60d,
          phase_exit_date, phase_exit_return, max_return,
          status, days_held, last_updated
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        ON CONFLICT (symbol, entry_date) DO NOTHING`,
        [
          signal.symbol,
          signal.date,
          String(signal.price),
          signal.rsScore,
          signal.volumeConfirmed,
          signal.sectorGroupPhase,
          signal.sector,
          signal.industry,
          paramsJson,
          returnData.return5d != null ? String(returnData.return5d) : null,
          returnData.return10d != null ? String(returnData.return10d) : null,
          returnData.return20d != null ? String(returnData.return20d) : null,
          returnData.return60d != null ? String(returnData.return60d) : null,
          returnData.phaseExitDate,
          returnData.phaseExitReturn != null
            ? String(returnData.phaseExitReturn)
            : null,
          returnData.maxReturn != null ? String(returnData.maxReturn) : null,
          returnData.status,
          returnData.daysHeld,
          returnData.lastDate ?? signal.date,
        ],
      );

      insertCount++;
      if (returnData.status === "CLOSED") closedCount++;
    }

    process.stdout.write(
      `  ${Math.min(i + BATCH_SIZE, filtered.length)}/${filtered.length}\r`,
    );
  }

  console.log(
    `\n완료. INSERT: ${insertCount}건, CLOSED: ${closedCount}건, ACTIVE: ${insertCount - closedCount}건`,
  );
  await pool.end();
}

// ── 시그널 수집 ──
async function findPhase2Entries(from: string | null): Promise<BackfillSignal[]> {
  const { rows } = await pool.query<{
    symbol: string;
    date: string;
    close: string;
    rs_score: number | null;
    volume_confirmed: boolean | null;
    sector: string | null;
    industry: string | null;
    sector_group_phase: number | null;
  }>(
    `SELECT
       sp.symbol,
       sp.date,
       dp.close::text,
       sp.rs_score,
       sp.volume_confirmed,
       s.sector,
       s.industry,
       srd.group_phase AS sector_group_phase
     FROM stock_phases sp
     JOIN daily_prices dp ON dp.symbol = sp.symbol AND dp.date = sp.date
     LEFT JOIN symbols s ON s.symbol = sp.symbol
     LEFT JOIN sector_rs_daily srd ON srd.date = sp.date AND srd.sector = s.sector
     WHERE sp.phase = 2
       AND sp.prev_phase IS DISTINCT FROM 2
       AND dp.close IS NOT NULL
       ${from != null ? "AND sp.date >= $1" : ""}
     ORDER BY sp.date ASC`,
    from != null ? [from] : [],
  );

  return rows.map((r) => ({
    symbol: r.symbol,
    date: r.date,
    price: parseFloat(r.close),
    entryPrice: parseFloat(r.close),
    rsScore: r.rs_score,
    volumeConfirmed: r.volume_confirmed,
    sectorGroupPhase: r.sector_group_phase,
    sector: r.sector,
    industry: r.industry,
  }));
}

// ── 과거 수익률 계산 ──
interface HistoricalReturn {
  return5d: number | null;
  return10d: number | null;
  return20d: number | null;
  return60d: number | null;
  phaseExitDate: string | null;
  phaseExitReturn: number | null;
  maxReturn: number | null;
  status: "ACTIVE" | "CLOSED";
  daysHeld: number;
  lastDate: string | null;
}

async function calculateHistoricalReturns(
  signal: BackfillSignal,
): Promise<HistoricalReturn> {
  const { rows } = await pool.query<{
    date: string;
    close: string;
    phase: number | null;
    row_num: string;
  }>(
    `SELECT dp.date, dp.close::text, sp.phase,
            ROW_NUMBER() OVER (ORDER BY dp.date) AS row_num
     FROM daily_prices dp
     LEFT JOIN stock_phases sp ON sp.symbol = dp.symbol AND sp.date = dp.date
     WHERE dp.symbol = $1
       AND dp.date > $2
       AND dp.close IS NOT NULL
     ORDER BY dp.date ASC
     LIMIT $3`,
    [signal.symbol, signal.date, MAX_HOLD],
  );

  let return5d: number | null = null;
  let return10d: number | null = null;
  let return20d: number | null = null;
  let return60d: number | null = null;
  let phaseExitDate: string | null = null;
  let phaseExitReturn: number | null = null;
  let maxReturn: number | null = null;
  let lastDate: string | null = null;
  let daysHeld = 0;

  for (const row of rows) {
    const dayNum = parseInt(row.row_num, 10);
    const price = parseFloat(row.close);
    const ret = ((price - signal.entryPrice) / signal.entryPrice) * 100;
    const roundedRet = Math.round(ret * 100) / 100;

    if (maxReturn == null || roundedRet > maxReturn) {
      maxReturn = roundedRet;
    }

    daysHeld = dayNum;
    lastDate = row.date;

    if (dayNum === 5) return5d = roundedRet;
    if (dayNum === 10) return10d = roundedRet;
    if (dayNum === 20) return20d = roundedRet;
    if (dayNum === 60) return60d = roundedRet;

    // Phase 2 이탈
    if (phaseExitDate == null && row.phase != null && row.phase !== 2) {
      phaseExitDate = row.date;
      phaseExitReturn = roundedRet;
    }
  }

  // 60일 이상이거나 Phase 이탈 시 CLOSED
  const isClosed = daysHeld >= MAX_HOLD || phaseExitDate != null;

  return {
    return5d,
    return10d,
    return20d,
    return60d,
    phaseExitDate,
    phaseExitReturn,
    maxReturn,
    status: isClosed ? "CLOSED" : "ACTIVE",
    daysHeld,
    lastDate,
  };
}

// ── 인자 파싱 ──
function parseArgs(): { from: string | null; dryRun: boolean } {
  const args = process.argv.slice(2);
  let from: string | null = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const nextArg = args[i + 1];
    if (args[i] === "--from" && nextArg != null && !nextArg.startsWith("--")) {
      from = args[++i];
    }
    if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  return { from, dryRun };
}

main().catch(async (err) => {
  console.error("Backfill failed:", err instanceof Error ? err.message : String(err));
  await pool.end();
  process.exit(1);
});

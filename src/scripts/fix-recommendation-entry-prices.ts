/**
 * 일회성 정정 스크립트: ACTIVE 추천의 오염된 entry_price를 실제 종가로 교정.
 *
 * 문제:
 *   - LLM hallucination으로 entry_price가 실제 추천일 종가와 다르게 저장된 사례 존재.
 *   - 예: DAWN ID 11 — entry_price=$3.77, 실제 추천일 종가=$9~10
 *
 * 수행 작업:
 *   1. 모든 ACTIVE 추천 조회
 *   2. (symbol, recommendation_date) 기준으로 daily_prices 실제 종가 조회
 *   3. 차이가 10% 이상이면 entry_price를 실제 종가로 UPDATE + PnL 재계산
 *   4. 같은 symbol의 중복 ACTIVE 추천(다른 날짜) 중 오래된 것을 CLOSED로 변경
 *
 * 사용법:
 *   dry-run (기본): npx tsx src/scripts/fix-recommendation-entry-prices.ts
 *   실행 모드:       npx tsx src/scripts/fix-recommendation-entry-prices.ts --execute
 */
import "dotenv/config";
import { db, pool } from "../db/client.js";
import { sql } from "drizzle-orm";

/** LLM 진입가와 DB 종가의 허용 괴리 비율 (10%) — saveRecommendations.ts와 동일 */
const PRICE_DIVERGENCE_THRESHOLD = 0.10;
const DUPLICATE_CLOSE_REASON = "DUPLICATE_CLEANUP";

const isExecuteMode = process.argv.includes("--execute");

interface ActiveRecommendation {
  id: number;
  symbol: string;
  recommendation_date: string;
  entry_price: string;
  current_price: string | null;
  pnl_percent: string | null;
  max_pnl_percent: string | null;
}

interface PriceFixCandidate {
  rec: ActiveRecommendation;
  actualClose: number;
  currentEntryPrice: number;
  deviationRatio: number;
}

interface DuplicateGroup {
  symbol: string;
  ids: number[];
  dates: string[];
}

async function fetchActiveRecommendations(): Promise<ActiveRecommendation[]> {
  const result = await db.execute(sql`
    SELECT id, symbol, recommendation_date, entry_price,
           current_price, pnl_percent, max_pnl_percent
    FROM recommendations
    WHERE status = 'ACTIVE'
    ORDER BY symbol, recommendation_date
  `);
  return result.rows as unknown as ActiveRecommendation[];
}

/** 일괄 조회: 모든 ACTIVE 추천의 (symbol, date) 기준 실제 종가 */
async function fetchActualCloses(
  recs: ActiveRecommendation[],
): Promise<Map<string, number>> {
  // (symbol, date) 쌍으로 일괄 조회
  const result = await db.execute(sql`
    SELECT dp.symbol, dp.date::text AS rec_date, dp.close
    FROM daily_prices dp
    INNER JOIN recommendations r
      ON dp.symbol = r.symbol AND dp.date = r.recommendation_date
    WHERE r.status = 'ACTIVE'
  `);

  const priceMap = new Map<string, number>();
  for (const row of result.rows as unknown as Array<{ symbol: string; rec_date: string; close: string }>) {
    const key = `${row.symbol}:${row.rec_date}`;
    priceMap.set(key, parseFloat(row.close));
  }
  return priceMap;
}

function computePnlPercent(
  currentPrice: number,
  newEntryPrice: number,
): number {
  return ((currentPrice - newEntryPrice) / newEntryPrice) * 100;
}

function detectPriceFixCandidates(
  recs: ActiveRecommendation[],
  priceMap: Map<string, number>,
): PriceFixCandidate[] {
  const candidates: PriceFixCandidate[] = [];

  for (const rec of recs) {
    const currentEntryPrice = parseFloat(rec.entry_price);
    const key = `${rec.symbol}:${rec.recommendation_date}`;
    const actualClose = priceMap.get(key);

    if (actualClose == null) {
      process.stdout.write(
        `  [SKIP] ID=${rec.id} ${rec.symbol} (${rec.recommendation_date}) — daily_prices 데이터 없음\n`,
      );
      continue;
    }

    const deviationRatio =
      Math.abs(actualClose - currentEntryPrice) / currentEntryPrice;

    if (deviationRatio >= PRICE_DIVERGENCE_THRESHOLD) {
      candidates.push({
        rec,
        actualClose,
        currentEntryPrice,
        deviationRatio,
      });
    }
  }

  return candidates;
}

function detectDuplicateGroups(
  recs: ActiveRecommendation[],
): DuplicateGroup[] {
  const symbolMap = new Map<
    string,
    Array<{ id: number; date: string }>
  >();

  for (const rec of recs) {
    const existing = symbolMap.get(rec.symbol) ?? [];
    existing.push({ id: rec.id, date: rec.recommendation_date });
    symbolMap.set(rec.symbol, existing);
  }

  const duplicates: DuplicateGroup[] = [];
  for (const [symbol, entries] of symbolMap.entries()) {
    if (entries.length <= 1) {
      continue;
    }
    // 날짜 오름차순 정렬 — 오래된 것부터 앞에 위치
    entries.sort((a, b) => a.date.localeCompare(b.date));
    duplicates.push({
      symbol,
      ids: entries.map((e) => e.id),
      dates: entries.map((e) => e.date),
    });
  }

  return duplicates;
}

async function applyPriceFix(candidate: PriceFixCandidate): Promise<void> {
  const { rec, actualClose } = candidate;
  const currentPrice =
    rec.current_price != null ? parseFloat(rec.current_price) : null;

  const newPnlPercent =
    currentPrice != null
      ? computePnlPercent(currentPrice, actualClose)
      : null;

  // max_pnl_percent도 교정된 entry_price 기준으로 재계산.
  // 과거 오염된 entry_price로 계산된 max는 무효이므로,
  // 현재 pnl_percent를 max로 사용 (이력 없이 복원 불가).
  const newMaxPnlPercent = newPnlPercent;

  await db.execute(sql`
    UPDATE recommendations
    SET
      entry_price      = ${actualClose},
      pnl_percent      = ${newPnlPercent},
      max_pnl_percent  = ${newMaxPnlPercent}
    WHERE id = ${rec.id}
  `);
}

async function applyDuplicateClose(
  group: DuplicateGroup,
): Promise<void> {
  // 가장 최신 ID(마지막 인덱스)만 ACTIVE 유지, 나머지를 CLOSED 처리
  const idsToClose = group.ids.slice(0, group.ids.length - 1);

  for (const id of idsToClose) {
    await db.execute(sql`
      UPDATE recommendations
      SET
        status      = 'CLOSED',
        close_reason = ${DUPLICATE_CLOSE_REASON}
      WHERE id = ${id}
    `);
  }
}

function formatPct(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const mode = isExecuteMode ? "EXECUTE" : "DRY-RUN";
  process.stdout.write(`\n=== fix-recommendation-entry-prices [${mode}] ===\n\n`);

  if (!isExecuteMode) {
    process.stdout.write(
      "DRY-RUN 모드: 실제 DB 변경 없음. --execute 플래그로 실행 가능.\n\n",
    );
  }

  const recs = await fetchActiveRecommendations();
  process.stdout.write(`ACTIVE 추천 수: ${recs.length}개\n\n`);

  // --- 1. 가격 교정 후보 탐지 ---
  process.stdout.write("--- [1/2] entry_price 교정 후보 스캔 ---\n");
  const priceMap = await fetchActualCloses(recs);
  const candidates = detectPriceFixCandidates(recs, priceMap);

  if (candidates.length === 0) {
    process.stdout.write("  교정 대상 없음 (편차 10% 미만)\n");
  } else {
    process.stdout.write(`  교정 대상: ${candidates.length}개\n\n`);
    for (const c of candidates) {
      const currentPrice =
        c.rec.current_price != null
          ? parseFloat(c.rec.current_price)
          : null;
      const newPnl =
        currentPrice != null
          ? computePnlPercent(currentPrice, c.actualClose)
          : null;
      // 교정된 entry_price 기준으로 max도 재계산 (이력 없으므로 pnl과 동일)
      const newMax = newPnl;

      process.stdout.write(
        `  ID=${c.rec.id} ${c.rec.symbol} (${c.rec.recommendation_date})\n` +
          `    entry_price:     $${c.currentEntryPrice.toFixed(4)} → $${c.actualClose.toFixed(4)} (편차 ${formatPct(c.deviationRatio)})\n` +
          `    pnl_percent:     ${c.rec.pnl_percent ?? "null"} → ${newPnl != null ? newPnl.toFixed(2) : "null"}\n` +
          `    max_pnl_percent: ${c.rec.max_pnl_percent ?? "null"} → ${newMax != null ? newMax.toFixed(2) : "null"}\n`,
      );
    }
  }

  // --- 2. 중복 ACTIVE 추천 탐지 ---
  process.stdout.write("\n--- [2/2] 중복 ACTIVE 추천 탐지 ---\n");
  const duplicates = detectDuplicateGroups(recs);

  if (duplicates.length === 0) {
    process.stdout.write("  중복 없음\n");
  } else {
    process.stdout.write(`  중복 심볼: ${duplicates.length}개\n\n`);
    for (const group of duplicates) {
      const idsToClose = group.ids.slice(0, group.ids.length - 1);
      const keepId = group.ids[group.ids.length - 1];
      process.stdout.write(
        `  ${group.symbol}\n` +
          `    전체 ACTIVE: ID=${group.ids.join(", ")} (날짜: ${group.dates.join(", ")})\n` +
          `    CLOSED 처리: ID=${idsToClose.join(", ")}\n` +
          `    ACTIVE 유지: ID=${keepId}\n`,
      );
    }
  }

  if (!isExecuteMode) {
    process.stdout.write(
      "\n[DRY-RUN 완료] 위 내용을 반영하려면 --execute 플래그로 재실행하세요.\n",
    );
    await pool.end();
    return;
  }

  // --- 실행 모드: DB 반영 ---
  process.stdout.write("\n--- DB 반영 시작 ---\n");

  let priceFixCount = 0;
  for (const c of candidates) {
    await applyPriceFix(c);
    priceFixCount++;
    process.stdout.write(
      `  [FIXED] ID=${c.rec.id} ${c.rec.symbol} entry_price: $${c.currentEntryPrice.toFixed(4)} → $${c.actualClose.toFixed(4)}\n`,
    );
  }

  let duplicateCloseCount = 0;
  for (const group of duplicates) {
    await applyDuplicateClose(group);
    const closedCount = group.ids.length - 1;
    duplicateCloseCount += closedCount;
    process.stdout.write(
      `  [CLOSED] ${group.symbol} ID=${group.ids.slice(0, closedCount).join(", ")} → status=CLOSED, close_reason=${DUPLICATE_CLOSE_REASON}\n`,
    );
  }

  process.stdout.write(
    `\n=== 완료 ===\n` +
      `  entry_price 교정: ${priceFixCount}건\n` +
      `  중복 CLOSED 처리: ${duplicateCloseCount}건\n`,
  );

  await pool.end();
}

main().catch((e) => {
  process.stderr.write(`오류: ${String(e)}\n`);
  process.exit(1);
});

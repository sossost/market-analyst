// ---------------------------------------------------------------------------
// priceDeclineFilter.ts — 당일 급락 종목 필터
//
// daily_prices 테이블에서 당일 종가 기준 -5% 이하 + volume ratio >= 1.5 종목 추출.
// volume ratio = 당일 거래량 / 20일 평균 거래량 (daily_ma.vol_ma30 사용).
//
// 블로킹 없음 — 발송은 계속되고 경고 섹션만 추가.
// DB 조회 실패 시 빈 배열 반환 (graceful).
// ---------------------------------------------------------------------------

import { logger } from "@/lib/logger";
import { fetchPriceData as fetchPriceDataFromRepo } from "@/db/repositories/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DECLINE_THRESHOLD_PCT = -5;
const VOLUME_RATIO_THRESHOLD = 1.5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeclinedSymbol {
  symbol: string;
  pctChange: number;
  volumeRatio: number;
}

interface PriceRow {
  symbol: string;
  close: string | null;
  prev_close: string | null;
  volume: string | null;
  vol_ma30: string | null;
}

// ---------------------------------------------------------------------------
// Pure computation
// ---------------------------------------------------------------------------

/**
 * PriceRow를 DeclinedSymbol로 변환한다.
 * 조건: pctChange <= -5% AND volumeRatio >= 1.5
 * 변환 불가 데이터(null, NaN)는 null 반환.
 */
export function computeDecline(row: PriceRow): DeclinedSymbol | null {
  const close = parseFloat(row.close ?? "");
  const prevClose = parseFloat(row.prev_close ?? "");
  const volume = parseFloat(row.volume ?? "");
  const volMa30 = parseFloat(row.vol_ma30 ?? "");

  if (!Number.isFinite(close) || !Number.isFinite(prevClose) || prevClose === 0) {
    return null;
  }

  const pctChange = ((close - prevClose) / prevClose) * 100;

  if (pctChange > DECLINE_THRESHOLD_PCT) {
    return null;
  }

  // vol_ma30이 없으면 volumeRatio 조건은 스킵하지 않고 1.0으로 간주 (보수적 처리)
  const volumeRatio = Number.isFinite(volume) && Number.isFinite(volMa30) && volMa30 > 0
    ? volume / volMa30
    : 1.0;

  if (volumeRatio < VOLUME_RATIO_THRESHOLD) {
    return null;
  }

  return {
    symbol: row.symbol,
    pctChange: Math.round(pctChange * 100) / 100,
    volumeRatio: Math.round(volumeRatio * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 지정된 symbols 중 당일 급락(-5% 이하 + 거래량 비율 1.5x 이상) 종목을 반환한다.
 *
 * - DB 조회 실패 시 빈 배열 반환 (비블로킹)
 * - symbols가 비어 있으면 빈 배열 반환
 */
export async function filterDeclinedSymbols(
  symbols: string[],
  date: string,
): Promise<DeclinedSymbol[]> {
  if (symbols.length === 0) {
    return [];
  }

  let rows: PriceRow[];

  try {
    rows = await fetchPriceDataFromRepo(symbols, date);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("PriceDeclineFilter", `DB 조회 실패 (필터 스킵): ${reason}`);
    return [];
  }

  const declined = rows
    .map(computeDecline)
    .filter((item): item is DeclinedSymbol => item != null);

  if (declined.length > 0) {
    const summary = declined
      .map((d) => `${d.symbol}(${d.pctChange}%, vol×${d.volumeRatio})`)
      .join(", ");
    logger.warn("PriceDeclineFilter", `급락 종목 감지 (${date}): ${summary}`);
  } else {
    logger.info("PriceDeclineFilter", `${date}: 급락 종목 없음`);
  }

  return declined;
}

/**
 * DeclinedSymbol 목록을 Discord 경고 메시지 섹션으로 포맷한다.
 */
export function formatDeclineWarning(declined: DeclinedSymbol[], date: string): string {
  if (declined.length === 0) {
    return "";
  }

  const lines = declined.map(
    (d) => `- **${d.symbol}**: ${d.pctChange.toFixed(1)}% / 거래량 ${d.volumeRatio.toFixed(1)}배`,
  );

  return [
    `⚠️ **[급락 경고]** ${date} — 리포트 추천 종목 중 급락 감지`,
    "",
    ...lines,
    "",
    "_-5% 이하 + 거래량 1.5배 이상 기준. 포지션 재검토 권장._",
  ].join("\n");
}

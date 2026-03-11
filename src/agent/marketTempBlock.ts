import { loadMarketSnapshot } from "./debate/marketDataLoader.js";
import type { MarketSnapshot } from "./debate/marketDataLoader.js";

export type { MarketSnapshot };

const PHASE2_CHANGE_UP = "▲";
const PHASE2_CHANGE_DOWN = "▼";
const PHASE2_CHANGE_FLAT = "-";

/** phase2RatioChange 부호에 따라 방향 표시 문자를 반환한다. */
function getChangeIndicator(change: number): string {
  if (change > 0) return PHASE2_CHANGE_UP;
  if (change < 0) return PHASE2_CHANGE_DOWN;
  return PHASE2_CHANGE_FLAT;
}

/** 숫자를 천 단위 콤마 포맷으로 변환한다. */
function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** 지수 close를 소수점 2자리 고정 + 천 단위 콤마로 변환한다. */
function formatIndexClose(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 등락률을 부호 포함 문자열로 변환한다. */
function formatPercent(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * MarketSnapshot → Discord 포맷 텍스트 변환.
 * LLM 없이 순수 데이터 포맷만 수행하는 순수 함수.
 */
export function formatMarketTempBlock(snapshot: MarketSnapshot): string {
  const lines: string[] = [];

  lines.push(`📊 시장 일일 브리핑 (${snapshot.date})`);
  lines.push("");

  // 지수 등락
  if (snapshot.indices.length > 0) {
    lines.push("📈 지수 등락");

    const indexMap = new Map(
      snapshot.indices.map((idx) => [idx.name, idx]),
    );

    const sp500 = indexMap.get("S&P 500");
    const nasdaq = indexMap.get("NASDAQ");
    const dow = indexMap.get("DOW 30");
    const russell = indexMap.get("Russell 2000");
    const vix = indexMap.get("VIX");

    const row1Parts: string[] = [];
    if (sp500 != null) {
      row1Parts.push(`S&P 500: ${formatIndexClose(sp500.close)} (${formatPercent(sp500.changePercent)})`);
    }
    if (nasdaq != null) {
      row1Parts.push(`NASDAQ: ${formatIndexClose(nasdaq.close)} (${formatPercent(nasdaq.changePercent)})`);
    }
    if (row1Parts.length > 0) lines.push(row1Parts.join(" | "));

    const row2Parts: string[] = [];
    if (dow != null) {
      row2Parts.push(`DOW: ${formatIndexClose(dow.close)} (${formatPercent(dow.changePercent)})`);
    }
    if (russell != null) {
      row2Parts.push(`Russell: ${formatIndexClose(russell.close)} (${formatPercent(russell.changePercent)})`);
    }
    if (row2Parts.length > 0) lines.push(row2Parts.join(" | "));

    if (vix != null) {
      lines.push(`VIX: ${formatIndexClose(vix.close)} (${formatPercent(vix.changePercent)})`);
    }

    lines.push("");
  }

  // 공포탐욕지수
  if (snapshot.fearGreed != null) {
    const fg = snapshot.fearGreed;
    const parts = [`😨 공포탐욕: ${fg.score} (${fg.rating})`];
    if (fg.previousClose != null) {
      parts.push(`전일 ${fg.previousClose}`);
    }
    if (fg.previous1Week != null) {
      parts.push(`1주전 ${fg.previous1Week}`);
    }
    lines.push(parts.join(" | "));
    lines.push("");
  }

  // 시장 온도 데이터
  if (snapshot.breadth != null) {
    const b = snapshot.breadth;
    const changeStr =
      b.phase2RatioChange === 0
        ? "-"
        : `${getChangeIndicator(b.phase2RatioChange)}${Math.abs(b.phase2RatioChange).toFixed(1)}%p`;

    lines.push("🌡️ 시장 온도 데이터");
    lines.push(
      `Phase 2: ${b.phase2Ratio}% (${changeStr}) | 시장 평균 RS: ${b.marketAvgRs}`,
    );

    const breadthParts: string[] = [];
    if (b.advancers != null && b.decliners != null) {
      const adStr = `A/D: ${formatNumber(b.advancers)}:${formatNumber(b.decliners)}`;
      const ratioStr = b.adRatio != null ? ` (${b.adRatio})` : "";
      breadthParts.push(`${adStr}${ratioStr}`);
    }
    if (b.newHighs != null && b.newLows != null) {
      breadthParts.push(`신고가 ${b.newHighs} / 신저가 ${b.newLows}`);
    }
    if (breadthParts.length > 0) {
      lines.push(breadthParts.join(" | "));
    }

    lines.push("");
  }

  lines.push("📭 오늘은 특별한 시장 신호 없음");

  return lines.join("\n");
}

/**
 * Discord 메시지에 삽입할 시장 온도 블록을 생성한다.
 * DB + 외부 API에서 데이터를 수집하고 포맷한다.
 */
export async function buildMarketTempBlock(targetDate: string): Promise<string> {
  const snapshot = await loadMarketSnapshot(targetDate);
  return formatMarketTempBlock(snapshot);
}

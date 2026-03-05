import { pool } from "../../db/client.js";
import { logger } from "../logger.js";

const FETCH_TIMEOUT_MS = 10_000;

interface SectorSnapshot {
  sector: string;
  avgRs: number;
  rsRank: number;
  groupPhase: number;
  prevGroupPhase: number | null;
  change4w: number | null;
  change12w: number | null;
  phase2Ratio: number;
  phase1to2Count5d: number;
}

const MIN_MARKET_CAP = 300_000_000; // $300M — 초소형주 제외

interface Phase2Stock {
  symbol: string;
  rsScore: number;
  prevPhase: number | null;
  sector: string | null;
  industry: string | null;
  volumeConfirmed: boolean;
  pctFromHigh52w: number | null;
  marketCapB: number | null; // billions
}

interface MarketBreadthSnapshot {
  totalStocks: number;
  phaseDistribution: Record<string, number>;
  phase2Ratio: number;
  phase2RatioChange: number;
  marketAvgRs: number;
}

interface IndexQuote {
  name: string;
  close: number;
  changePercent: number;
}

interface FearGreedSnapshot {
  score: number;
  rating: string;
}

export interface MarketSnapshot {
  date: string;
  sectors: SectorSnapshot[];
  newPhase2Stocks: Phase2Stock[];
  topPhase2Stocks: Phase2Stock[];
  breadth: MarketBreadthSnapshot | null;
  indices: IndexQuote[];
  fearGreed: FearGreedSnapshot | null;
}

function toNum(val: string | null | undefined): number {
  if (val == null) return 0;
  const n = Number(val);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Load sector RS snapshot from DB.
 * Returns all sectors sorted by RS descending.
 */
async function loadSectorSnapshot(date: string): Promise<SectorSnapshot[]> {
  const { rows } = await pool.query<{
    sector: string;
    avg_rs: string;
    rs_rank: number;
    group_phase: number;
    prev_group_phase: number | null;
    change_4w: string | null;
    change_12w: string | null;
    phase2_ratio: string;
    phase1to2_count_5d: number;
  }>(
    `SELECT sector, avg_rs::text, rs_rank, group_phase, prev_group_phase,
            change_4w::text, change_12w::text,
            phase2_ratio::text, phase1to2_count_5d
     FROM sector_rs_daily
     WHERE date = $1
     ORDER BY avg_rs::numeric DESC`,
    [date],
  );

  return rows.map((r) => ({
    sector: r.sector,
    avgRs: toNum(r.avg_rs),
    rsRank: r.rs_rank,
    groupPhase: r.group_phase,
    prevGroupPhase: r.prev_group_phase,
    change4w: r.change_4w != null ? toNum(r.change_4w) : null,
    change12w: r.change_12w != null ? toNum(r.change_12w) : null,
    phase2Ratio: Number((toNum(r.phase2_ratio) * 100).toFixed(1)),
    phase1to2Count5d: r.phase1to2_count_5d,
  }));
}

/**
 * Load Phase 2 stocks: new entries (Phase 1->2) and top RS stocks.
 */
async function loadPhase2Stocks(date: string): Promise<{
  newEntries: Phase2Stock[];
  topRs: Phase2Stock[];
}> {
  // New Phase 2 entries (prev_phase != 2, i.e. just entered Phase 2)
  const { rows: newRows } = await pool.query<{
    symbol: string;
    rs_score: number;
    prev_phase: number | null;
    sector: string | null;
    industry: string | null;
    volume_confirmed: boolean | null;
    pct_from_high_52w: string | null;
    market_cap: string | null;
  }>(
    `SELECT sp.symbol, sp.rs_score, sp.prev_phase, s.sector, s.industry,
            sp.volume_confirmed, sp.pct_from_high_52w::text, s.market_cap::text
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     WHERE sp.date = $1
       AND sp.phase = 2
       AND sp.prev_phase IS NOT NULL
       AND sp.prev_phase != 2
       AND (s.market_cap IS NULL OR s.market_cap::numeric >= $2)
     ORDER BY sp.rs_score DESC
     LIMIT 20`,
    [date, MIN_MARKET_CAP],
  );

  // Top Phase 2 by RS (regardless of when they entered)
  const { rows: topRows } = await pool.query<{
    symbol: string;
    rs_score: number;
    prev_phase: number | null;
    sector: string | null;
    industry: string | null;
    volume_confirmed: boolean | null;
    pct_from_high_52w: string | null;
    market_cap: string | null;
  }>(
    `SELECT sp.symbol, sp.rs_score, sp.prev_phase, s.sector, s.industry,
            sp.volume_confirmed, sp.pct_from_high_52w::text, s.market_cap::text
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     WHERE sp.date = $1
       AND sp.phase = 2
       AND sp.rs_score >= 80
       AND (s.market_cap IS NULL OR s.market_cap::numeric >= $2)
     ORDER BY sp.rs_score DESC
     LIMIT 15`,
    [date, MIN_MARKET_CAP],
  );

  const mapStock = (r: typeof newRows[number]): Phase2Stock => ({
    symbol: r.symbol,
    rsScore: r.rs_score,
    prevPhase: r.prev_phase,
    sector: r.sector,
    industry: r.industry,
    volumeConfirmed: r.volume_confirmed ?? false,
    pctFromHigh52w: r.pct_from_high_52w != null
      ? Number((toNum(r.pct_from_high_52w) * 100).toFixed(1))
      : null,
    marketCapB: r.market_cap != null
      ? Number((toNum(r.market_cap) / 1_000_000_000).toFixed(1))
      : null,
  });

  return {
    newEntries: newRows.map(mapStock),
    topRs: topRows.map(mapStock),
  };
}

/**
 * Load market breadth from stock_phases.
 */
async function loadMarketBreadth(date: string): Promise<MarketBreadthSnapshot | null> {
  const { rows: phaseRows } = await pool.query<{ phase: number; count: string }>(
    `SELECT phase, COUNT(*)::text AS count
     FROM stock_phases WHERE date = $1
     GROUP BY phase ORDER BY phase`,
    [date],
  );

  if (phaseRows.length === 0) return null;

  const total = phaseRows.reduce((sum, r) => sum + toNum(r.count), 0);
  const phaseDistribution = Object.fromEntries(
    phaseRows.map((r) => [`phase${r.phase}`, toNum(r.count)]),
  );
  const phase2Count = phaseDistribution.phase2 ?? 0;
  const phase2RatioRaw = total > 0 ? (phase2Count / total) * 100 : 0;

  // Previous day comparison
  const { rows: prevRows } = await pool.query<{ phase2_count: string; total_count: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE phase = 2)::text AS phase2_count,
       COUNT(*)::text AS total_count
     FROM stock_phases
     WHERE date = (SELECT MAX(date) FROM stock_phases WHERE date < $1)`,
    [date],
  );
  const prevTotal = toNum(prevRows[0]?.total_count);
  const prevPhase2 = toNum(prevRows[0]?.phase2_count);
  const prevPhase2RatioRaw = prevTotal > 0 ? (prevPhase2 / prevTotal) * 100 : 0;

  // Market avg RS
  const { rows: rsRows } = await pool.query<{ avg_rs: string }>(
    `SELECT AVG(rs_score)::numeric(10,2)::text AS avg_rs FROM stock_phases WHERE date = $1`,
    [date],
  );

  return {
    totalStocks: total,
    phaseDistribution,
    phase2Ratio: Number(phase2RatioRaw.toFixed(1)),
    phase2RatioChange: Number((phase2RatioRaw - prevPhase2RatioRaw).toFixed(1)),
    marketAvgRs: toNum(rsRows[0]?.avg_rs),
  };
}

/**
 * Fetch index quotes from Yahoo Finance API.
 */
async function fetchIndexQuotes(): Promise<IndexQuote[]> {
  const symbols: Record<string, string> = {
    "^GSPC": "S&P 500",
    "^IXIC": "NASDAQ",
    "^DJI": "DOW 30",
    "^RUT": "Russell 2000",
    "^VIX": "VIX",
  };

  const results: IndexQuote[] = [];

  for (const [symbol, name] of Object.entries(symbols)) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2d&interval=1d`;
      const response = await fetch(url, {
        headers: { "User-Agent": "market-analyst/1.0" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) continue;

      const data = await response.json();
      const result = data?.chart?.result?.[0];
      if (result == null) continue;

      const closes = result.indicators?.quote?.[0]?.close;
      if (closes == null || closes.length < 2) continue;

      const prevClose = closes[closes.length - 2];
      const lastClose = closes[closes.length - 1];
      if (prevClose == null || lastClose == null || prevClose === 0) continue;

      const changePercent = ((lastClose - prevClose) / prevClose) * 100;

      results.push({
        name,
        close: Number(lastClose.toFixed(2)),
        changePercent: Number(changePercent.toFixed(2)),
      });
    } catch {
      // Individual index failure is tolerable
    }
  }

  return results;
}

/**
 * Fetch CNN Fear & Greed Index.
 */
async function fetchFearGreed(): Promise<FearGreedSnapshot | null> {
  try {
    const response = await fetch(
      "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
          Referer: "https://edition.cnn.com/markets/fear-and-greed",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );

    if (!response.ok) return null;

    const data = await response.json();
    const fg = data?.fear_and_greed;
    if (fg == null || typeof fg.score !== "number") return null;

    return {
      score: Number(fg.score.toFixed(1)),
      rating: String(fg.rating ?? "unknown"),
    };
  } catch {
    return null;
  }
}

/**
 * Find the latest date with data if the requested date has no data.
 */
async function resolveDataDate(requestedDate: string): Promise<string> {
  const { rows } = await pool.query<{ date: string }>(
    `SELECT MAX(date) AS date FROM stock_phases WHERE date <= $1`,
    [requestedDate],
  );
  return rows[0]?.date ?? requestedDate;
}

/**
 * Load a complete market snapshot for debate injection.
 * Combines DB data (sectors, stocks, breadth) with live index quotes.
 */
export async function loadMarketSnapshot(requestedDate: string): Promise<MarketSnapshot> {
  const date = await resolveDataDate(requestedDate);
  if (date !== requestedDate) {
    logger.info("MarketData", `No data for ${requestedDate}, using latest: ${date}`);
  }

  // Parallel: DB queries + external API calls
  const [sectors, phase2, breadth, indices, fearGreed] = await Promise.all([
    loadSectorSnapshot(date),
    loadPhase2Stocks(date),
    loadMarketBreadth(date),
    fetchIndexQuotes().catch(() => [] as IndexQuote[]),
    fetchFearGreed().catch(() => null),
  ]);

  if (sectors.length === 0 && breadth == null) {
    logger.warn("MarketData", `No DB data found for ${date} — debate will run without market data`);
  }

  logger.info("MarketData", `Loaded: ${sectors.length} sectors, ${phase2.newEntries.length} new Phase 2, ${indices.length} indices`);

  return {
    date,
    sectors,
    newPhase2Stocks: phase2.newEntries,
    topPhase2Stocks: phase2.topRs,
    breadth,
    indices,
    fearGreed,
  };
}

/**
 * Format market snapshot as readable text for debate question injection.
 */
function formatStockLine(s: Phase2Stock): string {
  const vol = s.volumeConfirmed ? " [거래량 확인]" : "";
  const high52w = s.pctFromHigh52w != null ? `, 고점 대비 ${s.pctFromHigh52w}%` : "";
  const cap = s.marketCapB != null ? `, 시총 $${s.marketCapB}B` : "";
  return `- ${s.symbol} (RS ${s.rsScore}${high52w}${cap}, ${s.sector ?? "?"} > ${s.industry ?? "?"})${vol}`;
}

export function formatMarketSnapshot(snapshot: MarketSnapshot): string {
  const sections: string[] = [];

  // 1. Index overview
  if (snapshot.indices.length > 0) {
    const indexLines = snapshot.indices.map((idx) => {
      const sign = idx.changePercent >= 0 ? "+" : "";
      return `- ${idx.name}: ${idx.close.toLocaleString()} (${sign}${idx.changePercent}%)`;
    });
    sections.push(`### 주요 지수 (실시간)\n${indexLines.join("\n")}`);
  }

  // Fear & Greed
  if (snapshot.fearGreed != null) {
    sections.push(`- CNN 공포탐욕지수: ${snapshot.fearGreed.score} (${snapshot.fearGreed.rating})`);
  }

  // 2. Market breadth
  if (snapshot.breadth != null) {
    const b = snapshot.breadth;
    const phaseStr = Object.entries(b.phaseDistribution)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    const changeSign = b.phase2RatioChange >= 0 ? "+" : "";
    sections.push(
      `### 시장 브레드스 (${snapshot.date} 기준, 총 ${b.totalStocks}종목)\n` +
      `- Phase 분포: ${phaseStr}\n` +
      `- Phase 2 비율: ${b.phase2Ratio}% (전일 대비 ${changeSign}${b.phase2RatioChange}%p)\n` +
      `- 시장 평균 RS: ${b.marketAvgRs}`,
    );
  }

  // 3. Sector RS ranking
  if (snapshot.sectors.length > 0) {
    const top5 = snapshot.sectors.slice(0, 5);
    const bottom3 = snapshot.sectors.slice(-3).reverse();

    const topLines = top5.map((s) => {
      const phaseChange = s.prevGroupPhase != null && s.prevGroupPhase !== s.groupPhase
        ? ` (Phase ${s.prevGroupPhase}->${s.groupPhase})`
        : ` (Phase ${s.groupPhase})`;
      const momentum = s.change4w != null ? `, 4주 ${s.change4w > 0 ? "+" : ""}${s.change4w}` : "";
      return `- ${s.sector}: RS ${s.avgRs}${phaseChange}, Phase2 비율 ${s.phase2Ratio}%${momentum}, 5일 1->2 전환 ${s.phase1to2Count5d}건`;
    });

    const bottomLines = bottom3.map((s) =>
      `- ${s.sector}: RS ${s.avgRs} (Phase ${s.groupPhase}), Phase2 비율 ${s.phase2Ratio}%`,
    );

    sections.push(
      `### 섹터 RS 상위 5개\n${topLines.join("\n")}`,
    );
    sections.push(
      `### 섹터 RS 하위 3개\n${bottomLines.join("\n")}`,
    );
  }

  // 4. New Phase 2 entries — split by volume confirmation
  if (snapshot.newPhase2Stocks.length > 0) {
    const confirmed = snapshot.newPhase2Stocks.filter((s) => s.volumeConfirmed);
    const unconfirmed = snapshot.newPhase2Stocks.filter((s) => !s.volumeConfirmed);

    const parts: string[] = [
      `### 신규 상승 전환 진입 종목 (${snapshot.newPhase2Stocks.length}건, 시총 $3억 이상)`,
    ];

    if (confirmed.length > 0) {
      parts.push(
        `\n**거래량 돌파 확인 (${confirmed.length}건)** — 거래량 2배 이상 동반, 신뢰도 높음`,
        ...confirmed.slice(0, 10).map(formatStockLine),
      );
    }

    if (unconfirmed.length > 0) {
      parts.push(
        `\n**거래량 미확인 (${unconfirmed.length}건)** — 거래량 동반 없이 기술적 조건만 충족, 추가 확인 필요`,
        `※ 고점 대비 %가 -50% 이하인 종목은 바닥 반등일 수 있으니 RS만 보고 판단하지 마세요.`,
        ...unconfirmed.slice(0, 10).map(formatStockLine),
      );
    }

    sections.push(parts.join("\n"));
  }

  // 5. Top Phase 2 by RS
  if (snapshot.topPhase2Stocks.length > 0) {
    const stockLines = snapshot.topPhase2Stocks.slice(0, 10).map(formatStockLine);
    sections.push(
      `### 상승 초입 RS 상위 종목 (RS >= 80, 시총 $3억 이상)\n${stockLines.join("\n")}`,
    );
  }

  if (sections.length === 0) {
    return "";
  }

  return [
    `## 실제 시장 데이터 (${snapshot.date} 기준)`,
    "",
    "아래는 ETL 파이프라인이 수집한 실제 데이터입니다. 이 데이터를 기반으로 분석하세요.",
    "**이 데이터에 없는 가격이나 수치는 절대 추정하지 마세요.**",
    "",
    sections.join("\n\n"),
  ].join("\n");
}

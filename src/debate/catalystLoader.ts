import { db, pool } from "@/db/client";
import { earningCalendar } from "@/db/schema/analyst";
import { and, gte, lte, inArray, asc } from "drizzle-orm";
import { logger } from "@/lib/logger";
import type { MarketSnapshot } from "./marketDataLoader";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 종목당 최대 뉴스 헤드라인 수 — 토큰 절약 */
const MAX_NEWS_PER_SYMBOL = 3;

/** 뉴스 조회 범위 (일) */
const NEWS_LOOKBACK_DAYS = 5;

/** 실적 서프라이즈 조회 범위 (일) — 최근 1분기 */
const SURPRISE_LOOKBACK_DAYS = 100;

/** 실적 발표 일정 조회 범위 (일) */
const EARNINGS_FORWARD_DAYS = 14;

/** 촉매 컨텍스트 최대 길이 (chars) — 토큰 예산 보호 */
const MAX_CATALYST_CHARS = 2_000;

// ---------------------------------------------------------------------------
// Types (exported for testing)
// ---------------------------------------------------------------------------

export interface StockNewsRow {
  symbol: string;
  title: string;
  site: string | null;
  publishedDate: string;
}

export interface SectorBeatRate {
  sector: string;
  totalCount: number;
  beatCount: number;
  beatRate: number;
}

export interface UpcomingEarning {
  symbol: string;
  date: string;
  epsEstimated: string | null;
  revenueEstimated: string | null;
  time: string | null;
}

export interface CatalystData {
  news: StockNewsRow[];
  sectorBeatRates: SectorBeatRate[];
  upcomingEarnings: UpcomingEarning[];
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/**
 * 외부 텍스트에서 XML-like 태그와 Markdown 구조 문자를 제거하여
 * 프롬프트 인젝션을 방지한다.
 * - XML 태그 제거
 * - 줄바꿈 제거 (단일 필드가 Markdown 구조를 생성하는 것 방지)
 * - 선행 # 제거 (Markdown 헤더 인젝션 방지)
 */
function sanitizeForPrompt(text: string): string {
  return text
    .replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*[^>]*>/g, "")
    .replace(/[\n\r]+/g, " ")
    .replace(/^#+\s*/g, "");
}

// ---------------------------------------------------------------------------
// DB Queries (exported for test mocking)
// ---------------------------------------------------------------------------

/**
 * Phase 2 종목의 최근 뉴스 헤드라인을 조회한다.
 * ROW_NUMBER로 종목별 균등 분배 보장.
 */
export async function fetchPhase2News(
  phase2Symbols: string[],
  baseDate: string,
  lookbackDays: number = NEWS_LOOKBACK_DAYS,
): Promise<StockNewsRow[]> {
  if (phase2Symbols.length === 0) return [];

  const cutoffDate = new Date(baseDate);
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `SELECT symbol, title, site, published_date
     FROM (
       SELECT symbol, title, site, published_date,
         ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY published_date DESC) AS rn
       FROM stock_news
       WHERE symbol = ANY($1)
         AND published_date >= $2
         AND published_date < ($3::date + 1)::text
     ) ranked
     WHERE rn <= $4
     ORDER BY symbol, published_date DESC`,
    [phase2Symbols, cutoffStr, baseDate, MAX_NEWS_PER_SYMBOL],
  );

  return (rows as Record<string, unknown>[]).map((r) => ({
    symbol: String(r.symbol ?? ""),
    title: String(r.title ?? ""),
    site: r.site != null ? String(r.site) : null,
    publishedDate: String(r.published_date ?? ""),
  }));
}

/**
 * Phase 2 종목이 속한 섹터별 실적 서프라이즈 비트율을 집계한다.
 * eps_surprises JOIN symbols (sector 매핑).
 * numeric 변환 실패 방지를 위해 regex 검증 추가.
 */
export async function fetchSectorBeatRates(
  phase2Symbols: string[],
  baseDate: string,
  lookbackDays: number = SURPRISE_LOOKBACK_DAYS,
): Promise<SectorBeatRate[]> {
  if (phase2Symbols.length === 0) return [];

  const cutoffDate = new Date(baseDate);
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `SELECT
       s.sector,
       COUNT(*)::int AS total_count,
       COUNT(*) FILTER (
         WHERE e.actual_eps::numeric > e.estimated_eps::numeric
       )::int AS beat_count
     FROM eps_surprises e
     JOIN symbols s ON s.symbol = e.symbol
     WHERE e.symbol = ANY($1)
       AND e.actual_date >= $2
       AND e.actual_date <= $3
       AND e.actual_eps IS NOT NULL
       AND e.estimated_eps IS NOT NULL
       AND e.actual_eps::text ~ '^-?[0-9]+(\.[0-9]+)?$'
       AND e.estimated_eps::text ~ '^-?[0-9]+(\.[0-9]+)?$'
       AND s.sector IS NOT NULL
     GROUP BY s.sector
     HAVING COUNT(*) >= 2
     ORDER BY COUNT(*) FILTER (WHERE e.actual_eps::numeric > e.estimated_eps::numeric)::float / COUNT(*) DESC`,
    [phase2Symbols, cutoffStr, baseDate],
  );

  return (rows as Record<string, unknown>[]).map((r) => {
    const totalCount = Number(r.total_count ?? 0);
    const beatCount = Number(r.beat_count ?? 0);
    return {
      sector: String(r.sector ?? ""),
      totalCount,
      beatCount,
      beatRate: totalCount > 0 ? beatCount / totalCount : 0,
    };
  });
}

/**
 * Phase 2 종목 중 향후 N일 내 실적 발표 예정인 종목을 조회한다.
 */
export async function fetchUpcomingEarnings(
  phase2Symbols: string[],
  baseDate: string,
  forwardDays: number = EARNINGS_FORWARD_DAYS,
): Promise<UpcomingEarning[]> {
  if (phase2Symbols.length === 0) return [];

  const endDate = new Date(baseDate);
  endDate.setDate(endDate.getDate() + forwardDays);
  const endStr = endDate.toISOString().slice(0, 10);

  return db
    .select({
      symbol: earningCalendar.symbol,
      date: earningCalendar.date,
      epsEstimated: earningCalendar.epsEstimated,
      revenueEstimated: earningCalendar.revenueEstimated,
      time: earningCalendar.time,
    })
    .from(earningCalendar)
    .where(
      and(
        inArray(earningCalendar.symbol, phase2Symbols),
        gte(earningCalendar.date, baseDate),
        lte(earningCalendar.date, endStr),
      ),
    )
    .orderBy(asc(earningCalendar.date));
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * 종목별 뉴스 헤드라인을 포맷한다. 종목당 최대 3건.
 * 모든 필드를 sanitize하여 프롬프트 인젝션 방지.
 */
function formatNewsSection(news: StockNewsRow[]): string {
  if (news.length === 0) return "";

  // 종목별 그룹핑 (DB에서 이미 per-symbol limit 적용됨)
  const bySymbol = new Map<string, StockNewsRow[]>();
  for (const item of news) {
    const existing = bySymbol.get(item.symbol) ?? [];
    existing.push(item);
    bySymbol.set(item.symbol, existing);
  }

  const lines: string[] = ["### 종목 뉴스 (최근 5일)"];

  for (const [symbol, items] of bySymbol) {
    lines.push(`**${sanitizeForPrompt(symbol)}**`);
    for (const item of items) {
      const title = sanitizeForPrompt(item.title);
      const source = sanitizeForPrompt(item.site ?? "unknown");
      const date = item.publishedDate.slice(0, 10);
      lines.push(`- ${title} (${source}, ${date})`);
    }
  }

  return lines.join("\n");
}

/**
 * 섹터별 실적 서프라이즈 비트율을 포맷한다.
 */
function formatBeatRateSection(beatRates: SectorBeatRate[]): string {
  if (beatRates.length === 0) return "";

  const lines: string[] = [
    "### 섹터별 실적 서프라이즈 비트율 (최근 분기)",
    "",
    "| 섹터 | 비트 | 전체 | 비트율 |",
    "|------|------|------|--------|",
  ];

  for (const rate of beatRates) {
    const pct = Math.round(rate.beatRate * 100);
    const sector = sanitizeForPrompt(rate.sector);
    lines.push(`| ${sector} | ${rate.beatCount} | ${rate.totalCount} | ${pct}% |`);
  }

  return lines.join("\n");
}

/**
 * 금액을 읽기 쉬운 축약 형식으로 포맷한다.
 * 예: 60800000000 → "$60.8B"
 */
function formatRevenue(value: string): string {
  const num = Number(value);
  if (Number.isNaN(num)) return `$${value}`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(1)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(0)}M`;
  return `$${num.toLocaleString("en-US")}`;
}

/**
 * 임박한 실적 발표 종목을 포맷한다.
 */
function formatUpcomingEarningsSection(earnings: UpcomingEarning[]): string {
  if (earnings.length === 0) return "";

  const lines: string[] = [
    "### 임박한 실적 발표 (향후 2주)",
    "",
    "| 종목 | 발표일 | 시간 | EPS 예상 | 매출 예상 |",
    "|------|--------|------|----------|----------|",
  ];

  for (const e of earnings) {
    const symbol = sanitizeForPrompt(e.symbol);
    const time = e.time === "bmo" ? "장전" : e.time === "amc" ? "장후" : sanitizeForPrompt(e.time ?? "—");
    const eps = e.epsEstimated != null ? `$${sanitizeForPrompt(e.epsEstimated)}` : "—";
    const rev = e.revenueEstimated != null ? formatRevenue(e.revenueEstimated) : "—";
    lines.push(`| ${symbol} | ${e.date} | ${time} | ${eps} | ${rev} |`);
  }

  return lines.join("\n");
}

/**
 * CatalystData를 토론 프롬프트용 문자열로 포맷한다.
 * 데이터가 하나도 없으면 빈 문자열 반환.
 * MAX_CATALYST_CHARS 초과 시 뉴스 섹션부터 잘라냄.
 */
export function formatCatalystContext(data: CatalystData): string {
  const beatRateSection = formatBeatRateSection(data.sectorBeatRates);
  const earningsSection = formatUpcomingEarningsSection(data.upcomingEarnings);
  const newsSection = formatNewsSection(data.news);

  // 우선순위: 비트율 > 실적일정 > 뉴스 (비트율이 가장 컴팩트하고 고가치)
  const prioritized = [beatRateSection, earningsSection, newsSection].filter((s) => s.length > 0);

  if (prioritized.length === 0) return "";

  let result = prioritized.join("\n\n");

  // 토큰 예산 초과 시 뒤에서부터 (뉴스부터) 잘라냄
  if (result.length > MAX_CATALYST_CHARS) {
    result = result.slice(0, MAX_CATALYST_CHARS);
    // 마지막 완전한 줄까지만 유지
    const lastNewline = result.lastIndexOf("\n");
    if (lastNewline > 0) {
      result = result.slice(0, lastNewline);
    }
    result += "\n\n(토큰 예산 초과로 일부 생략)";
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

/**
 * 토론 엔진에 주입할 촉매 데이터를 로드한다.
 * Phase 2 종목의 뉴스, 실적 서프라이즈, 실적 일정을 수집하여 포맷.
 * 실패 시 빈 문자열 반환 — 토론은 계속 진행.
 */
export async function loadCatalystContext(
  snapshot: MarketSnapshot,
  debateDate: string,
): Promise<string> {
  const phase2Symbols = [
    ...snapshot.newPhase2Stocks.map((s) => s.symbol),
    ...snapshot.topPhase2Stocks.map((s) => s.symbol),
  ];
  const uniqueSymbols = [...new Set(phase2Symbols)];

  if (uniqueSymbols.length === 0) {
    logger.info("Catalyst", "No Phase 2 symbols — skipping catalyst load");
    return "";
  }

  try {
    const [news, sectorBeatRates, upcomingEarnings] = await Promise.all([
      fetchPhase2News(uniqueSymbols, debateDate),
      fetchSectorBeatRates(uniqueSymbols, debateDate),
      fetchUpcomingEarnings(uniqueSymbols, debateDate),
    ]);

    const result = formatCatalystContext({ news, sectorBeatRates, upcomingEarnings });

    logger.info(
      "Catalyst",
      `Loaded: ${news.length} news, ${sectorBeatRates.length} sector beat rates, ${upcomingEarnings.length} upcoming earnings (${result.length} chars)`,
    );

    return result;
  } catch (err) {
    logger.warn(
      "Catalyst",
      `촉매 데이터 로드 실패 (토론 계속 진행): ${err instanceof Error ? err.message : String(err)}`,
    );
    return "";
  }
}

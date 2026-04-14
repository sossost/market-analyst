/**
 * gapAnalyzer.ts — LLM 기반 뉴스 사각지대 감지.
 *
 * 활성 thesis, 신용 이상 신호, 뉴스 카테고리 분포, 섹터 RS를 종합하여
 * 현재 뉴스 수집에서 빠진 테마를 식별하고 동적 검색 쿼리를 생성한다.
 *
 * LLM: Claude Haiku 1회/일 (~$0.01)
 * 호출 위치: collect-news.ts (고정 쿼리 완료 후)
 */

import { db, pool } from "@/db/client";
import { newsArchive, newsGapAnalysis } from "@/db/schema/analyst";
import { createProvider } from "@/debate/llm/providerFactory.js";
import { logger } from "@/lib/logger";
import { eq, and, gte, desc, sql } from "drizzle-orm";

const TAG = "GAP_ANALYZER";

const MAX_TOKENS = 2_048;
const MAX_GAP_RESULTS = 5;

// ─── 타입 ────────────────────────────────────────────────────────────────────

export interface GapResult {
  theme: string;
  query: string;
  rationale: string;
}

/**
 * 단일 GapResult 항목이 유효한지 검증한다.
 */
function isValidGapResult(item: unknown): item is GapResult {
  if (item == null || typeof item !== "object") return false;
  const raw = item as Record<string, unknown>;
  return (
    typeof raw.theme === "string" && raw.theme.length > 0 &&
    typeof raw.query === "string" && raw.query.length > 0 &&
    typeof raw.rationale === "string" && raw.rationale.length > 0
  );
}

// ─── 입력 데이터 수집 ──────────────────────────────────────────────────────

export interface GapAnalyzerInput {
  activeTheses: string[];
  creditAnomalies: string[];
  categoryDistribution: Record<string, number>;
  topSectors: string[];
  bottomSectors: string[];
}

/**
 * DB에서 ACTIVE thesis 요약 목록을 조회한다.
 * @param date 기준일 — 해당 일자 이전에 생성된 thesis만 반환 (백필 안전)
 */
export async function fetchActiveThesesSummary(date: string): Promise<string[]> {
  const { rows } = await pool.query<{ persona: string; thesis: string }>(
    `SELECT agent_persona AS persona, thesis FROM theses WHERE status = 'ACTIVE' AND debate_date <= $1 ORDER BY debate_date DESC LIMIT 20`,
    [date],
  );
  return rows.map((r) => `[${r.persona}] ${r.thesis}`);
}

/**
 * z-score > 1.5인 신용 지표 이상 신호를 조회한다.
 * @param date 기준일 — 해당 일자 이하 데이터만 조회 (백필 안전)
 */
export async function fetchCreditAnomalies(date: string): Promise<string[]> {
  const Z_SCORE_THRESHOLD = 1.5;
  const LABELS: Record<string, string> = {
    BAMLH0A0HYM2: "HY 스프레드",
    BAMLH0A3HYC: "CCC 스프레드",
    BAMLC0A4CBBB: "BBB 스프레드",
    STLFSI4: "금융 스트레스",
  };

  const { rows } = await pool.query<{
    series_id: string;
    value: string;
    z_score_180d: string;
  }>(
    `SELECT DISTINCT ON (series_id) series_id, value::text, z_score_180d::text
     FROM credit_indicators
     WHERE z_score_180d IS NOT NULL AND ABS(z_score_180d) >= $1 AND date <= $2
     ORDER BY series_id, date DESC`,
    [Z_SCORE_THRESHOLD, date],
  );

  return rows.map((r) => {
    const label = LABELS[r.series_id] ?? r.series_id;
    return `${label}: z=${Number(r.z_score_180d).toFixed(2)}, 값=${Number(r.value).toFixed(2)}`;
  });
}

/**
 * 기준일 24시간 이내 수집 뉴스의 카테고리별 건수를 조회한다.
 * @param date 기준일 (YYYY-MM-DD) — 해당 일자 기준 24시간 윈도우 (백필 안전)
 */
export async function fetchCategoryDistribution(date: string): Promise<Record<string, number>> {
  const dayEnd = new Date(`${date}T23:59:59.999Z`);
  const cutoff = new Date(dayEnd.getTime() - 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      category: newsArchive.category,
      count: sql<number>`count(*)::int`,
    })
    .from(newsArchive)
    .where(and(gte(newsArchive.collectedAt, cutoff), sql`${newsArchive.collectedAt} <= ${dayEnd}`))
    .groupBy(newsArchive.category);

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.category] = row.count;
  }
  return result;
}

/**
 * 섹터 RS 상위 5개 + 하위 5개를 조회한다.
 * @param date 기준일 — 해당 일자 이하 최신 RS 데이터 조회 (백필 안전)
 */
export async function fetchSectorRsExtremes(date: string): Promise<{
  top: string[];
  bottom: string[];
}> {
  const { rows: topRows } = await pool.query<{
    sector: string;
    avg_rs: string;
    change_4w: string | null;
  }>(
    `SELECT sector, avg_rs::text, change_4w::text
     FROM sector_rs_daily
     WHERE date = (SELECT MAX(date) FROM sector_rs_daily WHERE date <= $1)
     ORDER BY avg_rs DESC
     LIMIT 5`,
    [date],
  );

  const { rows: bottomRows } = await pool.query<{
    sector: string;
    avg_rs: string;
    change_4w: string | null;
  }>(
    `SELECT sector, avg_rs::text, change_4w::text
     FROM sector_rs_daily
     WHERE date = (SELECT MAX(date) FROM sector_rs_daily WHERE date <= $1)
     ORDER BY avg_rs ASC
     LIMIT 5`,
    [date],
  );

  const formatSector = (r: { sector: string; avg_rs: string; change_4w: string | null }) => {
    const change = r.change_4w != null ? `, 4주변화=${Number(r.change_4w).toFixed(1)}` : "";
    return `${r.sector} (RS=${Number(r.avg_rs).toFixed(0)}${change})`;
  };

  return {
    top: topRows.map(formatSector),
    bottom: bottomRows.map(formatSector),
  };
}

/**
 * 모든 입력 데이터를 병렬 수집한다.
 * 개별 수집 실패 시 빈 값으로 대체 — 전체 분석을 중단하지 않는다.
 * @param date 기준일 — 모든 조회가 이 날짜를 기준으로 동작 (백필 안전)
 */
export async function collectGapInputs(date: string): Promise<GapAnalyzerInput> {
  const [activeTheses, creditAnomalies, categoryDistribution, sectorExtremes] =
    await Promise.all([
      fetchActiveThesesSummary(date).catch((err) => {
        logger.warn(TAG, `Active thesis 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
        return [] as string[];
      }),
      fetchCreditAnomalies(date).catch((err) => {
        logger.warn(TAG, `Credit anomaly 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
        return [] as string[];
      }),
      fetchCategoryDistribution(date).catch((err) => {
        logger.warn(TAG, `Category distribution 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
        return {} as Record<string, number>;
      }),
      fetchSectorRsExtremes(date).catch((err) => {
        logger.warn(TAG, `Sector RS 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
        return { top: [] as string[], bottom: [] as string[] };
      }),
    ]);

  return {
    activeTheses,
    creditAnomalies,
    categoryDistribution,
    topSectors: sectorExtremes.top,
    bottomSectors: sectorExtremes.bottom,
  };
}

// ─── 프롬프트 ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a financial market blind-spot analyst.

Your task: Given the current state of thesis tracking, credit signals, news coverage, and sector relative strength, identify 3-5 market themes that are MISSING from current news coverage but SHOULD be monitored.

RULES:
1. Each theme must have a rationale based ONLY on the provided data — no speculation
2. The query must be a concise English search string suitable for Brave News Search
3. Focus on gaps: themes where data signals exist but news coverage is absent or thin
4. Prioritize cross-market risks and emerging structural shifts
5. Do NOT suggest themes already well-covered by existing news categories
6. Maximum 5 themes, minimum 1

OUTPUT: JSON array only. No markdown fences, no extra text.
[
  {
    "theme": "테마명 (Korean)",
    "query": "search query string (English)",
    "rationale": "근거 설명 (Korean) — 현재 보유 데이터에서 관찰 가능한 근거만 제시"
  }
]`;

export function buildGapPrompt(input: GapAnalyzerInput): string {
  const sections: string[] = [];

  if (input.activeTheses.length > 0) {
    sections.push(`## (a) 현재 추적 중인 ACTIVE Thesis (${input.activeTheses.length}건)\n${input.activeTheses.join("\n")}`);
  } else {
    sections.push("## (a) 현재 추적 중인 ACTIVE Thesis\n없음");
  }

  if (input.creditAnomalies.length > 0) {
    sections.push(`## (b) 정량 이상 신호 (z-score ≥ 1.5)\n${input.creditAnomalies.join("\n")}`);
  } else {
    sections.push("## (b) 정량 이상 신호\n이상 신호 없음 (정상 범위)");
  }

  const catLines = Object.entries(input.categoryDistribution)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, count]) => `- ${cat}: ${count}건`)
    .join("\n");
  sections.push(`## (c) 최근 24시간 뉴스 카테고리 분포\n${catLines || "수집된 뉴스 없음"}`);

  if (input.topSectors.length > 0) {
    sections.push(`## (d) RS 상위 5개 섹터\n${input.topSectors.join("\n")}`);
  }

  if (input.bottomSectors.length > 0) {
    sections.push(`## (e) RS 하위 5개 섹터\n${input.bottomSectors.join("\n")}`);
  }

  return sections.join("\n\n");
}

// ─── LLM 호출 ─────────────────────────────────────────────────────────────

/**
 * LLM 응답을 GapResult[]로 파싱한다. 순수 함수.
 */
export function parseGapResponse(content: string): GapResult[] {
  let jsonStr = content.trim();

  // 코드 펜스 제거
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  // JSON 배열 추출
  const startIdx = jsonStr.indexOf("[");
  const endIdx = jsonStr.lastIndexOf("]");
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    logger.warn(TAG, "JSON 배열을 찾을 수 없음");
    return [];
  }

  jsonStr = jsonStr.slice(startIdx, endIdx + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    logger.warn(TAG, "JSON 파싱 실패");
    return [];
  }

  if (!Array.isArray(parsed)) {
    logger.warn(TAG, "응답이 배열이 아님");
    return [];
  }

  const results: GapResult[] = [];
  for (const item of parsed) {
    if (isValidGapResult(item)) {
      results.push({
        theme: item.theme,
        query: item.query,
        rationale: item.rationale,
      });
    }
    if (results.length >= MAX_GAP_RESULTS) break;
  }

  return results;
}

/**
 * Haiku를 호출하여 사각지대 테마를 식별한다.
 */
export async function callGapAnalysis(input: GapAnalyzerInput): Promise<GapResult[]> {
  const userMessage = buildGapPrompt(input);

  const result = await createProvider("haiku").call({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxTokens: MAX_TOKENS,
  });

  logger.info(TAG, `LLM 호출 완료 (${result.tokensUsed.input}/${result.tokensUsed.output} tokens)`);

  return parseGapResponse(result.content);
}

// ─── DB 저장 ──────────────────────────────────────────────────────────────

/**
 * Gap 분석 결과를 DB에 저장한다.
 */
export async function saveGapResults(
  date: string,
  results: GapResult[],
): Promise<number> {
  if (results.length === 0) return 0;

  let saved = 0;
  for (const gap of results) {
    try {
      await db
        .insert(newsGapAnalysis)
        .values({
          date,
          theme: gap.theme,
          query: gap.query,
          rationale: gap.rationale,
          articlesFound: 0,
        })
        .onConflictDoUpdate({
          target: [newsGapAnalysis.date, newsGapAnalysis.theme],
          set: {
            query: gap.query,
            rationale: gap.rationale,
            articlesFound: 0,
          },
        });
      saved++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(TAG, `Gap 결과 저장 실패: ${gap.theme} — ${msg}`);
    }
  }

  return saved;
}

/**
 * 동적 쿼리로 찾은 기사 수를 업데이트한다.
 */
export async function updateArticlesFound(
  date: string,
  theme: string,
  articlesFound: number,
): Promise<void> {
  await db
    .update(newsGapAnalysis)
    .set({ articlesFound })
    .where(
      and(
        eq(newsGapAnalysis.date, date),
        eq(newsGapAnalysis.theme, theme),
      ),
    );
}

/**
 * 오늘 이미 gap 분석이 실행되었는지 확인한다.
 */
export async function hasGapAnalysisToday(date: string): Promise<boolean> {
  const rows = await db
    .select({ id: newsGapAnalysis.id })
    .from(newsGapAnalysis)
    .where(eq(newsGapAnalysis.date, date))
    .limit(1);

  return rows.length > 0;
}

// ─── 메인 ─────────────────────────────────────────────────────────────────

/**
 * Gap 분석 메인 함수.
 *
 * 1. 오늘 이미 실행되었으면 스킵
 * 2. 입력 데이터 수집
 * 3. Haiku LLM 호출
 * 4. 결과 DB 저장
 *
 * @returns GapResult[] — 동적 쿼리 실행용
 */
export async function analyzeGaps(date: string): Promise<GapResult[]> {
  const alreadyRan = await hasGapAnalysisToday(date);
  if (alreadyRan) {
    logger.info(TAG, `오늘(${date}) 이미 분석 완료 — 스킵`);
    return [];
  }

  logger.info(TAG, "사각지대 분석 시작");

  const input = await collectGapInputs(date);

  logger.info(TAG, `입력: thesis=${input.activeTheses.length}, anomalies=${input.creditAnomalies.length}, categories=${Object.keys(input.categoryDistribution).length}`);

  const gaps = await callGapAnalysis(input);

  if (gaps.length === 0) {
    logger.info(TAG, "사각지대 없음 — 동적 쿼리 불필요");
    return [];
  }

  logger.info(TAG, `${gaps.length}개 사각지대 식별`);

  const saved = await saveGapResults(date, gaps);
  logger.info(TAG, `${saved}/${gaps.length}개 DB 저장 완료`);

  return gaps;
}

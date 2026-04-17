/**
 * 일간 리포트 HTML 프리뷰 스크립트.
 * 실 DB 데이터로 HTML을 생성하고 preview-daily.html 파일로 저장.
 * 브라우저에서 열어 실제 렌더링을 확인하는 용도.
 *
 * LLM을 호출하지 않는다 — 더미 인사이트로 렌더링만 검증.
 *
 * Usage: npx tsx scripts/preview-daily-html.ts [YYYY-MM-DD]
 */

import "dotenv/config";
import { writeFileSync } from "fs";
import { pool } from "../src/db/client.js";
import { getLatestPriceDate } from "../src/etl/utils/date-helpers.js";

// Tools
import { getIndexReturns } from "../src/tools/getIndexReturns.js";
import { getMarketBreadth } from "../src/tools/getMarketBreadth.js";
import { getLeadingSectors } from "../src/tools/getLeadingSectors.js";
import { getUnusualStocks } from "../src/tools/getUnusualStocks.js";
import { findTopIndustriesGlobal } from "../src/db/repositories/index.js";
import { applyIndustrySectorCap } from "../src/lib/industryFilter.js";
import { toNum } from "../src/etl/utils/common.js";
import { clampPercent } from "../src/tools/validation.js";
import { getRisingRS } from "../src/tools/getRisingRS.js";

// Schema + Builder
import type {
  DailyReportData,
  DailyReportInsight,
  DailyBreadthSnapshot,
} from "../src/tools/schemas/dailyReportSchema.js";
import { fillInsightDefaults } from "../src/tools/schemas/dailyReportSchema.js";
import { buildDailyHtml } from "../src/lib/daily-html-builder.js";

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const OUTPUT_PATH = "preview-daily.html";

const EMPTY_BREADTH_SNAPSHOT: DailyBreadthSnapshot = {
  date: "",
  totalStocks: 0,
  phaseDistribution: { phase1: 0, phase2: 0, phase3: 0, phase4: 0 },
  phase2Ratio: 0,
  phase2RatioChange: 0,
  marketAvgRs: 0,
  advanceDecline: { advancers: 0, decliners: 0, unchanged: 0, ratio: null },
  newHighLow: { newHighs: 0, newLows: 0, ratio: null },
  breadthScore: null,
  divergenceSignal: null,
  topSectors: [],
};

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

function parse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return { error: `JSON parse failed: ${json.slice(0, 200)}` };
  }
}

// ─── 더미 인사이트 ────────────────────────────────────────────────────────────

function buildDummyInsight(): DailyReportInsight {
  return fillInsightDefaults({
    marketTemperature: "neutral",
    marketTemperatureLabel: "중립 — 프리뷰 더미 데이터",
    marketTemperatureRationale:
      "이 인사이트는 LLM 없이 생성된 더미 데이터입니다. 실제 분석 내용이 아닙니다.",
    unusualStocksNarrative:
      "프리뷰 더미 — 특이종목 서사 없음.",
    risingRSNarrative:
      "프리뷰 더미 — RS 상승 초기 종목 서사 없음.",
    todayInsight: "프리뷰 더미 — 오늘의 인사이트 없음.",
    discordMessage: "[프리뷰] 더미 Discord 메시지",
  });
}

// ─── 메인 ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== 일간 리포트 HTML 프리뷰 ===\n");

  // 1. 거래일 결정
  const argDate = process.argv[2];
  const targetDate = argDate ?? await getLatestPriceDate();
  if (targetDate == null) {
    console.error(
      "거래일을 찾을 수 없습니다. 날짜를 인자로 전달하세요: npx tsx scripts/preview-daily-html.ts 2026-04-04",
    );
    process.exit(1);
  }
  console.log(`거래일: ${targetDate}\n`);

  // 2. 도구 병렬 호출 — run-daily-agent.ts의 collectDailyData와 동일 로직
  console.log("[1/7] 도구 병렬 호출 중...");
  const [
    indexRaw,
    breadthRaw,
    sectorRaw,
    industryRaw,
    unusualRaw,
    risingRsRaw,
  ] = await Promise.all([
    getIndexReturns.execute({ mode: "daily", date: targetDate }).catch((err: unknown) => {
      console.warn(`  getIndexReturns 실패: ${err instanceof Error ? err.message : String(err)}`);
      return JSON.stringify({ indices: [], fearGreed: null });
    }),
    getMarketBreadth.execute({ mode: "daily", date: targetDate }).catch((err: unknown) => {
      console.warn(`  getMarketBreadth 실패: ${err instanceof Error ? err.message : String(err)}`);
      return JSON.stringify({ error: "failed" });
    }),
    getLeadingSectors.execute({ mode: "daily", date: targetDate }).catch((err: unknown) => {
      console.warn(`  getLeadingSectors(sector) 실패: ${err instanceof Error ? err.message : String(err)}`);
      return JSON.stringify({ sectors: [] });
    }),
    findTopIndustriesGlobal(targetDate, 50).then((rows) =>
      JSON.stringify({ industries: rows }),
    ).catch((err: unknown) => {
      console.warn(`  findTopIndustriesGlobal 실패: ${err instanceof Error ? err.message : String(err)}`);
      return JSON.stringify({ industries: [] });
    }),
    getUnusualStocks.execute({ date: targetDate }).catch((err: unknown) => {
      console.warn(`  getUnusualStocks 실패: ${err instanceof Error ? err.message : String(err)}`);
      return JSON.stringify({ stocks: [] });
    }),
    getRisingRS.execute({ date: targetDate }).catch((err: unknown) => {
      console.warn(`  getRisingRS 실패: ${err instanceof Error ? err.message : String(err)}`);
      return JSON.stringify({ stocks: [] });
    }),
  ]);

  const indexData = parse(indexRaw);
  const breadthData = parse(breadthRaw);
  const sectorData = parse(sectorRaw);
  const industryData = parse(industryRaw);
  const unusualData = parse(unusualRaw);
  const risingRsData = parse(risingRsRaw);

  // 3. DailyReportData 조립
  const data: DailyReportData = {
    indexReturns: Array.isArray(indexData.indices)
      ? indexData.indices as DailyReportData["indexReturns"]
      : [],
    fearGreed: (indexData.fearGreed ?? null) as DailyReportData["fearGreed"],
    marketBreadth: breadthData.error != null
      ? { ...EMPTY_BREADTH_SNAPSHOT, date: targetDate }
      : (breadthData.snapshot ?? breadthData) as DailyBreadthSnapshot,
    sectorRanking: (Array.isArray(sectorData.sectors) ? sectorData.sectors : []) as DailyReportData["sectorRanking"],
    industryTop10: applyIndustrySectorCap(
      (Array.isArray(industryData.industries) ? industryData.industries : []).map((i: Record<string, unknown>) => ({
        industry: String(i.industry ?? ""),
        sector: String(i.sector ?? ""),
        avgRs: toNum(i.avg_rs ?? i.avgRs ?? 0),
        rsRank: Number(i.rs_rank ?? i.rsRank ?? 0),
        groupPhase: Number(i.group_phase ?? i.groupPhase ?? 0),
        phase2Ratio: clampPercent(
          Number((toNum(i.phase2_ratio ?? i.phase2Ratio ?? 0) * (String(i.phase2_ratio ?? "").includes(".") && toNum(i.phase2_ratio ?? 0) < 1 ? 100 : 1)).toFixed(1)),
          `industry:${i.industry}:phase2Ratio`,
        ),
        change4w: i.change_4w != null || i.change4w != null ? toNum(i.change_4w ?? i.change4w ?? 0) : null,
        change8w: i.change_8w != null || i.change8w != null ? toNum(i.change_8w ?? i.change8w ?? 0) : null,
        change12w: i.change_12w != null || i.change12w != null ? toNum(i.change_12w ?? i.change12w ?? 0) : null,
        sectorAvgRs: i.sector_avg_rs != null || i.sectorAvgRs != null ? toNum(i.sector_avg_rs ?? i.sectorAvgRs ?? 0) : null,
        sectorRsRank: i.sector_rs_rank != null || i.sectorRsRank != null ? Number(i.sector_rs_rank ?? i.sectorRsRank ?? 0) : null,
        divergence: null,
        changeWeek: null,
      })),
      2,
      10,
    ) as DailyReportData["industryTop10"],
    unusualStocks: (Array.isArray(unusualData.stocks) ? unusualData.stocks : [] as DailyReportData["unusualStocks"])
      .filter((s: DailyReportData["unusualStocks"][number]) => s.volRatio >= 1.0 && !s.splitSuspect),
    risingRS: (Array.isArray(risingRsData.stocks) ? risingRsData.stocks : []) as DailyReportData["risingRS"],
    marketPosition: null,
  };

  console.log(
    `  지수: ${data.indexReturns.length} | 섹터: ${data.sectorRanking.length} | 업종: ${data.industryTop10.length}`,
  );
  console.log(
    `  특이종목: ${data.unusualStocks.length} | RS상승: ${data.risingRS.length}`,
  );

  // 4. 더미 인사이트 생성 (LLM 호출 없음)
  const insight = buildDummyInsight();
  console.log("\n[2/7] 더미 인사이트 생성 (LLM 호출 없음)");

  // 5. HTML 빌드
  console.log("[3/7] HTML 빌드 중...");
  const html = buildDailyHtml(data, insight, targetDate);

  // 6. 파일 저장
  writeFileSync(OUTPUT_PATH, html);
  console.log(`\n저장 완료: ${OUTPUT_PATH} (${(html.length / 1024).toFixed(1)} KB)`);
  console.log(`\n  open ${OUTPUT_PATH}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error("Fatal:", err instanceof Error ? err.message : String(err));
  await pool.end();
  process.exit(1);
});

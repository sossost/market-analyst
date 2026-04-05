/**
 * 새 아키텍처 주간 리포트 스모크 테스트.
 * 실 DB 데이터 → buildWeeklyHtml → HTML 파일 생성.
 *
 * Usage: npx tsx scripts/preview-weekly-new.ts [YYYY-MM-DD]
 */

import { pool } from "../src/db/client.js";
import { getIndexReturns } from "../src/tools/getIndexReturns.js";
import { getMarketBreadth } from "../src/tools/getMarketBreadth.js";
import { getLeadingSectors } from "../src/tools/getLeadingSectors.js";
import { getWatchlistStatus } from "../src/tools/getWatchlistStatus.js";
import { getPhase2Stocks } from "../src/tools/getPhase2Stocks.js";
import { buildWeeklyHtml } from "../src/lib/weekly-html-builder.js";
import { getLatestPriceDate } from "../src/etl/utils/date-helpers.js";
import type {
  WeeklyReportData,
  WeeklyReportInsight,
  MarketBreadthData,
} from "../src/tools/schemas/weeklyReportSchema.js";
import { writeFileSync } from "fs";

function parse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return { error: `JSON parse failed: ${json.slice(0, 200)}` };
  }
}

const EMPTY_BREADTH: MarketBreadthData = {
  weeklyTrend: [],
  phase1to2Transitions: 0,
  latestSnapshot: {
    date: "", totalStocks: 0,
    phaseDistribution: { phase1: 0, phase2: 0, phase3: 0, phase4: 0 },
    phase2Ratio: 0, phase2RatioChange: 0, marketAvgRs: 0,
    advanceDecline: { advancers: 0, decliners: 0, unchanged: 0, ratio: null },
    newHighLow: { newHighs: 0, newLows: 0, ratio: null },
    breadthScore: null, divergenceSignal: null, topSectors: [],
  },
};

async function main() {
  console.log("=== 주간 리포트 새 아키텍처 프리뷰 ===\n");

  // 날짜 결정
  const argDate = process.argv[2];
  const targetDate = argDate ?? await getLatestPriceDate();
  if (targetDate == null) {
    console.error("거래일을 찾을 수 없습니다. 날짜를 인자로 전달하세요: npx tsx scripts/preview-weekly-new.ts 2026-04-04");
    process.exit(1);
  }
  console.log(`거래일: ${targetDate}\n`);

  // 1. 도구 호출
  console.log("[1/6] get_index_returns (weekly)...");
  const indexRaw = parse(await getIndexReturns.execute({ mode: "weekly", date: targetDate }));
  const indices = Array.isArray(indexRaw.indices) ? indexRaw.indices : [];
  const fearGreed = indexRaw.fearGreed ?? null;
  console.log(`  ✓ ${indices.length} indices, fearGreed: ${fearGreed != null}`);

  console.log("[2/6] get_market_breadth (weekly)...");
  const breadthRaw = parse(await getMarketBreadth.execute({ mode: "weekly", date: targetDate }));
  if (breadthRaw.error) console.log(`  ⚠ ${breadthRaw.error}`);
  const breadth: MarketBreadthData = breadthRaw.error
    ? EMPTY_BREADTH
    : {
        weeklyTrend: Array.isArray(breadthRaw.weeklyTrend) ? breadthRaw.weeklyTrend : [],
        phase1to2Transitions: Number(breadthRaw.phase1to2Transitions ?? 0),
        latestSnapshot: (breadthRaw.latestSnapshot ?? EMPTY_BREADTH.latestSnapshot) as MarketBreadthData["latestSnapshot"],
      };
  console.log(`  ✓ weeklyTrend: ${breadth.weeklyTrend.length}, p2ratio: ${breadth.latestSnapshot.phase2Ratio}`);

  console.log("[3/6] get_leading_sectors (weekly)...");
  const sectorRaw = parse(await getLeadingSectors.execute({ mode: "weekly", date: targetDate }));
  if (sectorRaw.error) console.log(`  ⚠ ${sectorRaw.error}`);
  const sectors = Array.isArray(sectorRaw.sectors) ? sectorRaw.sectors : [];
  console.log(`  ✓ ${sectors.length} sectors`);

  console.log("[4/6] get_leading_sectors (industry)...");
  const industryRaw = parse(await getLeadingSectors.execute({ mode: "industry", limit: 10, date: targetDate }));
  if (industryRaw.error) console.log(`  ⚠ ${industryRaw.error}`);
  const industries = Array.isArray(industryRaw.industries) ? industryRaw.industries : [];
  console.log(`  ✓ ${industries.length} industries`);

  console.log("[5/6] get_watchlist_status...");
  const watchlistRaw = parse(await getWatchlistStatus.execute({ include_trajectory: true, date: targetDate }));
  const watchlist = {
    summary: (watchlistRaw.summary ?? { totalActive: 0, phaseChanges: [], avgPnlPercent: 0 }) as WeeklyReportData["watchlist"]["summary"],
    items: Array.isArray(watchlistRaw.items) ? watchlistRaw.items : [],
  };
  console.log(`  ✓ ${watchlist.summary.totalActive} active`);

  console.log("[6/6] get_phase2_stocks...");
  const phase2Raw = parse(await getPhase2Stocks.execute({ min_rs: 60, date: targetDate }));
  const stocks = Array.isArray(phase2Raw.stocks) ? phase2Raw.stocks : [];
  console.log(`  ✓ ${stocks.length} gate5 candidates`);

  // 2. WeeklyReportData 조립
  const reportData: WeeklyReportData = {
    indexReturns: indices as WeeklyReportData["indexReturns"],
    fearGreed: fearGreed as WeeklyReportData["fearGreed"],
    marketBreadth: breadth,
    sectorRanking: sectors as WeeklyReportData["sectorRanking"],
    industryTop10: industries as WeeklyReportData["industryTop10"],
    watchlist,
    gate5Candidates: stocks as WeeklyReportData["gate5Candidates"],
  };

  // 3. 목업 인사이트
  const mockInsight: WeeklyReportInsight = {
    marketTemperature: "bearish",
    marketTemperatureLabel: "약세 — EARLY_BEAR 레짐 지속",
    sectorRotationNarrative: "Energy 섹터가 RS 71.5로 1위를 유지하며 3주 연속 상위권을 지키고 있다. Utilities(RS 59.4)와 Consumer Defensive(RS 57.2)가 2-3위로 방어적 섹터 선호가 뚜렷하다.\n\nTechnology는 RS 43.5로 최하위권에 머물며, 반도체와 소프트웨어 간 괴리가 심화되고 있다.",
    industryFlowNarrative: "Personal Products(+8.2), Consulting Services(+6.5), Software-Services(+5.3) 순으로 주간 RS 변화가 컸다. Industrials 내 3개 업종(Consulting, Trucking, Marine Shipping)이 동시에 Top 10에 진입한 점이 주목할 만하다.",
    watchlistNarrative: "현재 ACTIVE 관심종목이 없는 상태다. EARLY_BEAR 레짐에서 5중 게이트를 통과할 종목이 구조적으로 적은 것은 정상이다.",
    gate5Summary: "이번 주 5중 게이트 평가 결과, 위 후보들의 thesis 연결과 업종 RS 동반 상승 여부를 추가 확인해야 한다.",
    riskFactors: "- **EARLY_BEAR 레짐 지속**: Phase 2 비율 개선이나 탈출 기준까지 거리\n- **VIX 20 이상**: 안정 구간 미진입\n- **공포탐욕 극단적 공포**: 역사적 반등 구간이나 추가 하락 가능성",
    nextWeekWatchpoints: "### RS 가속 업종 Top 3\n- **Personal Products & Services** — RS 55.4 (+8.2)\n- **Consulting Services** — RS 56.1 (+6.5)\n- **Software - Services** — RS 39.3 (+5.3)",
    thesisScenarios: "- **AI 광통신 병목** ACTIVE → Technology RS 50 회복 여부 확인\n- **Financial Services 로테이션** → 섹터 RS 55 돌파 여부\n- **Energy 과열 조정** → 섹터 RS 70 하회 시 전환 확인",
    debateInsight: "이번 주 **Energy 과열 조정** thesis와 **인프라 자금 유입** thesis가 Industrials에서 충돌하고 있다. Energy RS가 -4.5로 하락하면서 과열 조정 thesis가 힘을 얻는 반면, Industrials 내 Engineering(ECG RS 92, STRL RS 84) + Marine Shipping(RS 71.3 +3.9)이 동시에 강세를 보이며 인프라 thesis를 지지한다.\n\n애널리스트 3명은 Energy→Industrials 로테이션 진행 중으로 판단, 2명은 단기 되돌림으로 관망 입장.",
    narrativeEvolution: "**AI 광통신 병목** 체인이 이번 주 약화 조짐. Technology 섹터 RS 43.5(최하위)에서 반도체(TER RS 93, ADI RS 73)만 버티고 Software/Communication은 이탈. 체인이 'AI 전반'에서 '반도체 단독'으로 축소 분기 중.\n\n**Financial Services 로테이션** 체인은 Banks-Regional(CAC, OSBC, BUSE, CNOB, INDB) 5개 종목이 동시에 게이트 후보에 올라오면서 확장 신호.",
    thesisAccuracy: "지난 4주 thesis 적중률 62% (8/13). 최근 적중: Energy 과열 초기 경고(3주 전) → 실제 RS -4.5 하락. 최근 실패: Consumer Cyclical 반등 thesis → Phase 3 유지, RS 변화 0.0으로 무반응. 현재 ACTIVE thesis 중 신뢰도 조정: Energy 과열(HIGH→HIGH 유지), AI 광통신(HIGH→MED 하향 검토).",
    regimeContext: "EARLY_BEAR 레짐에서 Phase 2 비율 반등은 기술적 되돌림 수준. 추세 전환 확정(Phase 2 ≥ 40% + RECOVERY) 전까지 보수적 접근 유지.",
    discordMessage: "📊 주간 시장 분석\nEARLY_BEAR 레짐 지속 — 신규 등록 보수적 접근",
  };

  // 4. HTML 생성
  console.log(`\n빌드 중...`);
  const html = buildWeeklyHtml(reportData, mockInsight, targetDate);

  const outputPath = "preview-weekly-new.html";
  writeFileSync(outputPath, html);
  console.log(`\n✅ ${outputPath} (${(html.length / 1024).toFixed(1)} KB)`);
  console.log(`  지수: ${reportData.indexReturns.length} | 섹터: ${reportData.sectorRanking.length} | 업종: ${reportData.industryTop10.length}`);
  console.log(`  관심종목: ${reportData.watchlist.summary.totalActive} | Gate5: ${reportData.gate5Candidates.length}`);
  console.log(`\n  open ${outputPath}`);

  await pool.end();
}

main().catch(async (err) => {
  console.error("Fatal:", err);
  await pool.end();
  process.exit(1);
});

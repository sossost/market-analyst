import { describe, it, expect } from "vitest";
import {
  renderIndexTable,
  renderWeeklyTrendTable,
  renderPhase2TrendTable,
  renderSectorTable,
  renderIndustryTop10Table,
  renderWatchlistSection,
  renderWatchlistChanges,
  buildWeeklyHtml,
} from "../weekly-html-builder.js";
import type {
  IndexReturn,
  FearGreedData,
  MarketBreadthData,
  SectorDetail,
  IndustryItem,
  WatchlistStatusData,
  Phase2Stock,
  WeeklyReportData,
  WeeklyReportInsight,
} from "@/tools/schemas/weeklyReportSchema.js";

// ─── 팩토리 함수 ──────────────────────────────────────────────────────────────

function createMockIndexReturn(overrides?: Partial<IndexReturn>): IndexReturn {
  return {
    symbol: "^GSPC",
    name: "S&P 500",
    weekStartClose: 5000,
    weekEndClose: 5100,
    weeklyChange: 100,
    weeklyChangePercent: 2.0,
    weekHigh: 5150,
    weekLow: 4950,
    closePosition: "near_high",
    tradingDays: 5,
    ...overrides,
  };
}

function createMockFearGreed(overrides?: Partial<FearGreedData>): FearGreedData {
  return {
    score: 50,
    rating: "Neutral",
    previousClose: 48,
    previous1Week: 45,
    previous1Month: 40,
    ...overrides,
  };
}

function createMockMarketBreadth(overrides?: Partial<MarketBreadthData>): MarketBreadthData {
  return {
    weeklyTrend: [
      { date: "2026-03-28", phase2Ratio: 30.5, marketAvgRs: 48.2 },
      { date: "2026-04-04", phase2Ratio: 32.1, marketAvgRs: 49.5 },
    ],
    phase1to2Transitions: 12,
    latestSnapshot: {
      date: "2026-04-04",
      totalStocks: 4600,
      phaseDistribution: { phase1: 500, phase2: 1400, phase3: 1600, phase4: 1100 },
      phase2Ratio: 32.1,
      phase2RatioChange: 1.6,
      marketAvgRs: 49.5,
      advanceDecline: { advancers: 2500, decliners: 1800, unchanged: 300, ratio: 1.39 },
      newHighLow: { newHighs: 80, newLows: 55, ratio: 1.45 },
      breadthScore: 62.5,
      breadthScoreChange: null,
      divergenceSignal: null,
      pctAboveMa50: null,
      topSectors: [],
    },
    ...overrides,
  };
}

function createMockSectorDetail(overrides?: Partial<SectorDetail>): SectorDetail {
  return {
    sector: "Technology",
    avgRs: 58.3,
    rsRank: 3,
    stockCount: 450,
    change4w: 5.2,
    change8w: 8.1,
    change12w: 12.0,
    groupPhase: 2,
    prevGroupPhase: 2,
    phase2Ratio: 42.0,
    maOrderedRatio: 65.0,
    phase1to2Count5d: 8,
    topIndustries: [],
    prevWeekRank: 4,
    rankChange: 1,
    prevWeekAvgRs: 56.0,
    rsChange: 2.3,
    ...overrides,
  };
}

function createMockIndustryItem(overrides?: Partial<IndustryItem>): IndustryItem {
  return {
    industry: "Semiconductors",
    sector: "Technology",
    avgRs: 64.5,
    rsRank: 1,
    groupPhase: 2,
    phase2Ratio: 55.0,
    change4w: 8.2,
    change8w: 12.5,
    change12w: 18.0,
    sectorAvgRs: 58.3,
    sectorRsRank: 3,
    divergence: 6.2,
    changeWeek: 3.1,
    ...overrides,
  };
}

function createMockWatchlistStatusData(
  overrides?: Partial<WatchlistStatusData>,
): WatchlistStatusData {
  return {
    summary: {
      totalActive: 2,
      phaseChanges: [],
      avgPnlPercent: 5.5,
    },
    items: [
      {
        symbol: "NVDA",
        entryDate: "2026-03-01",
        trackingEndDate: null,
        daysTracked: 34,
        entryPhase: 2,
        currentPhase: 2,
        entryRsScore: 90,
        currentRsScore: 92,
        entrySector: "Technology",
        entryIndustry: "Semiconductors",
        entrySepaGrade: "A",
        priceAtEntry: 800,
        currentPrice: 850,
        pnlPercent: 6.25,
        maxPnlPercent: 8.0,
        sectorRelativePerf: 2.1,
        phaseTrajectory: [
          { date: "2026-03-01", phase: 2, rsScore: 90 },
          { date: "2026-03-08", phase: 2, rsScore: 91 },
          { date: "2026-03-15", phase: 2, rsScore: 92 },
        ],
        entryReason: "Phase 2 진입",
        hasThesisBasis: true,
        phase2Since: "2026-02-25",
        phase2SinceDays: 34,
        phase2Segment: "확립",
      },
    ],
    ...overrides,
  };
}

function createMockPhase2Stock(overrides?: Partial<Phase2Stock>): Phase2Stock {
  return {
    symbol: "AAPL",
    phase: 2,
    prevPhase: 1,
    isNewPhase2: true,
    rsScore: 75,
    ma150Slope: 0.012,
    pctFromHigh52w: -5.2,
    pctFromLow52w: 28.5,
    isExtremePctFromLow: false,
    conditionsMet: ["MA 정배열", "Phase 2 진입", "RS >= 60"],
    volRatio: 1.8,
    volumeConfirmed: true,
    breakoutSignal: "52w_breakout",
    sector: "Technology",
    industry: "Consumer Electronics",
    sepaGrade: "A",
    ...overrides,
  };
}

function createMockWeeklyReportData(
  overrides?: Partial<WeeklyReportData>,
): WeeklyReportData {
  return {
    indexReturns: [createMockIndexReturn()],
    fearGreed: createMockFearGreed(),
    marketBreadth: createMockMarketBreadth(),
    sectorRanking: [createMockSectorDetail()],
    industryTop10: [createMockIndustryItem()],
    watchlist: createMockWatchlistStatusData(),
    gate5Candidates: [createMockPhase2Stock()],
    watchlistChanges: { registered: [], exited: [] },
    activePortfolioSymbols: [],
    thesisAlignedCandidates: null,
    vcpCandidates: null,
    confirmedBreakouts: null,
    sectorLagPatterns: null,
    ...overrides,
  };
}

function createMockWeeklyReportInsight(
  overrides?: Partial<WeeklyReportInsight>,
): WeeklyReportInsight {
  return {
    marketTemperature: "neutral",
    marketTemperatureLabel: "중립 — 관망",
    sectorRotationNarrative: "섹터 로테이션 해석 텍스트",
    industryFlowNarrative: "업종 자금 흐름 해석",
    watchlistNarrative: "관심종목 서사",
    gate5Summary: "5중 게이트 요약",
    riskFactors: "리스크 요인",
    nextWeekWatchpoints: "다음 주 관전 포인트",
    thesisScenarios: "thesis 시나리오",
    debateInsight: "토론 인사이트",
    narrativeEvolution: "서사 체인 진화",
    thesisAccuracy: "thesis 적중률",
    regimeContext: "레짐 맥락",
    discordMessage: "Discord 핵심 요약",
    ...overrides,
  };
}

// ─── renderIndexTable ─────────────────────────────────────────────────────────

describe("renderIndexTable", () => {
  it("정상 데이터: 인덱스 카드를 생성하고 name/value/change%를 포함한다", () => {
    const indices = [
      createMockIndexReturn({ name: "S&P 500", weekEndClose: 5100, weeklyChangePercent: 2.0 }),
      createMockIndexReturn({ symbol: "^IXIC", name: "NASDAQ", weekEndClose: 17000, weeklyChangePercent: -1.5 }),
      createMockIndexReturn({ symbol: "^DJI", name: "DOW JONES", weekEndClose: 38000, weeklyChangePercent: 0.8 }),
      createMockIndexReturn({ symbol: "^RUT", name: "RUSSELL 2000", weekEndClose: 2100, weeklyChangePercent: 3.2 }),
    ];

    const result = renderIndexTable(indices, null);

    expect(result).toContain("S&amp;P 500");
    expect(result).toContain("NASDAQ");
    expect(result).toContain("DOW JONES");
    expect(result).toContain("RUSSELL 2000");
    expect(result).toContain("+2.00%");
    expect(result).toContain("-1.50%");
    const cardCount = (result.match(/class="index-card"/g) ?? []).length;
    expect(cardCount).toBe(4);
  });

  it("빈 배열: 빈 상태 메시지를 반환한다", () => {
    const result = renderIndexTable([], null);

    expect(result).toContain("지수 데이터를 가져올 수 없습니다");
    expect(result).not.toContain("index-card");
  });

  it("fearGreed 포함: 그리드 내 카드로 점수/등급을 표시한다", () => {
    const fg = createMockFearGreed({ score: 72, rating: "Greed" });

    const result = renderIndexTable([createMockIndexReturn()], fg);

    expect(result).toContain("공포탐욕");
    expect(result).toContain("72");
    expect(result).toContain("Greed");
    // 그리드 내 index-card로 통합됨 (fear-greed-row 아님)
    expect(result).not.toContain("fear-greed-row");
  });

  it("fearGreed null: Fear & Greed 카드가 없다", () => {
    const result = renderIndexTable([createMockIndexReturn()], null);

    expect(result).not.toContain("공포탐욕");
  });

  it("양수 변화율에 up 클래스가 적용된다", () => {
    const result = renderIndexTable(
      [createMockIndexReturn({ weeklyChangePercent: 2.5 })],
      null,
    );

    expect(result).toContain('class="change up"');
  });

  it("음수 변화율에 down 클래스가 적용된다", () => {
    const result = renderIndexTable(
      [createMockIndexReturn({ weeklyChangePercent: -1.3 })],
      null,
    );

    expect(result).toContain('class="change down"');
  });

  it("VIX 카드: weeklyChangePercent 대신 방향 레이블(▲/▼)을 표시한다", () => {
    const vix = createMockIndexReturn({
      symbol: "^VIX",
      name: "VIX",
      weekStartClose: 25,
      weekEndClose: 23,
      weeklyChangePercent: -8.0, // 이 값은 VIX 카드에서 표시되지 않아야 함
      weekHigh: 27,
      weekLow: 21,
    });

    const result = renderIndexTable([vix], null);

    // 방향 레이블이 있고 weeklyChangePercent 포맷(-8.00%)이 없어야 함
    expect(result).toContain("▼ 안도");
    expect(result).not.toContain("-8.00%");
  });

  it("VIX 상승 시 down 컬러 클래스가 적용된다 (역방향 — 시장 불안)", () => {
    const vix = createMockIndexReturn({
      symbol: "^VIX",
      name: "VIX",
      weekStartClose: 20,
      weekEndClose: 28,
      weekHigh: 30,
      weekLow: 19,
    });

    const result = renderIndexTable([vix], null);

    expect(result).toContain("▲ 경계");
    expect(result).toContain('class="change down"');
  });

  it("VIX 하락 시 up 컬러 클래스가 적용된다 (역방향 — 시장 안도)", () => {
    const vix = createMockIndexReturn({
      symbol: "^VIX",
      name: "VIX",
      weekStartClose: 30,
      weekEndClose: 22,
      weekHigh: 31,
      weekLow: 20,
    });

    const result = renderIndexTable([vix], null);

    expect(result).toContain("▼ 안도");
    expect(result).toContain('class="change up"');
  });

  it("VIX weekHigh >= 25: 공포 임계선 도달 배지가 표시된다", () => {
    const vix = createMockIndexReturn({
      symbol: "^VIX",
      name: "VIX",
      weekStartClose: 22,
      weekEndClose: 24,
      weekHigh: 26,
      weekLow: 21,
    });

    const result = renderIndexTable([vix], null);

    expect(result).toContain("주중 공포 임계선 도달");
  });

  it("VIX weekHigh < 25: 공포 임계선 도달 배지가 없다", () => {
    const vix = createMockIndexReturn({
      symbol: "^VIX",
      name: "VIX",
      weekStartClose: 18,
      weekEndClose: 20,
      weekHigh: 22,
      weekLow: 17,
    });

    const result = renderIndexTable([vix], null);

    expect(result).not.toContain("주중 공포 임계선 도달");
  });

  it("VIX 카드가 주간 레인지(고/저)를 표시한다", () => {
    const vix = createMockIndexReturn({
      symbol: "^VIX",
      name: "VIX",
      weekStartClose: 20,
      weekEndClose: 23,
      weekHigh: 27.5,
      weekLow: 18.3,
    });

    const result = renderIndexTable([vix], null);

    expect(result).toContain("27.5");
    expect(result).toContain("18.3");
  });
});

// ─── Fear & Greed 방향 레이블 ─────────────────────────────────────────────────

describe("renderIndexTable — Fear & Greed 방향 레이블", () => {
  it("score > previous1Week + score >= 50: 탐욕 심화 레이블이 표시된다", () => {
    const fg = createMockFearGreed({ score: 65, previous1Week: 55 });

    const result = renderIndexTable([createMockIndexReturn()], fg);

    expect(result).toContain("탐욕 심화");
  });

  it("score > previous1Week + score < 50: 공포 완화 레이블이 표시된다", () => {
    const fg = createMockFearGreed({ score: 45, previous1Week: 35 });

    const result = renderIndexTable([createMockIndexReturn()], fg);

    expect(result).toContain("공포 완화");
  });

  it("score < previous1Week + score < 50: 공포 심화 레이블이 표시된다", () => {
    const fg = createMockFearGreed({ score: 30, previous1Week: 45 });

    const result = renderIndexTable([createMockIndexReturn()], fg);

    expect(result).toContain("공포 심화");
  });

  it("score < previous1Week + score >= 50: 탐욕 약화 레이블이 표시된다", () => {
    const fg = createMockFearGreed({ score: 55, previous1Week: 70 });

    const result = renderIndexTable([createMockIndexReturn()], fg);

    expect(result).toContain("탐욕 약화");
  });

  it("score === previous1Week (탐욕 구간 50): 변동 없음 레이블이 표시된다", () => {
    const fg = createMockFearGreed({ score: 50, previous1Week: 50 });

    const result = renderIndexTable([createMockIndexReturn()], fg);

    expect(result).toContain("변동 없음");
  });

  it("score === previous1Week (공포 구간 30): 변동 없음 레이블이 표시된다", () => {
    const fg = createMockFearGreed({ score: 30, previous1Week: 30 });

    const result = renderIndexTable([createMockIndexReturn()], fg);

    expect(result).toContain("변동 없음");
  });

  it("previous1Week null: 방향 레이블(탐욕 심화/공포 심화 등)이 없다", () => {
    const fg = createMockFearGreed({ score: 50, previous1Week: null });

    const result = renderIndexTable([createMockIndexReturn()], fg);

    // "Fear & Greed"은 카드 제목이므로 항상 존재. 방향 레이블만 없어야 함.
    expect(result).not.toContain("탐욕 심화");
    expect(result).not.toContain("탐욕 약화");
    expect(result).not.toContain("공포 심화");
    expect(result).not.toContain("공포 완화");
  });

  it("previous1Week가 있을 때 주간 변화량이 .change 행에 표시된다", () => {
    const fg = createMockFearGreed({ score: 45.2, previous1Week: 31.5 });

    const result = renderIndexTable([createMockIndexReturn()], fg);

    // 주간 변화량(+13.7)이 .change 행에 표시되고, '1주전' 수치 텍스트는 노출하지 않는다
    expect(result).toContain("+13.7");
    expect(result).not.toContain("1주전 31.5");
  });
});

// ─── renderIndexTable — 10Y / DXY / FearGreed 카드 ────────────────────────────

describe("renderIndexTable — 10Y/DXY/FearGreed 카드", () => {
  it("^TNX 심볼: yield(%) 포맷 + bp 변화를 표시한다", () => {
    const tnx = createMockIndexReturn({
      symbol: "^TNX",
      name: "US 10Y",
      weekStartClose: 4.25,
      weekEndClose: 4.35,
      weeklyChangePercent: 2.35,
    });

    const result = renderIndexTable([tnx], null);

    expect(result).toContain("US 10Y");
    expect(result).toContain("4.35%");
    expect(result).toContain("+10.0bp");
  });

  it("DX-Y.NYB 심볼: 포인트 + % 변화를 표시한다", () => {
    const dxy = createMockIndexReturn({
      symbol: "DX-Y.NYB",
      name: "DXY",
      weekStartClose: 104.5,
      weekEndClose: 105.2,
      weeklyChangePercent: 0.67,
    });

    const result = renderIndexTable([dxy], null);

    expect(result).toContain("DXY");
    expect(result).toContain("105.2");
    expect(result).toContain("+0.70pt");
  });

  it("FearGreed 카드가 그리드 내에 배치된다", () => {
    const fg = createMockFearGreed({ score: 42, rating: "Fear" });

    const result = renderIndexTable([createMockIndexReturn()], fg);

    // 그리드 안에 Fear & Greed 카드가 있어야 함
    const gridContent = result.match(/class="index-grid">([\s\S]*)<\/div>/)?.[1] ?? "";
    expect(gridContent).toContain("공포탐욕");
  });

  it("4×2 배치: 8개 항목(4지수+VIX+10Y+DXY+FearGreed) 모두 index-card로 렌더링된다", () => {
    const indices = [
      createMockIndexReturn({ symbol: "^GSPC", name: "S&P 500" }),
      createMockIndexReturn({ symbol: "^IXIC", name: "NASDAQ" }),
      createMockIndexReturn({ symbol: "^DJI", name: "DOW" }),
      createMockIndexReturn({ symbol: "^RUT", name: "Russell" }),
      createMockIndexReturn({ symbol: "^VIX", name: "VIX", weekStartClose: 20, weekEndClose: 22 }),
      createMockIndexReturn({ symbol: "^TNX", name: "US 10Y", weekStartClose: 4.2, weekEndClose: 4.3, weeklyChangePercent: 2.38 }),
      createMockIndexReturn({ symbol: "DX-Y.NYB", name: "DXY", weekStartClose: 104, weekEndClose: 105, weeklyChangePercent: 0.96 }),
    ];
    const fg = createMockFearGreed();

    const result = renderIndexTable(indices, fg);

    const cardCount = (result.match(/class="index-card"/g) ?? []).length;
    expect(cardCount).toBe(8); // 7 indices + 1 fear greed card
  });
});

// ─── renderWeeklyTrendTable ─────────────────────────────────────────────────

describe("renderWeeklyTrendTable", () => {
  it("정상: 날짜/비율/전일 대비를 포함하는 테이블을 렌더링한다", () => {
    const trend = [
      { date: "2026-03-31", phase2Ratio: 30.5, marketAvgRs: 48.0 },
      { date: "2026-04-01", phase2Ratio: 31.2, marketAvgRs: 48.5 },
      { date: "2026-04-02", phase2Ratio: 30.8, marketAvgRs: 48.3 },
      { date: "2026-04-03", phase2Ratio: 31.5, marketAvgRs: 49.0 },
      { date: "2026-04-04", phase2Ratio: 32.1, marketAvgRs: 49.5 },
    ];

    const result = renderWeeklyTrendTable(trend);

    expect(result).toContain("Phase 2 비율 주간 추이");
    expect(result).toContain("weekly-trend-table");
    expect(result).toContain("3/31");
    expect(result).toContain("4/4");
    expect(result).toContain("30.5%");
    expect(result).toContain("32.1%");
  });

  it("첫 행은 전일 대비가 —로 표시된다", () => {
    const trend = [
      { date: "2026-04-01", phase2Ratio: 30.0, marketAvgRs: 48.0 },
      { date: "2026-04-02", phase2Ratio: 31.0, marketAvgRs: 48.5 },
    ];

    const result = renderWeeklyTrendTable(trend);

    expect(result).toContain("—");
  });

  it("양수 변화에 up 클래스가 적용된다", () => {
    const trend = [
      { date: "2026-04-01", phase2Ratio: 30.0, marketAvgRs: 48.0 },
      { date: "2026-04-02", phase2Ratio: 32.0, marketAvgRs: 49.0 },
    ];

    const result = renderWeeklyTrendTable(trend);

    expect(result).toContain('class="up"');
    expect(result).toContain("+2.0%p");
  });

  it("음수 변화에 down 클래스가 적용된다", () => {
    const trend = [
      { date: "2026-04-01", phase2Ratio: 32.0, marketAvgRs: 49.0 },
      { date: "2026-04-02", phase2Ratio: 30.0, marketAvgRs: 48.0 },
    ];

    const result = renderWeeklyTrendTable(trend);

    expect(result).toContain('class="down"');
    expect(result).toContain("-2.0%p");
  });

  it("데이터 1일 미만: 빈 문자열을 반환한다", () => {
    const result = renderWeeklyTrendTable([
      { date: "2026-04-01", phase2Ratio: 30.0, marketAvgRs: 48.0 },
    ]);

    expect(result).toBe("");
  });

  it("빈 배열: 빈 문자열을 반환한다", () => {
    const result = renderWeeklyTrendTable([]);

    expect(result).toBe("");
  });
});

// ─── renderPhase2TrendTable — breadthNarrative ──────────────────────────────

describe("renderPhase2TrendTable — breadthNarrative", () => {
  it("breadthNarrative가 있으면 content-block으로 렌더링된다", () => {
    const breadth = createMockMarketBreadth();

    const result = renderPhase2TrendTable(breadth, "시장 폭이 확장 중입니다.");

    expect(result).toContain("content-block");
    expect(result).toContain("시장 폭이 확장 중입니다.");
  });

  it("breadthNarrative가 undefined이면 content-block이 없다", () => {
    const breadth = createMockMarketBreadth();

    const result = renderPhase2TrendTable(breadth);

    expect(result).not.toContain("content-block");
  });

  it("breadthNarrative가 빈 문자열이면 content-block이 없다", () => {
    const breadth = createMockMarketBreadth();

    const result = renderPhase2TrendTable(breadth, "");

    expect(result).not.toContain("content-block");
  });

  it("weeklyTrend가 5일일 때 추이 테이블이 포함된다", () => {
    const breadth = createMockMarketBreadth({
      weeklyTrend: [
        { date: "2026-03-31", phase2Ratio: 30.0, marketAvgRs: 48.0 },
        { date: "2026-04-01", phase2Ratio: 30.5, marketAvgRs: 48.2 },
        { date: "2026-04-02", phase2Ratio: 31.0, marketAvgRs: 48.5 },
        { date: "2026-04-03", phase2Ratio: 31.5, marketAvgRs: 49.0 },
        { date: "2026-04-04", phase2Ratio: 32.1, marketAvgRs: 49.5 },
      ],
    });

    const result = renderPhase2TrendTable(breadth);

    expect(result).toContain("weekly-trend-table");
    expect(result).toContain("Phase 2 비율 주간 추이");
  });
});

// ─── renderPhase2TrendTable ───────────────────────────────────────────────────

describe("renderPhase2TrendTable", () => {
  it("정상: Phase 분포 바 + 주간 변화 인라인 + stat 칩을 렌더링한다", () => {
    const breadth = createMockMarketBreadth();

    const result = renderPhase2TrendTable(breadth);

    expect(result).toContain("phase-bar");
    expect(result).toContain("stat-chip");
    expect(result).toContain("주간");
  });

  it("빈 weeklyTrend: Phase 분포 바는 표시하되 인라인 주간 변화 없음", () => {
    const breadth = createMockMarketBreadth({ weeklyTrend: [] });

    const result = renderPhase2TrendTable(breadth);

    expect(result).toContain("phase-bar");
    // 인라인 "(주간 +X.X%p)" 없음
    expect(result).not.toContain("%p)");
  });

  it("phase2RatioChange 양수: up 색상 클래스가 적용된다", () => {
    const breadth = createMockMarketBreadth();
    breadth.latestSnapshot.phase2RatioChange = 2.5;

    const result = renderPhase2TrendTable(breadth);

    expect(result).toContain("+2.5%p");
    expect(result).toContain('class="stat-value up"');
  });

  it("phase2RatioChange 음수: down 색상 클래스가 적용된다", () => {
    const breadth = createMockMarketBreadth();
    breadth.latestSnapshot.phase2RatioChange = -1.8;

    const result = renderPhase2TrendTable(breadth);

    expect(result).toContain("-1.8%p");
    expect(result).toContain('class="stat-value down"');
  });

  it("Phase 분포 바에 4개 세그먼트가 모두 포함된다", () => {
    const result = renderPhase2TrendTable(createMockMarketBreadth());

    expect(result).toContain('class="seg p1"');
    expect(result).toContain('class="seg p2"');
    expect(result).toContain('class="seg p3"');
    expect(result).toContain('class="seg p4"');
  });

  it("phase1to2Transitions 수가 stat 칩에 표시된다", () => {
    const breadth = createMockMarketBreadth({ phase1to2Transitions: 17 });

    const result = renderPhase2TrendTable(breadth);

    expect(result).toContain("17건");
  });

  it("pctAboveMa50가 있으면 MA50 이상 비율 chip을 표시한다", () => {
    const breadth = createMockMarketBreadth({
      latestSnapshot: {
        ...createMockMarketBreadth().latestSnapshot,
        pctAboveMa50: 48.7,
      },
    });
    const result = renderPhase2TrendTable(breadth);
    expect(result).toContain("MA50 이상 비율");
    expect(result).toContain("48.7%");
  });

  it("pctAboveMa50가 null이면 MA50 이상 비율 chip을 표시하지 않는다", () => {
    const breadth = createMockMarketBreadth({
      latestSnapshot: {
        ...createMockMarketBreadth().latestSnapshot,
        pctAboveMa50: null,
      },
    });
    const result = renderPhase2TrendTable(breadth);
    expect(result).not.toContain("MA50 이상 비율");
  });

  it("divergenceSignal이 negative면 중기 약화 경고 알럿을 표시한다", () => {
    const breadth = createMockMarketBreadth({
      latestSnapshot: {
        ...createMockMarketBreadth().latestSnapshot,
        divergenceSignal: "negative",
      },
    });
    const result = renderPhase2TrendTable(breadth);
    expect(result).toContain("alert-warning");
    expect(result).toContain("중기 약화 경고");
  });

  it("divergenceSignal이 positive면 중기 반등 신호 알럿을 표시한다", () => {
    const breadth = createMockMarketBreadth({
      latestSnapshot: {
        ...createMockMarketBreadth().latestSnapshot,
        divergenceSignal: "positive",
      },
    });
    const result = renderPhase2TrendTable(breadth);
    expect(result).toContain("alert-warning");
    expect(result).toContain("중기 반등 신호");
  });

  it("divergenceSignal이 null이면 알럿을 표시하지 않는다", () => {
    const result = renderPhase2TrendTable(createMockMarketBreadth());
    expect(result).not.toContain("alert-block");
    expect(result).not.toContain("다이버전스");
  });
});

// ─── renderSectorTable ────────────────────────────────────────────────────────

describe("renderSectorTable", () => {
  it("정상: 섹터 행에 RS/순위/Phase가 포함된다", () => {
    const sectors = [
      createMockSectorDetail({ sector: "Technology", avgRs: 58.3, rsRank: 3, groupPhase: 2 }),
      createMockSectorDetail({ sector: "Energy", avgRs: 72.1, rsRank: 1, groupPhase: 2 }),
    ];

    const result = renderSectorTable(sectors);

    expect(result).toContain("Technology");
    expect(result).toContain("Energy");
    expect(result).toContain("58.3");
    expect(result).toContain("72.1");
    expect(result).toContain("Phase 2");
  });

  it("rankChange 양수: ▲ 마크업이 up 클래스와 함께 표시된다", () => {
    const result = renderSectorTable([
      createMockSectorDetail({ rankChange: 2 }),
    ]);

    expect(result).toContain('<span class="up">▲2</span>');
  });

  it("rankChange 음수: ▼ 마크업이 down 클래스와 함께 표시된다", () => {
    const result = renderSectorTable([
      createMockSectorDetail({ rankChange: -3 }),
    ]);

    expect(result).toContain('<span class="down">▼3</span>');
  });

  it("rankChange 0: — 마크업이 neutral-color 클래스와 함께 표시된다", () => {
    const result = renderSectorTable([
      createMockSectorDetail({ rankChange: 0 }),
    ]);

    expect(result).toContain('<span class="neutral-color">—</span>');
  });

  it("빈 배열: 섹터 데이터 없음 메시지를 반환한다", () => {
    const result = renderSectorTable([]);

    expect(result).toContain("섹터 데이터 없음");
    expect(result).not.toContain("<table>");
  });

  it("11개 섹터 행을 모두 렌더링한다", () => {
    const sectors = Array.from({ length: 11 }, (_, i) =>
      createMockSectorDetail({ sector: `Sector${i + 1}`, rsRank: i + 1 }),
    );

    const result = renderSectorTable(sectors);

    for (let i = 1; i <= 11; i++) {
      expect(result).toContain(`Sector${i}`);
    }
  });
});

// ─── renderIndustryTop10Table ─────────────────────────────────────────────────

describe("renderIndustryTop10Table", () => {
  it("정상: 최대 10행을 렌더링한다", () => {
    const industries = Array.from({ length: 15 }, (_, i) =>
      createMockIndustryItem({ industry: `Industry${i + 1}`, rsRank: i + 1 }),
    );

    const result = renderIndustryTop10Table(industries);

    // 10개만 렌더링됨
    expect(result).toContain("Industry1");
    expect(result).toContain("Industry10");
    expect(result).not.toContain("Industry11");
  });

  it("changeWeek 양수: up 색상 클래스가 적용된다", () => {
    const result = renderIndustryTop10Table([
      createMockIndustryItem({ changeWeek: 3.5 }),
    ]);

    expect(result).toContain('class="up"');
    expect(result).toContain("+3.5");
  });

  it("changeWeek 음수: down 색상 클래스가 적용된다", () => {
    const result = renderIndustryTop10Table([
      createMockIndustryItem({ changeWeek: -2.1 }),
    ]);

    expect(result).toContain('class="down"');
    expect(result).toContain("-2.1");
  });

  it("changeWeek null: — 을 표시한다", () => {
    const result = renderIndustryTop10Table([
      createMockIndustryItem({ changeWeek: null }),
    ]);

    expect(result).toContain("—");
  });

  it("빈 배열: 업종 데이터 없음 메시지를 반환한다", () => {
    const result = renderIndustryTop10Table([]);

    expect(result).toContain("업종 데이터 없음");
    expect(result).not.toContain("<table>");
  });

  it("순위 번호가 1부터 순서대로 표시된다", () => {
    const industries = [
      createMockIndustryItem({ industry: "Semi", rsRank: 1 }),
      createMockIndustryItem({ industry: "Biotech", rsRank: 2 }),
      createMockIndustryItem({ industry: "Cloud", rsRank: 3 }),
    ];

    const result = renderIndustryTop10Table(industries);

    expect(result).toContain(">1<");
    expect(result).toContain(">2<");
    expect(result).toContain(">3<");
  });
});

// ─── renderWatchlistSection ───────────────────────────────────────────────────

describe("renderWatchlistSection", () => {
  it("정상: 종목 행 + Phase 궤적 도트 + P&L 색상을 렌더링한다", () => {
    const watchlist = createMockWatchlistStatusData();

    const result = renderWatchlistSection(watchlist);

    expect(result).toContain("NVDA");
    expect(result).toContain("trajectory-dots");
    expect(result).toContain("traj-dot");
    // pnlPercent 6.25 → toFixed(1) 반올림 → "+6.3%"
    expect(result).toContain("+6.3%");
  });

  it("빈 items: ACTIVE 관심종목 없음 메시지를 반환한다", () => {
    const watchlist = createMockWatchlistStatusData({
      summary: { totalActive: 0, phaseChanges: [], avgPnlPercent: 0 },
      items: [],
    });

    const result = renderWatchlistSection(watchlist);

    expect(result).toContain("현재 ACTIVE 관심종목 없음");
    expect(result).not.toContain("<table>");
  });

  it("pnlPercent 양수: up 클래스가 적용된다", () => {
    const watchlist = createMockWatchlistStatusData();
    watchlist.items[0].pnlPercent = 8.5;

    const result = renderWatchlistSection(watchlist);

    expect(result).toContain("+8.5%");
    // P&L 셀에 up 클래스
    expect(result).toMatch(/class="up"[^<]*>.*\+8\.5%/s);
  });

  it("pnlPercent 음수: down 클래스가 적용된다", () => {
    const watchlist = createMockWatchlistStatusData();
    watchlist.items[0].pnlPercent = -3.2;

    const result = renderWatchlistSection(watchlist);

    expect(result).toContain("-3.2%");
  });

  it("phaseTrajectory 7개 이상: 최근 7개만 표시된다", () => {
    const longTrajectory = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-03-${String(i + 1).padStart(2, "0")}`,
      phase: 2,
      rsScore: 80 + i,
    }));

    const watchlist = createMockWatchlistStatusData();
    watchlist.items[0].phaseTrajectory = longTrajectory;

    const result = renderWatchlistSection(watchlist);

    const dotCount = (result.match(/class="traj-dot/g) ?? []).length;
    expect(dotCount).toBe(7);
  });

  it("평균 P&L이 필터링된 S/A 항목 기준으로 재계산된다", () => {
    const baseItem = createMockWatchlistStatusData().items[0]; // grade "A", pnl 6.25
    const sItem = { ...baseItem, symbol: "AAPL", entrySepaGrade: "S" as const, pnlPercent: 10.0 };
    const watchlist = createMockWatchlistStatusData({
      summary: { totalActive: 3, phaseChanges: [], avgPnlPercent: 99.9 },
      items: [baseItem, sItem],
    });

    const result = renderWatchlistSection(watchlist);

    // (6.25 + 10.0) / 2 = 8.125 → "+8.1%"
    expect(result).toContain("+8.1%");
    // 원본 summary 값(99.9%)이 아닌 재계산 값이어야 한다
    expect(result).not.toContain("99.9%");
  });

  it("B/C/F 등급 종목은 렌더링에서 제외된다", () => {
    const baseItem = createMockWatchlistStatusData().items[0]; // grade "A"
    const bItem = { ...baseItem, symbol: "INTC", entrySepaGrade: "B" as const };
    const cItem = { ...baseItem, symbol: "AMD", entrySepaGrade: "C" as const };
    const fItem = { ...baseItem, symbol: "TSLA", entrySepaGrade: "F" as const };
    const watchlist = createMockWatchlistStatusData({
      items: [baseItem, bItem, cItem, fItem],
    });

    const result = renderWatchlistSection(watchlist);

    expect(result).toContain("NVDA"); // A 등급 — 포함
    expect(result).not.toContain("INTC"); // B 등급 — 제외
    expect(result).not.toContain("AMD"); // C 등급 — 제외
    expect(result).not.toContain("TSLA"); // F 등급 — 제외
  });

  it("entrySepaGrade가 null인 종목은 렌더링에서 제외된다", () => {
    const baseItem = createMockWatchlistStatusData().items[0]; // grade "A"
    const nullItem = { ...baseItem, symbol: "UNKNOWN", entrySepaGrade: null };
    const watchlist = createMockWatchlistStatusData({
      items: [baseItem, nullItem],
    });

    const result = renderWatchlistSection(watchlist);

    expect(result).toContain("NVDA");
    expect(result).not.toContain("UNKNOWN");
  });

  it("S 등급 종목이 렌더링에 포함된다", () => {
    const baseItem = createMockWatchlistStatusData().items[0];
    const sItem = { ...baseItem, symbol: "MSFT", entrySepaGrade: "S" as const };
    const watchlist = createMockWatchlistStatusData({
      items: [sItem],
    });

    const result = renderWatchlistSection(watchlist);

    expect(result).toContain("MSFT");
    expect(result).toContain("<table>");
  });

  it("S/A 종목이 0건이면 빈 상태 메시지를 반환한다", () => {
    const baseItem = createMockWatchlistStatusData().items[0];
    const bItem = { ...baseItem, symbol: "INTC", entrySepaGrade: "B" as const };
    const watchlist = createMockWatchlistStatusData({
      items: [bItem],
    });

    const result = renderWatchlistSection(watchlist);

    expect(result).toContain("현재 ACTIVE 관심종목 없음");
    expect(result).not.toContain("<table>");
  });

  it("ACTIVE 종목 수가 필터링된 S/A 항목 수로 표시된다", () => {
    const baseItem = createMockWatchlistStatusData().items[0]; // grade "A"
    const sItem = { ...baseItem, symbol: "AAPL", entrySepaGrade: "S" as const };
    const bItem = { ...baseItem, symbol: "INTC", entrySepaGrade: "B" as const };
    const watchlist = createMockWatchlistStatusData({
      summary: { totalActive: 3, phaseChanges: [], avgPnlPercent: 0 },
      items: [baseItem, sItem, bItem],
    });

    const result = renderWatchlistSection(watchlist);

    // S/A만 2건 → "2"가 종목 수 칩에 표시
    expect(result).toMatch(/ACTIVE 종목 수 \(S\/A\).*?<span class="stat-value">2<\/span>/s);
  });
});

// ─── renderWatchlistChanges ───────────────────────────────────────────────────

describe("renderWatchlistChanges", () => {
  it("빈 케이스: 모두 비어 있으면 포트폴리오 변동 없음 메시지를 반환한다", () => {
    const result = renderWatchlistChanges({
      registered: [],
      exited: [],
    });

    expect(result).toContain("이번 주 포트폴리오 변동 없음");
    expect(result).not.toContain("gate5-card");
  });

  it("편입 1건: 카드가 렌더링되고 5/5 게이트 충족 배지가 표시된다", () => {
    const result = renderWatchlistChanges({
      registered: [{ symbol: "NVDA", action: "register", reason: "Phase 2 진입 + thesis 연결" }],
      exited: [],
    });

    expect(result).toContain("NVDA");
    expect(result).toContain("신규 편입 (1종목)");
    expect(result).toContain("5/5 게이트 충족");
    expect(result).toContain("Phase 2 진입 + thesis 연결");
  });

  it("탈락 1건: 탈락 사유가 표시된다", () => {
    const result = renderWatchlistChanges({
      registered: [],
      exited: [{ symbol: "AAPL", action: "exit", reason: "Phase 3 진입으로 탈락" }],
    });

    expect(result).toContain("AAPL");
    expect(result).toContain("탈락 (1종목)");
    expect(result).toContain("Phase 3 진입으로 탈락");
  });

  it("편입 종목이 있으면 symbol과 reason이 렌더링된다", () => {
    const result = renderWatchlistChanges({
      registered: [{
        symbol: "TSLA",
        action: "register",
        reason: "5중 게이트 통과",
      }],
      exited: [],
    });

    expect(result).toContain("TSLA");
    expect(result).toContain("5중 게이트 통과");
    expect(result).toContain("5/5 게이트 충족");
  });
});

// ─── buildWeeklyHtml ──────────────────────────────────────────────────────────

describe("buildWeeklyHtml", () => {
  it("전체 조립: <!DOCTYPE html>로 시작하고 주요 섹션이 모두 포함된다", () => {
    const data = createMockWeeklyReportData();
    const insight = createMockWeeklyReportInsight();

    const result = buildWeeklyHtml(data, insight, "2026-04-04");

    expect(result).toMatch(/^<!DOCTYPE html>/);
    expect(result).toContain("시장 브레드스");
    expect(result).toContain("섹터 로테이션");
    expect(result).toContain("업종 RS");
    expect(result).toContain("관심종목");
    expect(result).toContain("포트폴리오 편입/탈락");
  });

  it("온도 배지 bullish: bullish 클래스가 적용된다", () => {
    const data = createMockWeeklyReportData();
    const insight = createMockWeeklyReportInsight({
      marketTemperature: "bullish",
      marketTemperatureLabel: "강세 — 적극 매수",
    });

    const result = buildWeeklyHtml(data, insight, "2026-04-04");

    expect(result).toContain('class="temp-badge bullish"');
    expect(result).toContain("강세 — 적극 매수");
  });

  it("온도 배지 neutral: neutral 클래스가 적용된다", () => {
    const data = createMockWeeklyReportData();
    const insight = createMockWeeklyReportInsight({ marketTemperature: "neutral" });

    const result = buildWeeklyHtml(data, insight, "2026-04-04");

    expect(result).toContain('class="temp-badge neutral"');
  });

  it("온도 배지 bearish: bearish 클래스가 적용된다", () => {
    const data = createMockWeeklyReportData();
    const insight = createMockWeeklyReportInsight({
      marketTemperature: "bearish",
      marketTemperatureLabel: "약세 — 현금 비중 확대",
    });

    const result = buildWeeklyHtml(data, insight, "2026-04-04");

    expect(result).toContain('class="temp-badge bearish"');
  });

  it("XSS: watchlistChanges 종목명에 포함된 HTML 특수문자가 이스케이프된다", () => {
    const data = createMockWeeklyReportData({
      watchlistChanges: {
        registered: [{ symbol: '<script>alert(1)</script>', action: "register", reason: "test" }],
        exited: [],
      },
    });
    const insight = createMockWeeklyReportInsight();

    const result = buildWeeklyHtml(data, insight, "2026-04-04");

    expect(result).not.toContain("<script>alert(1)</script>");
    expect(result).toContain("&lt;script&gt;");
  });

  it("날짜 포맷: M/D ~ M/D 형식으로 표시된다", () => {
    const data = createMockWeeklyReportData();
    const insight = createMockWeeklyReportInsight();

    // 2026-04-04 (금) → 시작일 2026-03-31 (월), 4/4 ~ 3/31 → 3/31 ~ 4/4
    const result = buildWeeklyHtml(data, insight, "2026-04-04");

    expect(result).toContain("3/31 ~ 4/4");
  });

  it("날짜 UTC off-by-one: 2026-04-04 입력 시 4/4로 표시된다 (3/4 하루 밀림 없음)", () => {
    const data = createMockWeeklyReportData();
    const insight = createMockWeeklyReportInsight();

    const result = buildWeeklyHtml(data, insight, "2026-04-04");

    // new Date("2026-04-04")가 UTC 자정 → KST에서 getDate() → 3 이 되는 버그를 방지
    expect(result).toContain("4/4");
    expect(result).not.toMatch(/3\/31 ~ 4\/3/);
  });

  it("날짜 UTC off-by-one: 월 경계(2026-02-01) 입력 시 2/1로 표시된다", () => {
    const data = createMockWeeklyReportData();
    const insight = createMockWeeklyReportInsight();

    const result = buildWeeklyHtml(data, insight, "2026-02-01");

    expect(result).toContain("2/1");
    // 하루 밀림 버그라면 1/31이 됨
    expect(result).not.toMatch(/weekEnd.*1\/31/);
  });

  it("XSS: javascript: 링크가 # 으로 치환된다", () => {
    const data = createMockWeeklyReportData();
    const insight = createMockWeeklyReportInsight({
      sectorRotationNarrative: "[클릭](javascript:alert(1))",
    });

    const result = buildWeeklyHtml(data, insight, "2026-04-04");

    expect(result).not.toContain("javascript:");
    expect(result).toContain('href="#"');
  });

  it("XSS: data: 링크가 # 으로 치환된다", () => {
    const data = createMockWeeklyReportData();
    const insight = createMockWeeklyReportInsight({
      industryFlowNarrative: "[이미지](data:text/html,<script>alert(1)</script>)",
    });

    const result = buildWeeklyHtml(data, insight, "2026-04-04");

    expect(result).not.toContain("data:text/html");
    expect(result).toContain('href="#"');
  });

  it("XSS: 일반 https 링크는 그대로 유지된다", () => {
    const data = createMockWeeklyReportData();
    const insight = createMockWeeklyReportInsight({
      riskFactors: "[참고](https://example.com)",
    });

    const result = buildWeeklyHtml(data, insight, "2026-04-04");

    expect(result).toContain('href="https://example.com"');
  });

  it("인라인 <style> 블록이 포함된다 (외부 CSS 의존 없음)", () => {
    const data = createMockWeeklyReportData();
    const insight = createMockWeeklyReportInsight();

    const result = buildWeeklyHtml(data, insight, "2026-04-04");

    expect(result).toContain("<style>");
    expect(result).not.toContain('<link rel="stylesheet"');
  });

  it("footer에 Generated by Market Analyst가 포함된다", () => {
    const data = createMockWeeklyReportData();
    const insight = createMockWeeklyReportInsight();

    const result = buildWeeklyHtml(data, insight, "2026-04-04");

    expect(result).toContain("Generated by Market Analyst");
    expect(result).toContain("2026-04-04");
  });

  it("섹터 이름에 특수문자가 있을 때 이스케이프된다", () => {
    const data = createMockWeeklyReportData({
      sectorRanking: [
        createMockSectorDetail({ sector: 'Tech & "AI"' }),
      ],
    });
    const insight = createMockWeeklyReportInsight();

    const result = buildWeeklyHtml(data, insight, "2026-04-04");

    expect(result).toContain("Tech &amp; &quot;AI&quot;");
    expect(result).not.toContain('Tech & "AI"');
  });
});

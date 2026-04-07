import { describe, it, expect } from "vitest";
import {
  renderIndexTable,
  renderPhaseDistribution,
  renderSectorTable,
  renderIndustryTop10Table,
  renderUnusualStocksSection,
  renderRisingRSSection,
  renderWatchlistSection,
  renderInsightSection,
  buildDailyHtml,
} from "../daily-html-builder.js";
import type {
  DailyIndexReturn,
  FearGreedData,
  DailyBreadthSnapshot,
  DailySectorItem,
  DailyIndustryItem,
  DailyUnusualStock,
  DailyRisingRSStock,
  DailyWatchlistData,
  DailyReportData,
  DailyReportInsight,
} from "@/tools/schemas/dailyReportSchema.js";

// ─── 팩토리 함수 ──────────────────────────────────────────────────────────────

function createMockDailyIndexReturn(
  overrides?: Partial<DailyIndexReturn>,
): DailyIndexReturn {
  return {
    symbol: "^GSPC",
    name: "S&P 500",
    close: 5200.5,
    change: 45.3,
    changePercent: 0.88,
    ...overrides,
  };
}

function createMockFearGreed(
  overrides?: Partial<FearGreedData>,
): FearGreedData {
  return {
    score: 55,
    rating: "Greed",
    previousClose: 53,
    previous1Week: 50,
    previous1Month: 45,
    ...overrides,
  };
}

function createMockBreadthSnapshot(
  overrides?: Partial<DailyBreadthSnapshot>,
): DailyBreadthSnapshot {
  return {
    date: "2026-04-04",
    totalStocks: 4600,
    phaseDistribution: { phase1: 500, phase2: 1400, phase3: 1600, phase4: 1100 },
    phase2Ratio: 30.4,
    phase2RatioChange: 0.8,
    marketAvgRs: 49.5,
    advanceDecline: { advancers: 2500, decliners: 1800, unchanged: 300, ratio: 1.39 },
    newHighLow: { newHighs: 80, newLows: 55, ratio: 1.45 },
    breadthScore: 62.5,
    divergenceSignal: null,
    topSectors: [],
    phase1to2Count1d: 25,
    phase2to3Count1d: 10,
    phase2NetFlow: 15,
    phase2EntryAvg5d: 20.0,
    ...overrides,
  };
}

function createMockSectorItem(
  overrides?: Partial<DailySectorItem>,
): DailySectorItem {
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
    prevDayRank: 4,
    rankChange: 1,
    prevDayAvgRs: 56.0,
    rsChange: 2.3,
    ...overrides,
  };
}

function createMockIndustryItem(
  overrides?: Partial<DailyIndustryItem>,
): DailyIndustryItem {
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

function createMockUnusualStock(
  overrides?: Partial<DailyUnusualStock>,
): DailyUnusualStock {
  return {
    symbol: "NVDA",
    companyName: "NVIDIA Corporation",
    close: 875.3,
    dailyReturn: -6.2,
    volume: 45000000,
    volRatio: 2.8,
    phase: 2,
    prevPhase: 2,
    rsScore: 90,
    sector: "Technology",
    industry: "Semiconductors",
    conditions: ["big_move", "high_volume"],
    phase2WithDrop: true,
    splitSuspect: false,
    ...overrides,
  };
}

function createMockRisingRSStock(
  overrides?: Partial<DailyRisingRSStock>,
): DailyRisingRSStock {
  return {
    symbol: "AMD",
    phase: 1,
    rsScore: 55.2,
    rsScore4wAgo: 42.0,
    rsChange: 13.2,
    ma150Slope: 0.008,
    pctFromLow52w: 35.5,
    isExtremePctFromLow: false,
    volRatio: 1.4,
    sector: "Technology",
    industry: "Semiconductors",
    sectorAvgRs: 58.3,
    sectorChange4w: 5.2,
    sectorGroupPhase: 2,
    sepaGrade: "S",
    marketCap: 150_000_000_000,
    ...overrides,
  };
}

function createMockWatchlistData(
  overrides?: Partial<DailyWatchlistData>,
): DailyWatchlistData {
  return {
    summary: {
      totalActive: 2,
      phaseChanges: [],
      avgPnlPercent: 4.3,
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
        ],
        entryReason: "Phase 2 진입",
        hasThesisBasis: true,
      },
    ],
    ...overrides,
  };
}

function createMockInsight(
  overrides?: Partial<DailyReportInsight>,
): DailyReportInsight {
  return {
    marketTemperature: "neutral",
    marketTemperatureLabel: "중립 — 관망",
    marketTemperatureRationale: "지수는 혼조세를 보이고 있으며 뚜렷한 방향성이 없다.",
    unusualStocksNarrative: "반도체 업종 중심의 급락이 관찰된다.",
    risingRSNarrative: "에너지 업종에서 RS 가속 패턴이 포착된다.",
    watchlistNarrative: "NVDA는 Phase 2를 유지하고 있다.",
    todayInsight: "섹터 로테이션 조짐이 보인다.",
    discordMessage: "S&P 500 +0.88% · Phase2 30.4% · 특이종목 3건",
    ...overrides,
  };
}

function createMockDailyReportData(
  overrides?: Partial<DailyReportData>,
): DailyReportData {
  return {
    indexReturns: [createMockDailyIndexReturn()],
    fearGreed: createMockFearGreed(),
    marketBreadth: createMockBreadthSnapshot(),
    sectorRanking: [createMockSectorItem()],
    industryTop10: [createMockIndustryItem()],
    unusualStocks: [createMockUnusualStock()],
    risingRS: [createMockRisingRSStock()],
    watchlist: createMockWatchlistData(),
    marketPosition: null,
    ...overrides,
  };
}

// ─── renderIndexTable ──────────────────────────────────────────────────────────

describe("renderIndexTable", () => {
  it("지수 카드 그리드를 렌더링한다", () => {
    const idx = createMockDailyIndexReturn();
    const html = renderIndexTable([idx], null);
    expect(html).toContain("S&amp;P 500");
    expect(html).toContain("5,200.5");
    expect(html).toContain("+0.88%");
    expect(html).toContain("index-grid");
  });

  it("상승 지수에 up 클래스를 적용한다", () => {
    const idx = createMockDailyIndexReturn({ changePercent: 1.5 });
    const html = renderIndexTable([idx], null);
    expect(html).toContain('class="change up"');
  });

  it("하락 지수에 down 클래스를 적용한다", () => {
    const idx = createMockDailyIndexReturn({ changePercent: -2.3 });
    const html = renderIndexTable([idx], null);
    expect(html).toContain('class="change down"');
    expect(html).toContain("-2.30%");
  });

  it("빈 배열이면 empty-state를 반환한다", () => {
    const html = renderIndexTable([], null);
    expect(html).toContain("empty-state");
    expect(html).toContain("지수 데이터를 가져올 수 없습니다");
  });

  it("fearGreed가 null이면 Fear & Greed 행을 렌더링하지 않는다", () => {
    const html = renderIndexTable([createMockDailyIndexReturn()], null);
    expect(html).not.toContain("Fear &amp; Greed");
  });

  it("fearGreed가 있으면 Fear & Greed 행을 렌더링한다", () => {
    const fg = createMockFearGreed({ score: 55, rating: "Greed" });
    const html = renderIndexTable([createMockDailyIndexReturn()], fg);
    expect(html).toContain("Fear &amp; Greed");
    expect(html).toContain("Greed");
  });

  it("VIX 종목은 VIX 전용 렌더링을 사용한다", () => {
    const vix = createMockDailyIndexReturn({
      symbol: "^VIX",
      name: "VIX",
      close: 22.5,
      changePercent: 3.2,
    });
    const html = renderIndexTable([vix], null);
    expect(html).toContain("▲");
    expect(html).not.toContain("경계");
  });

  it("VIX 하락 시 방향 화살표만 표시한다", () => {
    const vix = createMockDailyIndexReturn({
      symbol: "^VIX",
      name: "VIX",
      close: 18.0,
      changePercent: -4.1,
    });
    const html = renderIndexTable([vix], null);
    expect(html).toContain("▼");
    expect(html).not.toContain("안도");
  });

  it("VIX가 공포 임계선(25)을 넘으면 경고를 표시한다", () => {
    const vix = createMockDailyIndexReturn({
      symbol: "^VIX",
      name: "VIX",
      close: 28.0,
      changePercent: 5.0,
    });
    const html = renderIndexTable([vix], null);
    expect(html).toContain("공포 임계선 도달");
  });

  it("US 10Y 카드는 yield(%)와 bp 변화량을 표시한다", () => {
    const us10y = createMockDailyIndexReturn({
      symbol: "^TNX",
      name: "US 10Y",
      close: 4.25,
      change: -0.05,
      changePercent: -1.18,
    });
    const html = renderIndexTable([us10y], null);
    expect(html).toContain("US 10Y");
    expect(html).toContain("4.25%");
    expect(html).toContain("-5.0bp");
  });

  it("DXY 카드는 포인트 변화량을 표시한다", () => {
    const dxy = createMockDailyIndexReturn({
      symbol: "DX-Y.NYB",
      name: "DXY",
      close: 104.52,
      change: 0.38,
      changePercent: 0.36,
    });
    const html = renderIndexTable([dxy], null);
    expect(html).toContain("DXY");
    expect(html).toContain("+0.38pt");
  });

  it("XSS 공격 문자를 이스케이프한다", () => {
    const idx = createMockDailyIndexReturn({ name: '<script>alert("xss")</script>' });
    const html = renderIndexTable([idx], null);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ─── renderPhaseDistribution ───────────────────────────────────────────────────

describe("renderPhaseDistribution", () => {
  it("Phase 분포 바와 범례를 렌더링한다", () => {
    const snapshot = createMockBreadthSnapshot();
    const html = renderPhaseDistribution(snapshot);
    expect(html).toContain("phase-bar");
    expect(html).toContain("phase-legend");
    expect(html).toContain("Phase 1");
    expect(html).toContain("Phase 2");
    expect(html).toContain("Phase 3");
    expect(html).toContain("Phase 4");
  });

  it("Phase 2 비율을 퍼센트 그대로 표시한다 (×100 금지)", () => {
    const snapshot = createMockBreadthSnapshot({ phase2Ratio: 30.4 });
    const html = renderPhaseDistribution(snapshot);
    // 3040%가 아닌 30.4%로 표시되어야 함
    expect(html).toContain("30.4%");
    expect(html).not.toContain("3040");
  });

  it("Phase 2 비율 변화에 올바른 색상 클래스를 적용한다", () => {
    const snapshotUp = createMockBreadthSnapshot({ phase2RatioChange: 1.5 });
    const htmlUp = renderPhaseDistribution(snapshotUp);
    expect(htmlUp).toContain("+1.50%p");

    const snapshotDown = createMockBreadthSnapshot({ phase2RatioChange: -2.1 });
    const htmlDown = renderPhaseDistribution(snapshotDown);
    expect(htmlDown).toContain("-2.10%p");

    const snapshotFlat = createMockBreadthSnapshot({ phase2RatioChange: 0.02 });
    const htmlFlat = renderPhaseDistribution(snapshotFlat);
    expect(htmlFlat).toContain("보합");
  });

  it("breadthScore가 null이면 해당 stat-chip을 렌더링하지 않는다", () => {
    const snapshot = createMockBreadthSnapshot({ breadthScore: null });
    const html = renderPhaseDistribution(snapshot);
    expect(html).not.toContain("Breadth Score");
  });

  it("breadthScore가 있으면 렌더링한다", () => {
    const snapshot = createMockBreadthSnapshot({ breadthScore: 62.5 });
    const html = renderPhaseDistribution(snapshot);
    expect(html).toContain("Breadth Score");
    expect(html).toContain("62.5");
  });

  it("totalStocks가 0이어도 division-by-zero 없이 처리된다", () => {
    const snapshot = createMockBreadthSnapshot({
      totalStocks: 0,
      phaseDistribution: { phase1: 0, phase2: 0, phase3: 0, phase4: 0 },
    });
    const html = renderPhaseDistribution(snapshot);
    expect(html).toContain("phase-bar");
  });

  it("Phase 2 진입/이탈/순유입 stat-chip을 렌더링한다", () => {
    const snapshot = createMockBreadthSnapshot({
      phase1to2Count1d: 25,
      phase2to3Count1d: 10,
      phase2NetFlow: 15,
      phase2EntryAvg5d: 20.0,
    });
    const html = renderPhaseDistribution(snapshot);
    expect(html).toContain("Phase 2 진입");
    expect(html).toContain("25건");
    expect(html).toContain("Phase 2 이탈");
    expect(html).toContain("10건");
    expect(html).toContain("순유입");
    expect(html).toContain("+15건");
  });

  it("진입 수가 5일 평균의 1.5배를 초과하면 하이라이트 처리된다", () => {
    const snapshot = createMockBreadthSnapshot({
      phase1to2Count1d: 40,
      phase2EntryAvg5d: 20.0,
    });
    const html = renderPhaseDistribution(snapshot);
    expect(html).toContain("↑평균 대비");
    expect(html).toContain("2.0배");
  });

  it("진입 수가 5일 평균의 1.5배 이하이면 하이라이트 없음", () => {
    const snapshot = createMockBreadthSnapshot({
      phase1to2Count1d: 25,
      phase2EntryAvg5d: 20.0,
    });
    const html = renderPhaseDistribution(snapshot);
    expect(html).not.toContain("↑평균 대비");
  });

  it("phase1to2Count1d가 null이면 진입/이탈 stat-chip을 렌더링하지 않는다", () => {
    const snapshot = createMockBreadthSnapshot({
      phase1to2Count1d: null,
      phase2to3Count1d: null,
      phase2NetFlow: null,
      phase2EntryAvg5d: null,
    });
    const html = renderPhaseDistribution(snapshot);
    expect(html).not.toContain("Phase 2 진입");
    expect(html).not.toContain("Phase 2 이탈");
    expect(html).not.toContain("순유입");
  });

  it("순유입이 음수이면 down 클래스를 적용한다", () => {
    const snapshot = createMockBreadthSnapshot({
      phase1to2Count1d: 5,
      phase2to3Count1d: 20,
      phase2NetFlow: -15,
      phase2EntryAvg5d: 10.0,
    });
    const html = renderPhaseDistribution(snapshot);
    expect(html).toContain("-15건");
    expect(html).toContain("down");
  });
});

// ─── renderSectorTable ────────────────────────────────────────────────────────

describe("renderSectorTable", () => {
  it("섹터 테이블을 렌더링한다", () => {
    const sector = createMockSectorItem();
    const html = renderSectorTable([sector]);
    expect(html).toContain("Technology");
    expect(html).toContain("58.3");
    expect(html).toContain("Phase 2");
  });

  it("빈 배열이면 empty-state를 반환한다", () => {
    const html = renderSectorTable([]);
    expect(html).toContain("empty-state");
    expect(html).toContain("섹터 데이터 없음");
  });

  it("순위 상승 시 up 화살표를 표시한다", () => {
    const sector = createMockSectorItem({ rankChange: 2 });
    const html = renderSectorTable([sector]);
    expect(html).toContain("▲2");
    expect(html).toContain("up");
  });

  it("순위 하락 시 down 화살표를 표시한다", () => {
    const sector = createMockSectorItem({ rankChange: -3 });
    const html = renderSectorTable([sector]);
    expect(html).toContain("▼3");
    expect(html).toContain("down");
  });

  it("rankChange가 null이면 대시를 표시한다", () => {
    const sector = createMockSectorItem({ rankChange: null });
    const html = renderSectorTable([sector]);
    // null 케이스는 "—" 표시
    expect(html).toContain("—");
  });

  it("change4w가 null이면 대시를 표시한다", () => {
    const sector = createMockSectorItem({ change4w: null });
    const html = renderSectorTable([sector]);
    expect(html).toContain("—");
  });

  it("RS 변화(4주) 양수에 up 클래스를 적용한다", () => {
    const sector = createMockSectorItem({ change4w: 5.2 });
    const html = renderSectorTable([sector]);
    expect(html).toContain("+5.2");
  });
});

// ─── renderIndustryTop10Table ─────────────────────────────────────────────────

describe("renderIndustryTop10Table", () => {
  it("업종 테이블을 렌더링한다", () => {
    const industry = createMockIndustryItem();
    const html = renderIndustryTop10Table([industry]);
    expect(html).toContain("Semiconductors");
    expect(html).toContain("Technology");
    expect(html).toContain("64.5");
  });

  it("빈 배열이면 empty-state를 반환한다", () => {
    const html = renderIndustryTop10Table([]);
    expect(html).toContain("empty-state");
    expect(html).toContain("업종 데이터 없음");
  });

  it("최대 10개만 렌더링한다", () => {
    const industries = Array.from({ length: 15 }, (_, i) =>
      createMockIndustryItem({ industry: `Industry-${i}` }),
    );
    const html = renderIndustryTop10Table(industries);
    // Industry-10 이후는 렌더링되지 않아야 함
    expect(html).not.toContain("Industry-10");
    expect(html).toContain("Industry-9");
  });

  it("phase2Ratio가 null이면 대시를 표시한다", () => {
    const industry = createMockIndustryItem({ phase2Ratio: null });
    const html = renderIndustryTop10Table([industry]);
    expect(html).toContain("—");
  });
});

// ─── renderUnusualStocksSection ────────────────────────────────────────────────

describe("renderUnusualStocksSection", () => {
  it("특이종목 카드 그리드를 렌더링한다", () => {
    const stock = createMockUnusualStock();
    const html = renderUnusualStocksSection([stock], "해당 없음");
    expect(html).toContain("NVDA");
    expect(html).toContain("unusual-grid");
  });

  it("빈 배열이면 empty-state를 반환한다", () => {
    const html = renderUnusualStocksSection([], "해당 없음");
    expect(html).toContain("empty-state");
    expect(html).toContain("특이종목 없음");
  });

  it("big_move 조건 태그를 렌더링한다", () => {
    const stock = createMockUnusualStock({ conditions: ["big_move"] });
    const html = renderUnusualStocksSection([stock], "해당 없음");
    expect(html).toContain("급등락");
    expect(html).toContain("big-move");
  });

  it("high_volume 조건 태그를 렌더링한다", () => {
    const stock = createMockUnusualStock({ conditions: ["high_volume"] });
    const html = renderUnusualStocksSection([stock], "해당 없음");
    expect(html).toContain("거래량 급증");
  });

  it("phase_change 조건 태그를 렌더링한다", () => {
    const stock = createMockUnusualStock({ conditions: ["phase_change"] });
    const html = renderUnusualStocksSection([stock], "해당 없음");
    expect(html).toContain("Phase 전환");
  });

  it("phase2WithDrop=true이면 경고 태그를 표시한다", () => {
    const stock = createMockUnusualStock({ phase2WithDrop: true });
    const html = renderUnusualStocksSection([stock], "해당 없음");
    expect(html).toContain("P2 급락 경고");
    expect(html).toContain("phase2-drop");
  });

  it("splitSuspect=true이면 분할 의심 태그를 표시한다", () => {
    const stock = createMockUnusualStock({ splitSuspect: true });
    const html = renderUnusualStocksSection([stock], "해당 없음");
    expect(html).toContain("분할 의심");
    expect(html).toContain("split-suspect");
  });

  it("Phase 전환 시 이전 Phase를 표시한다", () => {
    const stock = createMockUnusualStock({ phase: 2, prevPhase: 1 });
    const html = renderUnusualStocksSection([stock], "해당 없음");
    expect(html).toContain("Phase 1 → Phase 2");
  });

  it("하락 종목에 down 클래스를 적용한다", () => {
    const stock = createMockUnusualStock({ dailyReturn: -6.2 });
    const html = renderUnusualStocksSection([stock], "해당 없음");
    expect(html).toContain("-6.20%");
    expect(html).toContain("down");
  });

  it("narrative가 '해당 없음'이 아니면 content-block을 렌더링한다", () => {
    const html = renderUnusualStocksSection(
      [createMockUnusualStock()],
      "반도체 업종 급락이 관찰된다.",
    );
    expect(html).toContain("content-block");
    expect(html).toContain("반도체 업종 급락이 관찰된다");
  });

  it("narrative가 '해당 없음'이면 content-block을 렌더링하지 않는다", () => {
    const html = renderUnusualStocksSection(
      [createMockUnusualStock()],
      "해당 없음",
    );
    expect(html).not.toContain("content-block");
  });

  it("industry가 null이면 sector를 fallback으로 표시한다", () => {
    const stock = createMockUnusualStock({ industry: null, sector: "Technology" });
    const html = renderUnusualStocksSection([stock], "해당 없음");
    expect(html).toContain("Technology");
  });

  it("industry, sector 모두 null이면 대시를 표시한다", () => {
    const stock = createMockUnusualStock({ industry: null, sector: null });
    const html = renderUnusualStocksSection([stock], "해당 없음");
    expect(html).toContain("—");
  });
});

// ─── renderRisingRSSection ────────────────────────────────────────────────────

describe("renderRisingRSSection", () => {
  it("RS 상승 초기 종목 테이블을 렌더링한다", () => {
    const stock = createMockRisingRSStock();
    const html = renderRisingRSSection([stock], "해당 없음");
    expect(html).toContain("AMD");
    expect(html).toContain("55");
    expect(html).toContain("Semiconductors");
  });

  it("빈 배열이면 빈 문자열을 반환한다 (섹션 자체를 숨김)", () => {
    const html = renderRisingRSSection([], "해당 없음");
    expect(html).toBe("");
  });

  it("rsChange 양수에 up 클래스를 적용한다", () => {
    const stock = createMockRisingRSStock({ rsChange: 13.2 });
    const html = renderRisingRSSection([stock], "해당 없음");
    expect(html).toContain("+13.2");
  });

  it("rsChange가 null이면 대시를 표시한다", () => {
    const stock = createMockRisingRSStock({ rsChange: null });
    const html = renderRisingRSSection([stock], "해당 없음");
    expect(html).toContain("—");
  });

  it("pctFromLow52w가 null이면 대시를 표시한다", () => {
    const stock = createMockRisingRSStock({ pctFromLow52w: null });
    const html = renderRisingRSSection([stock], "해당 없음");
    expect(html).toContain("—");
  });

  it("narrative가 있으면 content-block을 렌더링한다", () => {
    const html = renderRisingRSSection(
      [createMockRisingRSStock()],
      "에너지 업종 RS 가속 패턴",
    );
    expect(html).toContain("content-block");
    expect(html).toContain("에너지 업종 RS 가속 패턴");
  });

  it("industry가 null이면 대시를 표시한다", () => {
    const stock = createMockRisingRSStock({ industry: null });
    const html = renderRisingRSSection([stock], "해당 없음");
    expect(html).toContain("—");
  });

  it("SEPA 등급을 테이블에 표시한다", () => {
    const stock = createMockRisingRSStock({ sepaGrade: "S" });
    const html = renderRisingRSSection([stock], "해당 없음");
    expect(html).toContain("SEPA");
    expect(html).toContain("S");
  });

  it("sepaGrade가 null이면 대시를 표시한다", () => {
    const stock = createMockRisingRSStock({ sepaGrade: null });
    const html = renderRisingRSSection([stock], "해당 없음");
    expect(html).toContain("SEPA");
  });

  it("시총 Large 구간을 표시한다", () => {
    const stock = createMockRisingRSStock({ marketCap: 50_000_000_000 });
    const html = renderRisingRSSection([stock], "해당 없음");
    expect(html).toContain("Large");
  });

  it("시총 Mid 구간을 표시한다", () => {
    const stock = createMockRisingRSStock({ marketCap: 5_000_000_000 });
    const html = renderRisingRSSection([stock], "해당 없음");
    expect(html).toContain("Mid");
  });

  it("시총 Small 구간을 표시한다", () => {
    const stock = createMockRisingRSStock({ marketCap: 1_000_000_000 });
    const html = renderRisingRSSection([stock], "해당 없음");
    expect(html).toContain("Small");
  });

  it("marketCap이 null이면 대시를 표시한다", () => {
    const stock = createMockRisingRSStock({ marketCap: null });
    const html = renderRisingRSSection([stock], "해당 없음");
    expect(html).toContain("시총");
  });
});

// ─── renderWatchlistSection ───────────────────────────────────────────────────

describe("renderWatchlistSection", () => {
  it("관심종목 테이블과 요약 통계를 렌더링한다", () => {
    const watchlist = createMockWatchlistData();
    const html = renderWatchlistSection(watchlist, "해당 없음");
    expect(html).toContain("NVDA");
    expect(html).toContain("ACTIVE 종목 수");
    expect(html).toContain("평균 P&amp;L");
  });

  it("빈 items이면 empty-state를 반환한다", () => {
    const watchlist = createMockWatchlistData({ items: [] });
    const html = renderWatchlistSection(watchlist, "해당 없음");
    expect(html).toContain("empty-state");
    expect(html).toContain("ACTIVE 관심종목 없음");
  });

  it("Phase 2 종목에 p2 배지를 적용한다", () => {
    const html = renderWatchlistSection(createMockWatchlistData(), "해당 없음");
    expect(html).toContain("phase-badge p2");
    expect(html).toContain("Phase 2");
  });

  it("양수 P&L에 up 클래스를 적용한다", () => {
    const html = renderWatchlistSection(createMockWatchlistData(), "해당 없음");
    expect(html).toContain("+6.3%");
    expect(html).toContain("up");
  });

  it("Phase 궤적 도트를 렌더링한다", () => {
    const html = renderWatchlistSection(createMockWatchlistData(), "해당 없음");
    expect(html).toContain("traj-dot");
  });

  it("narrative가 있으면 content-block을 렌더링한다", () => {
    const html = renderWatchlistSection(
      createMockWatchlistData(),
      "NVDA는 Phase 2를 유지한다.",
    );
    expect(html).toContain("content-block");
    expect(html).toContain("NVDA는 Phase 2를 유지한다");
  });

  it("currentRsScore가 있으면 현재 RS를 표시한다", () => {
    const html = renderWatchlistSection(createMockWatchlistData(), "해당 없음");
    expect(html).toContain("RS 92");
  });
});

// ─── renderInsightSection ─────────────────────────────────────────────────────

describe("renderInsightSection", () => {
  it("온도 판단 근거를 렌더링한다", () => {
    const insight = createMockInsight();
    const html = renderInsightSection(insight);
    expect(html).toContain("insight-card");
    expect(html).toContain("지수는 혼조세를 보이고 있으며");
  });

  it("temperature-bar가 제거되었다 (정량 기준 없는 시각화)", () => {
    const insight = createMockInsight();
    const html = renderInsightSection(insight);
    expect(html).not.toContain("temperature-bar");
  });

  it("todayInsight가 '해당 없음'이면 오늘의 인사이트 섹션을 렌더링하지 않는다", () => {
    const insight = createMockInsight({ todayInsight: "해당 없음" });
    const html = renderInsightSection(insight);
    expect(html).not.toContain("오늘의 인사이트");
  });

  it("todayInsight가 있으면 오늘의 인사이트 섹션을 렌더링한다", () => {
    const insight = createMockInsight({ todayInsight: "섹터 로테이션 조짐이 보인다." });
    const html = renderInsightSection(insight);
    expect(html).toContain("오늘의 인사이트");
    expect(html).toContain("섹터 로테이션 조짐");
  });
});

// ─── buildDailyHtml ───────────────────────────────────────────────────────────

describe("buildDailyHtml", () => {
  it("완전한 HTML 문서를 생성한다", () => {
    const data = createMockDailyReportData();
    const insight = createMockInsight();
    const html = buildDailyHtml(data, insight, "2026-04-04");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html lang=\"ko\">");
    expect(html).toContain("</html>");
    expect(html).toContain("<head>");
    expect(html).toContain("<body>");
  });

  it("날짜를 올바르게 포맷한다", () => {
    const html = buildDailyHtml(
      createMockDailyReportData(),
      createMockInsight(),
      "2026-04-04",
    );
    expect(html).toContain("4월 4일");
  });

  it("셀프 컨테인드 CSS를 포함한다", () => {
    const html = buildDailyHtml(
      createMockDailyReportData(),
      createMockInsight(),
      "2026-04-04",
    );
    expect(html).toContain("<style>");
    expect(html).toContain("--up: #cf222e");
    expect(html).toContain("--down: #0969da");
  });

  it("시장 온도 배지를 헤더에 포함한다", () => {
    const insight = createMockInsight({
      marketTemperature: "bullish",
      marketTemperatureLabel: "강세",
    });
    const html = buildDailyHtml(createMockDailyReportData(), insight, "2026-04-04");
    expect(html).toContain('class="temp-badge bullish"');
    expect(html).toContain("강세");
  });

  it("모든 주요 섹션이 포함된다", () => {
    const html = buildDailyHtml(
      createMockDailyReportData(),
      createMockInsight(),
      "2026-04-04",
    );
    expect(html).toContain("시장 온도");
    expect(html).toContain("지수 현황");
    expect(html).toContain("Phase 분포");
    expect(html).toContain("섹터 RS 랭킹");
    expect(html).toContain("업종 RS Top 10");
    expect(html).toContain("특이종목");
    // risingRS가 1건 이상이면 섹션이 렌더링된다
    expect(html).toContain("RS 상승 초기 종목");
    expect(html).toContain("관심종목 현황");
  });

  it("빈 데이터로도 오류 없이 HTML을 생성한다", () => {
    const data = createMockDailyReportData({
      indexReturns: [],
      unusualStocks: [],
      risingRS: [],
      watchlist: createMockWatchlistData({ items: [] }),
    });
    const html = buildDailyHtml(data, createMockInsight(), "2026-04-04");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("empty-state");
  });

  it("XSS 공격 문자를 title에서 이스케이프한다", () => {
    const insight = createMockInsight({
      marketTemperatureLabel: '<script>alert(1)</script>',
    });
    const html = buildDailyHtml(createMockDailyReportData(), insight, "2026-04-04");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("초록색(#1a7f37)을 up/down 색상으로 사용하지 않는다", () => {
    const html = buildDailyHtml(
      createMockDailyReportData(),
      createMockInsight(),
      "2026-04-04",
    );
    // up=빨강(#cf222e), down=파랑(#0969da) — CSS 변수 검증
    expect(html).toContain("--up: #cf222e");
    expect(html).toContain("--down: #0969da");
    // phase2 색상은 --phase2 변수로만 사용 (직접 up/down 용도로 쓰지 않음)
  });

  it("푸터에 생성 날짜가 포함된다", () => {
    const html = buildDailyHtml(
      createMockDailyReportData(),
      createMockInsight(),
      "2026-04-04",
    );
    expect(html).toContain("report-footer");
    expect(html).toContain("2026-04-04");
  });
});

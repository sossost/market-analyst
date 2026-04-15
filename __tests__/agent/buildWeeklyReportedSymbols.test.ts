import { describe, it, expect } from "vitest";
import { buildWeeklyReportedSymbols } from "@/agent/run-weekly-agent";
import type { WeeklyReportData } from "@/tools/schemas/weeklyReportSchema";

// ─── Helper ──────────────────────────────────────────────────────────────────

const TARGET_DATE = "2026-04-11";

const EMPTY_BREADTH: WeeklyReportData["marketBreadth"] = {
  weeklyTrend: [],
  phase1to2Transitions: 0,
  latestSnapshot: {
    date: TARGET_DATE,
    totalStocks: 0,
    phaseDistribution: { phase1: 0, phase2: 0, phase3: 0, phase4: 0 },
    phase2Ratio: 0,
    phase2RatioChange: 0,
    marketAvgRs: 0,
    advanceDecline: { advancers: 0, decliners: 0, unchanged: 0, ratio: null },
    newHighLow: { newHighs: 0, newLows: 0, ratio: null },
    breadthScore: null,
    breadthScoreChange: null,
    divergenceSignal: null,
    topSectors: [],
  },
};

function makeData(overrides: Partial<WeeklyReportData> = {}): WeeklyReportData {
  return {
    indexReturns: [],
    fearGreed: null,
    marketBreadth: EMPTY_BREADTH,
    sectorRanking: [],
    industryTop10: [],
    watchlist: { summary: { totalActive: 0, phaseChanges: [], avgPnlPercent: 0 }, items: [] },
    gate5Candidates: [],
    watchlistChanges: { registered: [], exited: [], pending4of5: [] },
    thesisAlignedCandidates: null,
    vcpCandidates: null,
    confirmedBreakouts: null,
    sectorLagPatterns: null,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("buildWeeklyReportedSymbols", () => {
  it("모든 데이터 소스가 비어있으면 빈 배열 반환", () => {
    const result = buildWeeklyReportedSymbols(makeData(), TARGET_DATE);
    expect(result).toEqual([]);
  });

  it("gate5Candidates에서 종목을 수집한다", () => {
    const data = makeData({
      gate5Candidates: [
        {
          symbol: "NVDA",
          phase: 2,
          prevPhase: 1,
          isNewPhase2: true,
          rsScore: 92,
          ma150Slope: 0.01,
          pctFromHigh52w: -5,
          pctFromLow52w: 80,
          isExtremePctFromLow: false,
          conditionsMet: ["phase2"],
          volRatio: 1.5,
          volumeConfirmed: true,
          breakoutSignal: "none",
          sector: "Technology",
          industry: "Semiconductors",
          sepaGrade: "S",
        },
      ],
    });

    const result = buildWeeklyReportedSymbols(data, TARGET_DATE);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      symbol: "NVDA",
      phase: 2,
      prevPhase: 1,
      rsScore: 92,
      sector: "Technology",
      industry: "Semiconductors",
      reason: "5중게이트",
      firstReportedDate: TARGET_DATE,
    });
  });

  it("confirmedBreakouts에서 종목을 수집한다", () => {
    const data = makeData({
      confirmedBreakouts: [
        {
          symbol: "AAPL",
          breakoutPercent: 3.2,
          volumeRatio: 2.1,
          isPerfectRetest: false,
          ma20DistancePercent: 1.5,
          sector: "Technology",
          industry: "Consumer Electronics",
          phase: 2,
          rsScore: 85,
        },
      ],
    });

    const result = buildWeeklyReportedSymbols(data, TARGET_DATE);

    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("돌파확인");
    expect(result[0].symbol).toBe("AAPL");
  });

  it("vcpCandidates에서 종목을 수집한다", () => {
    const data = makeData({
      vcpCandidates: [
        {
          symbol: "MSFT",
          bbWidthCurrent: 0.05,
          bbWidthAvg60d: 0.08,
          atr14Percent: 1.2,
          bodyRatio: 0.6,
          ma20Ma50DistancePercent: 0.3,
          sector: "Technology",
          industry: "Software",
          phase: 2,
          rsScore: 78,
        },
      ],
    });

    const result = buildWeeklyReportedSymbols(data, TARGET_DATE);

    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("VCP");
  });

  it("thesisAlignedCandidates에서 4/4 게이트 충족 종목만 수집한다", () => {
    const data = makeData({
      thesisAlignedCandidates: {
        chains: [
          {
            chainId: 1,
            megatrend: "AI",
            bottleneck: "GPU shortage",
            chainStatus: "ACTIVE",
            alphaCompatible: true,
            daysSinceIdentified: 30,
            candidates: [
              {
                symbol: "AMD",
                chainId: 1,
                megatrend: "AI",
                bottleneck: "GPU shortage",
                chainStatus: "ACTIVE",
                phase: 2,
                rsScore: 88,
                pctFromHigh52w: -10,
                sepaGrade: "S",
                sector: "Technology",
                industry: "Semiconductors",
                marketCap: 200000,
                gatePassCount: 4,
                gateTotalCount: 4,
                source: "llm",
              },
              {
                symbol: "INTC",
                chainId: 1,
                megatrend: "AI",
                bottleneck: "GPU shortage",
                chainStatus: "ACTIVE",
                phase: 3,
                rsScore: 30,
                pctFromHigh52w: -40,
                sepaGrade: "C",
                sector: "Technology",
                industry: "Semiconductors",
                marketCap: 100000,
                gatePassCount: 1,
                gateTotalCount: 4,
                source: "sector",
              },
            ],
          },
        ],
        totalCandidates: 2,
        phase2Count: 1,
      },
    });

    const result = buildWeeklyReportedSymbols(data, TARGET_DATE);

    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("AMD");
    expect(result[0].reason).toBe("서사수혜");
  });

  it("watchlist에서 종목을 수집한다", () => {
    const data = makeData({
      watchlist: {
        summary: { totalActive: 1, phaseChanges: [], avgPnlPercent: 5 },
        items: [
          {
            symbol: "GOOGL",
            entryDate: "2026-03-01",
            trackingEndDate: null,
            daysTracked: 40,
            entryPhase: 2,
            currentPhase: 2,
            entryRsScore: 75,
            currentRsScore: 80,
            entrySector: "Communication Services",
            entryIndustry: "Internet",
            entrySepaGrade: "A",
            priceAtEntry: 150,
            currentPrice: 160,
            pnlPercent: 6.7,
            maxPnlPercent: 8.0,
            sectorRelativePerf: 2.0,
            phaseTrajectory: [],
            entryReason: "AI 검색",
            hasThesisBasis: true,
            phase2Since: "2026-03-01",
            phase2SinceDays: 40,
            phase2Segment: "확립",
          },
        ],
      },
    });

    const result = buildWeeklyReportedSymbols(data, TARGET_DATE);

    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("관심종목");
    expect(result[0].sector).toBe("Communication Services");
  });

  it("pending4of5에서 종목을 수집한다", () => {
    const data = makeData({
      watchlistChanges: {
        registered: [],
        exited: [],
        pending4of5: [{ symbol: "META", action: "register", reason: "4/5 통과 (thesis 미확인)" }],
      },
    });

    const result = buildWeeklyReportedSymbols(data, TARGET_DATE);

    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("META");
    expect(result[0].reason).toBe("예비4of5");
  });

  it("중복 종목은 한 번만 포함하고, 우선순위가 높은 소스의 reason을 사용한다", () => {
    const data = makeData({
      gate5Candidates: [
        {
          symbol: "NVDA",
          phase: 2,
          prevPhase: 1,
          isNewPhase2: true,
          rsScore: 92,
          ma150Slope: 0.01,
          pctFromHigh52w: -5,
          pctFromLow52w: 80,
          isExtremePctFromLow: false,
          conditionsMet: [],
          volRatio: 1.5,
          volumeConfirmed: true,
          breakoutSignal: "none",
          sector: "Technology",
          industry: "Semiconductors",
          sepaGrade: "S",
        },
      ],
      watchlist: {
        summary: { totalActive: 1, phaseChanges: [], avgPnlPercent: 0 },
        items: [
          {
            symbol: "NVDA",
            entryDate: "2026-03-01",
            trackingEndDate: null,
            daysTracked: 40,
            entryPhase: 2,
            currentPhase: 2,
            entryRsScore: 85,
            currentRsScore: 90,
            entrySector: "Technology",
            entryIndustry: "Semiconductors",
            entrySepaGrade: "S",
            priceAtEntry: 800,
            currentPrice: 900,
            pnlPercent: 12.5,
            maxPnlPercent: 15.0,
            sectorRelativePerf: 5.0,
            phaseTrajectory: [],
            entryReason: "AI GPU",
            hasThesisBasis: true,
            phase2Since: "2026-03-01",
            phase2SinceDays: 40,
            phase2Segment: "확립",
          },
        ],
      },
    });

    const result = buildWeeklyReportedSymbols(data, TARGET_DATE);

    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("NVDA");
    expect(result[0].reason).toBe("5중게이트"); // gate5 > watchlist
  });

  it("여러 소스에서 다른 종목을 수집하여 합산한다", () => {
    const data = makeData({
      gate5Candidates: [
        {
          symbol: "NVDA",
          phase: 2,
          prevPhase: 1,
          isNewPhase2: true,
          rsScore: 92,
          ma150Slope: 0.01,
          pctFromHigh52w: -5,
          pctFromLow52w: 80,
          isExtremePctFromLow: false,
          conditionsMet: [],
          volRatio: 1.5,
          volumeConfirmed: true,
          breakoutSignal: "none",
          sector: "Technology",
          industry: "Semiconductors",
          sepaGrade: "S",
        },
      ],
      confirmedBreakouts: [
        {
          symbol: "AAPL",
          breakoutPercent: 3.2,
          volumeRatio: 2.1,
          isPerfectRetest: false,
          ma20DistancePercent: 1.5,
          sector: "Technology",
          industry: "Consumer Electronics",
          phase: 2,
          rsScore: 85,
        },
      ],
    });

    const result = buildWeeklyReportedSymbols(data, TARGET_DATE);

    expect(result).toHaveLength(2);
    const symbols = result.map((r) => r.symbol);
    expect(symbols).toContain("NVDA");
    expect(symbols).toContain("AAPL");
  });

  it("nullable 소스(vcpCandidates, confirmedBreakouts 등)가 null이어도 에러 없이 동작한다", () => {
    const data = makeData({
      vcpCandidates: null,
      confirmedBreakouts: null,
      thesisAlignedCandidates: null,
      gate5Candidates: [
        {
          symbol: "TSLA",
          phase: 2,
          prevPhase: 4,
          isNewPhase2: true,
          rsScore: 70,
          ma150Slope: 0.005,
          pctFromHigh52w: -20,
          pctFromLow52w: 60,
          isExtremePctFromLow: false,
          conditionsMet: [],
          volRatio: 1.0,
          volumeConfirmed: false,
          breakoutSignal: "none",
          sector: "Consumer Discretionary",
          industry: "Auto Manufacturers",
          sepaGrade: "B",
        },
      ],
    });

    const result = buildWeeklyReportedSymbols(data, TARGET_DATE);

    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("TSLA");
  });

  it("firstReportedDate가 targetDate로 설정된다", () => {
    const date = "2026-04-18";
    const data = makeData({
      gate5Candidates: [
        {
          symbol: "TEST",
          phase: 2,
          prevPhase: null,
          isNewPhase2: false,
          rsScore: 60,
          ma150Slope: null,
          pctFromHigh52w: null,
          pctFromLow52w: null,
          isExtremePctFromLow: false,
          conditionsMet: [],
          volRatio: null,
          volumeConfirmed: false,
          breakoutSignal: "none",
          sector: null,
          industry: null,
          sepaGrade: null,
        },
      ],
    });

    const result = buildWeeklyReportedSymbols(data, date);

    expect(result[0].firstReportedDate).toBe(date);
  });

  it("watchlist 종목의 currentPhase가 null이면 entryPhase로 폴백한다", () => {
    const data = makeData({
      watchlist: {
        summary: { totalActive: 1, phaseChanges: [], avgPnlPercent: 0 },
        items: [
          {
            symbol: "AMZN",
            entryDate: "2026-03-01",
            trackingEndDate: null,
            daysTracked: 40,
            entryPhase: 2,
            currentPhase: null,
            entryRsScore: 75,
            currentRsScore: null,
            entrySector: "Consumer Discretionary",
            entryIndustry: "Internet Retail",
            entrySepaGrade: "A",
            priceAtEntry: 180,
            currentPrice: 190,
            pnlPercent: 5.5,
            maxPnlPercent: 7.0,
            sectorRelativePerf: 1.0,
            phaseTrajectory: [],
            entryReason: "E-commerce",
            hasThesisBasis: false,
            phase2Since: null,
            phase2SinceDays: null,
            phase2Segment: null,
          },
        ],
      },
    });

    const result = buildWeeklyReportedSymbols(data, TARGET_DATE);

    expect(result).toHaveLength(1);
    expect(result[0].phase).toBe(2); // entryPhase fallback
    expect(result[0].rsScore).toBe(75); // entryRsScore fallback
  });

  it("pending4of5 종목이 gate5에도 있으면 메타데이터는 gate5에서 가져오고 reason은 예비4of5", () => {
    const data = makeData({
      gate5Candidates: [
        {
          symbol: "COIN",
          phase: 2,
          prevPhase: 1,
          isNewPhase2: true,
          rsScore: 80,
          ma150Slope: 0.01,
          pctFromHigh52w: -8,
          pctFromLow52w: 70,
          isExtremePctFromLow: false,
          conditionsMet: [],
          volRatio: 1.2,
          volumeConfirmed: true,
          breakoutSignal: "none",
          sector: "Financials",
          industry: "Crypto Exchange",
          sepaGrade: "A",
        },
      ],
      watchlistChanges: {
        registered: [],
        exited: [],
        pending4of5: [{ symbol: "COIN", action: "register", reason: "4/5 통과 (thesis 미확인)" }],
      },
    });

    const result = buildWeeklyReportedSymbols(data, TARGET_DATE);

    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("COIN");
    expect(result[0].reason).toBe("예비4of5");
    expect(result[0].phase).toBe(2);
    expect(result[0].rsScore).toBe(80);
    expect(result[0].sector).toBe("Financials");
    expect(result[0].industry).toBe("Crypto Exchange");
  });

  it("pending4of5 전용 종목(gate5에 없을 때)은 zero-metadata로 기록된다", () => {
    const data = makeData({
      watchlistChanges: {
        registered: [],
        exited: [],
        pending4of5: [{ symbol: "ORPHAN", action: "register", reason: "4/5 통과" }],
      },
    });

    const result = buildWeeklyReportedSymbols(data, TARGET_DATE);

    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("ORPHAN");
    expect(result[0].reason).toBe("예비4of5");
    expect(result[0].phase).toBe(0);
    expect(result[0].rsScore).toBe(0);
    expect(result[0].sector).toBe("");
    expect(result[0].industry).toBe("");
  });

  it("sector/industry가 null인 경우 빈 문자열로 폴백한다", () => {
    const data = makeData({
      vcpCandidates: [
        {
          symbol: "XYZ",
          bbWidthCurrent: null,
          bbWidthAvg60d: null,
          atr14Percent: null,
          bodyRatio: null,
          ma20Ma50DistancePercent: null,
          sector: null,
          industry: null,
          phase: null,
          rsScore: null,
        },
      ],
    });

    const result = buildWeeklyReportedSymbols(data, TARGET_DATE);

    expect(result[0].sector).toBe("");
    expect(result[0].industry).toBe("");
    expect(result[0].phase).toBe(0);
    expect(result[0].rsScore).toBe(0);
  });
});

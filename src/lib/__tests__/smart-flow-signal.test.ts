import { describe, it, expect } from "vitest";
import {
  generateSmartFlowSignal,
  markAsConfirming,
  isInstitutionalFlow,
} from "../smart-flow-signal";
import type {
  OptionsFlowDailyAgg,
  DarkPoolDailyAgg,
} from "@/types/unusual-whales";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeOptionsFlow(
  overrides: Partial<OptionsFlowDailyAgg> = {},
): OptionsFlowDailyAgg {
  return {
    symbol: "AAPL",
    date: "2026-03-20",
    totalPremium: 500_000,
    callPremium: 400_000,
    putPremium: 100_000,
    callPutRatio: 4.0,
    totalContracts: 1000,
    sweepCount: 5,
    blockCount: 2,
    unusualCount: 3,
    bullishPremium: 350_000,
    bearishPremium: 100_000,
    sentimentScore: 56,
    ...overrides,
  };
}

function makeDarkPool(
  overrides: Partial<DarkPoolDailyAgg> = {},
): DarkPoolDailyAgg {
  return {
    symbol: "AAPL",
    date: "2026-03-20",
    totalNotional: 5_000_000,
    totalShares: 50_000,
    tradeCount: 10,
    avgPrice: 100.0,
    blockSize: 5000,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("smart-flow-signal", () => {
  describe("generateSmartFlowSignal", () => {
    it("옵션 플로우 + 다크풀 모두 있으면 MIXED 시그널을 생성한다", () => {
      const signal = generateSmartFlowSignal(
        "AAPL",
        "2026-03-20",
        makeOptionsFlow(),
        makeDarkPool(),
      );

      expect(signal).not.toBeNull();
      expect(signal!.signalType).toBe("MIXED");
      expect(signal!.symbol).toBe("AAPL");
      expect(signal!.confirmsExisting).toBe(false);
    });

    it("옵션 플로우만 있고 스윕이 충분하면 BULLISH_SWEEP 시그널이다", () => {
      const signal = generateSmartFlowSignal(
        "AAPL",
        "2026-03-20",
        makeOptionsFlow({ sweepCount: 5 }),
        null,
      );

      expect(signal).not.toBeNull();
      expect(signal!.signalType).toBe("BULLISH_SWEEP");
    });

    it("옵션 플로우만 있고 스윕이 부족하면 OPTIONS_SURGE 시그널이다", () => {
      const signal = generateSmartFlowSignal(
        "AAPL",
        "2026-03-20",
        makeOptionsFlow({ sweepCount: 1 }),
        null,
      );

      expect(signal).not.toBeNull();
      expect(signal!.signalType).toBe("OPTIONS_SURGE");
    });

    it("다크풀만 있으면 DARK_ACCUMULATION 시그널이다", () => {
      const signal = generateSmartFlowSignal(
        "NVDA",
        "2026-03-20",
        null,
        makeDarkPool({ symbol: "NVDA" }),
      );

      expect(signal).not.toBeNull();
      expect(signal!.signalType).toBe("DARK_ACCUMULATION");
    });

    it("데이터가 모두 null이면 null을 반환한다", () => {
      const signal = generateSmartFlowSignal("AAPL", "2026-03-20", null, null);
      expect(signal).toBeNull();
    });

    it("옵션 프리미엄이 기준 미달이면 null을 반환한다", () => {
      const signal = generateSmartFlowSignal(
        "AAPL",
        "2026-03-20",
        makeOptionsFlow({ totalPremium: 50_000 }), // below $100K threshold
        null,
      );
      expect(signal).toBeNull();
    });

    it("다크풀 notional이 기준 미달이면 null을 반환한다", () => {
      const signal = generateSmartFlowSignal(
        "AAPL",
        "2026-03-20",
        null,
        makeDarkPool({ totalNotional: 100_000 }), // below $500K threshold
      );
      expect(signal).toBeNull();
    });

    it("다크풀 tradeCount가 기준 미달이면 null을 반환한다", () => {
      const signal = generateSmartFlowSignal(
        "AAPL",
        "2026-03-20",
        null,
        makeDarkPool({ tradeCount: 2 }), // below 5 threshold
      );
      expect(signal).toBeNull();
    });

    it("compositeScore는 -100 ~ +100 범위이다", () => {
      // Extremely bullish flow
      const bullishSignal = generateSmartFlowSignal(
        "AAPL",
        "2026-03-20",
        makeOptionsFlow({
          sentimentScore: 100,
          sweepCount: 100,
          totalContracts: 100,
          callPutRatio: 99,
        }),
        makeDarkPool({ totalNotional: 50_000_000 }),
      );
      expect(bullishSignal!.compositeScore).toBeLessThanOrEqual(100);
      expect(bullishSignal!.compositeScore).toBeGreaterThanOrEqual(-100);

      // Extremely bearish flow
      const bearishSignal = generateSmartFlowSignal(
        "AAPL",
        "2026-03-20",
        makeOptionsFlow({
          sentimentScore: -100,
          sweepCount: 0,
          callPutRatio: 0,
        }),
        null,
      );
      expect(bearishSignal!.compositeScore).toBeLessThanOrEqual(100);
      expect(bearishSignal!.compositeScore).toBeGreaterThanOrEqual(-100);
    });

    it("강한 bullish 시그널은 STRONG 등급이다", () => {
      const signal = generateSmartFlowSignal(
        "AAPL",
        "2026-03-20",
        makeOptionsFlow({
          sentimentScore: 90,
          sweepCount: 50,
          totalContracts: 100,
          callPutRatio: 8,
        }),
        makeDarkPool({ totalNotional: 20_000_000 }),
      );

      expect(signal!.strength).toBe("STRONG");
    });

    it("약한 시그널은 WEAK 등급이다", () => {
      const signal = generateSmartFlowSignal(
        "AAPL",
        "2026-03-20",
        makeOptionsFlow({
          sentimentScore: 5,
          sweepCount: 0,
          callPutRatio: 1.1,
        }),
        null,
      );

      expect(signal!.strength).toBe("WEAK");
    });
  });

  describe("markAsConfirming", () => {
    it("기존 시그널의 confirmsExisting을 true로 설정한다", () => {
      const original = generateSmartFlowSignal(
        "AAPL",
        "2026-03-20",
        makeOptionsFlow(),
        null,
      )!;

      expect(original.confirmsExisting).toBe(false);

      const confirmed = markAsConfirming(original);
      expect(confirmed.confirmsExisting).toBe(true);
      // 원본은 변경되지 않음 (immutability)
      expect(original.confirmsExisting).toBe(false);
    });
  });

  describe("isInstitutionalFlow", () => {
    it("프리미엄 + 센티먼트 + 스윕이 기준을 충족하면 true", () => {
      const flow = makeOptionsFlow({
        totalPremium: 200_000,
        sentimentScore: 50,
        sweepCount: 5,
      });
      expect(isInstitutionalFlow(flow)).toBe(true);
    });

    it("프리미엄 + 센티먼트 + 높은 콜풋비율이면 true", () => {
      const flow = makeOptionsFlow({
        totalPremium: 200_000,
        sentimentScore: 50,
        sweepCount: 0,
        callPutRatio: 4.0,
      });
      expect(isInstitutionalFlow(flow)).toBe(true);
    });

    it("프리미엄 기준 미달이면 false", () => {
      const flow = makeOptionsFlow({ totalPremium: 50_000 });
      expect(isInstitutionalFlow(flow)).toBe(false);
    });

    it("센티먼트가 약하면 false", () => {
      const flow = makeOptionsFlow({
        sentimentScore: 10,
        sweepCount: 1,
        callPutRatio: 1.5,
      });
      expect(isInstitutionalFlow(flow)).toBe(false);
    });
  });
});

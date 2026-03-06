import { describe, it, expect } from "vitest";
import {
  filterSignalsByParams,
  calculateReturn,
  shouldCloseSignal,
  computeSignalReturns,
  parseSignalParams,
  DEFAULT_SIGNAL_PARAMS,
} from "@/lib/signal-logic";
import type { RawSignal, SignalParams } from "@/lib/signal-logic";

// ── Helper ──

function createSignal(overrides: Partial<RawSignal> = {}): RawSignal {
  return {
    symbol: "AAPL",
    date: "2026-03-05",
    price: 150,
    rsScore: 85,
    volumeConfirmed: true,
    sectorGroupPhase: 2,
    sector: "Technology",
    industry: "Consumer Electronics",
    ...overrides,
  };
}

// ── filterSignalsByParams ──

describe("filterSignalsByParams", () => {
  const defaultParams: SignalParams = {
    rsThreshold: 70,
    volumeRequired: true,
    sectorFilter: false,
  };

  it("passes signals meeting all criteria", () => {
    const signals = [createSignal({ rsScore: 80, volumeConfirmed: true })];
    const result = filterSignalsByParams(signals, defaultParams);
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("AAPL");
  });

  it("rejects signals below RS threshold", () => {
    const signals = [createSignal({ rsScore: 60 })];
    const result = filterSignalsByParams(signals, defaultParams);
    expect(result).toHaveLength(0);
  });

  it("rejects signals with null RS score", () => {
    const signals = [createSignal({ rsScore: null })];
    const result = filterSignalsByParams(signals, defaultParams);
    expect(result).toHaveLength(0);
  });

  it("rejects signals without volume confirmation when required", () => {
    const signals = [createSignal({ volumeConfirmed: false })];
    const result = filterSignalsByParams(signals, defaultParams);
    expect(result).toHaveLength(0);
  });

  it("rejects signals with null volume confirmation when required", () => {
    const signals = [createSignal({ volumeConfirmed: null })];
    const result = filterSignalsByParams(signals, defaultParams);
    expect(result).toHaveLength(0);
  });

  it("allows signals without volume confirmation when not required", () => {
    const params: SignalParams = { ...defaultParams, volumeRequired: false };
    const signals = [createSignal({ rsScore: 80, volumeConfirmed: false })];
    const result = filterSignalsByParams(signals, params);
    expect(result).toHaveLength(1);
  });

  it("rejects signals with non-Phase-2 sector when sector filter enabled", () => {
    const params: SignalParams = { ...defaultParams, sectorFilter: true };
    const signals = [createSignal({ sectorGroupPhase: 1 })];
    const result = filterSignalsByParams(signals, params);
    expect(result).toHaveLength(0);
  });

  it("passes signals with Phase-2 sector when sector filter enabled", () => {
    const params: SignalParams = { ...defaultParams, sectorFilter: true };
    const signals = [createSignal({ sectorGroupPhase: 2 })];
    const result = filterSignalsByParams(signals, params);
    expect(result).toHaveLength(1);
  });

  it("ignores sector group phase when sector filter disabled", () => {
    const signals = [createSignal({ sectorGroupPhase: 4 })];
    const result = filterSignalsByParams(signals, defaultParams);
    expect(result).toHaveLength(1);
  });

  it("filters multiple signals correctly", () => {
    const signals = [
      createSignal({ symbol: "AAPL", rsScore: 90 }),
      createSignal({ symbol: "MSFT", rsScore: 50 }), // below threshold
      createSignal({ symbol: "GOOG", rsScore: 75, volumeConfirmed: false }), // no vol
      createSignal({ symbol: "NVDA", rsScore: 95 }),
    ];
    const result = filterSignalsByParams(signals, defaultParams);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.symbol)).toEqual(["AAPL", "NVDA"]);
  });

  it("accepts RS exactly at threshold (boundary)", () => {
    const signals = [createSignal({ rsScore: 70 })];
    const result = filterSignalsByParams(signals, defaultParams);
    expect(result).toHaveLength(1);
  });
});

// ── calculateReturn ──

describe("calculateReturn", () => {
  it("calculates positive return", () => {
    expect(calculateReturn(100, 120)).toBeCloseTo(20, 5);
  });

  it("calculates negative return", () => {
    expect(calculateReturn(100, 80)).toBeCloseTo(-20, 5);
  });

  it("returns 0 for no change", () => {
    expect(calculateReturn(100, 100)).toBe(0);
  });

  it("returns 0 when entry price is 0", () => {
    expect(calculateReturn(0, 100)).toBe(0);
  });

  it("handles large positive return", () => {
    expect(calculateReturn(10, 30)).toBeCloseTo(200, 5);
  });

  it("handles fractional prices", () => {
    expect(calculateReturn(50, 52.5)).toBeCloseTo(5, 5);
  });
});

// ── shouldCloseSignal ──

describe("shouldCloseSignal", () => {
  it("closes when current phase is not 2", () => {
    const result = shouldCloseSignal(10, 3);
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toContain("Phase 3");
  });

  it("closes when phase is 1 (regression)", () => {
    const result = shouldCloseSignal(5, 1);
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toContain("Phase 1");
  });

  it("closes when max tracking days exceeded", () => {
    const result = shouldCloseSignal(60, 2);
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toContain("60일");
  });

  it("does not close when still in Phase 2 and within time limit", () => {
    const result = shouldCloseSignal(30, 2);
    expect(result.shouldClose).toBe(false);
    expect(result.reason).toBe(null);
  });

  it("does not close when phase is null (data missing)", () => {
    const result = shouldCloseSignal(30, null);
    expect(result.shouldClose).toBe(false);
    expect(result.reason).toBe(null);
  });

  it("uses custom maxDays", () => {
    const result = shouldCloseSignal(30, 2, 30);
    expect(result.shouldClose).toBe(true);
  });

  it("phase exit takes priority over max days", () => {
    const result = shouldCloseSignal(60, 3);
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toContain("Phase 3");
  });
});

// ── computeSignalReturns ──

describe("computeSignalReturns", () => {
  it("computes basic return and max return", () => {
    const result = computeSignalReturns({
      entryPrice: 100,
      currentPrice: 110,
      daysHeld: 3,
      currentPhase: 2,
      prevMaxReturn: 5,
      prevReturn5d: null,
      prevReturn10d: null,
      prevReturn20d: null,
      prevReturn60d: null,
    });
    expect(result.currentReturn).toBeCloseTo(10, 5);
    expect(result.maxReturn).toBeCloseTo(10, 5); // new max > prev
    expect(result.daysHeld).toBe(3);
    expect(result.shouldClose).toBe(false);
  });

  it("preserves previous max return if higher", () => {
    const result = computeSignalReturns({
      entryPrice: 100,
      currentPrice: 105,
      daysHeld: 10,
      currentPhase: 2,
      prevMaxReturn: 15,
      prevReturn5d: 8,
      prevReturn10d: null,
      prevReturn20d: null,
      prevReturn60d: null,
    });
    expect(result.maxReturn).toBe(15);
  });

  it("locks return_5d at first calculation (day 5)", () => {
    const result = computeSignalReturns({
      entryPrice: 100,
      currentPrice: 108,
      daysHeld: 5,
      currentPhase: 2,
      prevMaxReturn: 0,
      prevReturn5d: null,
      prevReturn10d: null,
      prevReturn20d: null,
      prevReturn60d: null,
    });
    expect(result.return5d).toBeCloseTo(8, 5);
  });

  it("preserves locked return_5d on subsequent days", () => {
    const result = computeSignalReturns({
      entryPrice: 100,
      currentPrice: 120,
      daysHeld: 10,
      currentPhase: 2,
      prevMaxReturn: 0,
      prevReturn5d: 5.5,
      prevReturn10d: null,
      prevReturn20d: null,
      prevReturn60d: null,
    });
    expect(result.return5d).toBe(5.5); // preserved, not overwritten
    expect(result.return10d).toBeCloseTo(20, 5); // first lock at day 10
  });

  it("does not set return_5d before day 5", () => {
    const result = computeSignalReturns({
      entryPrice: 100,
      currentPrice: 110,
      daysHeld: 4,
      currentPhase: 2,
      prevMaxReturn: 0,
      prevReturn5d: null,
      prevReturn10d: null,
      prevReturn20d: null,
      prevReturn60d: null,
    });
    expect(result.return5d).toBe(null);
  });

  it("sets return_20d at day 20", () => {
    const result = computeSignalReturns({
      entryPrice: 100,
      currentPrice: 115,
      daysHeld: 20,
      currentPhase: 2,
      prevMaxReturn: 0,
      prevReturn5d: 3,
      prevReturn10d: 7,
      prevReturn20d: null,
      prevReturn60d: null,
    });
    expect(result.return20d).toBeCloseTo(15, 5);
  });

  it("sets return_60d and closes at day 60", () => {
    const result = computeSignalReturns({
      entryPrice: 100,
      currentPrice: 130,
      daysHeld: 60,
      currentPhase: 2,
      prevMaxReturn: 25,
      prevReturn5d: 3,
      prevReturn10d: 7,
      prevReturn20d: 15,
      prevReturn60d: null,
    });
    expect(result.return60d).toBeCloseTo(30, 5);
    expect(result.shouldClose).toBe(true);
    expect(result.closeReason).toContain("60일");
  });

  it("closes on phase exit with correct return", () => {
    const result = computeSignalReturns({
      entryPrice: 100,
      currentPrice: 95,
      daysHeld: 15,
      currentPhase: 3,
      prevMaxReturn: 10,
      prevReturn5d: 5,
      prevReturn10d: 8,
      prevReturn20d: null,
      prevReturn60d: null,
    });
    expect(result.shouldClose).toBe(true);
    expect(result.closeReason).toContain("Phase 3");
    expect(result.currentReturn).toBeCloseTo(-5, 5);
    expect(result.maxReturn).toBe(10); // preserved
  });
});

// ── parseSignalParams ──

describe("parseSignalParams", () => {
  it("returns defaults for empty rows", () => {
    const result = parseSignalParams([]);
    expect(result).toEqual(DEFAULT_SIGNAL_PARAMS);
  });

  it("parses rs_threshold", () => {
    const result = parseSignalParams([
      { paramName: "rs_threshold", currentValue: "80" },
    ]);
    expect(result.rsThreshold).toBe(80);
    expect(result.volumeRequired).toBe(true); // default preserved
  });

  it("parses volume_required", () => {
    const result = parseSignalParams([
      { paramName: "volume_required", currentValue: "false" },
    ]);
    expect(result.volumeRequired).toBe(false);
  });

  it("parses sector_filter", () => {
    const result = parseSignalParams([
      { paramName: "sector_filter", currentValue: "true" },
    ]);
    expect(result.sectorFilter).toBe(true);
  });

  it("parses all params together", () => {
    const result = parseSignalParams([
      { paramName: "rs_threshold", currentValue: "65" },
      { paramName: "volume_required", currentValue: "false" },
      { paramName: "sector_filter", currentValue: "true" },
    ]);
    expect(result).toEqual({
      rsThreshold: 65,
      volumeRequired: false,
      sectorFilter: true,
    });
  });

  it("ignores unknown param names", () => {
    const result = parseSignalParams([
      { paramName: "unknown_param", currentValue: "42" },
    ]);
    expect(result).toEqual(DEFAULT_SIGNAL_PARAMS);
  });
});

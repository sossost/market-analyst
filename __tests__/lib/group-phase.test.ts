import { describe, it, expect } from "vitest";
import { detectGroupPhase } from "@/lib/group-phase";

describe("detectGroupPhase", () => {
  it("returns Phase 2 when RS accelerating and high phase2 ratio", () => {
    const result = detectGroupPhase({
      change4w: 5,
      change8w: 8,
      phase2Ratio: 0.45,
    });
    expect(result).toBe(2);
  });

  it("returns Phase 2 when all acceleration signals positive with decent phase2 ratio", () => {
    const result = detectGroupPhase({
      change4w: 3,
      change8w: 5,
      phase2Ratio: 0.35,
    });
    expect(result).toBe(2);
  });

  it("returns Phase 4 when RS declining across all periods", () => {
    const result = detectGroupPhase({
      change4w: -5,
      change8w: -8,
      phase2Ratio: 0.1,
    });
    expect(result).toBe(4);
  });

  it("returns Phase 4 when strongly negative acceleration and low phase2 ratio", () => {
    const result = detectGroupPhase({
      change4w: -3,
      change8w: -6,
      phase2Ratio: 0.15,
    });
    expect(result).toBe(4);
  });

  it("returns Phase 1 when RS is flat and moderate phase2 ratio", () => {
    const result = detectGroupPhase({
      change4w: 0.5,
      change8w: -0.5,
      phase2Ratio: 0.2,
    });
    expect(result).toBe(1);
  });

  it("returns Phase 3 when RS was positive but now declining", () => {
    const result = detectGroupPhase({
      change4w: -2,
      change8w: 3,
      phase2Ratio: 0.3,
    });
    expect(result).toBe(3);
  });

  it("handles null changes gracefully, defaults to Phase 1", () => {
    const result = detectGroupPhase({
      change4w: null,
      change8w: null,
      phase2Ratio: 0.25,
    });
    expect(result).toBe(1);
  });

  it("returns Phase 1 when both changes are exactly zero", () => {
    const result = detectGroupPhase({
      change4w: 0,
      change8w: 0,
      phase2Ratio: 0.2,
    });
    expect(result).toBe(1);
  });

  // ── Min stock gate tests (#621) ──

  it("rejects Phase 2 when totalStocks below minimum (5)", () => {
    const result = detectGroupPhase({
      change4w: 5,
      change8w: 8,
      phase2Ratio: 0.45,
      totalStocks: 3,
    });
    // Would be Phase 2 without min stock gate, but 3 < 5 → not Phase 2
    expect(result).not.toBe(2);
  });

  it("allows Phase 2 when totalStocks meets minimum", () => {
    const result = detectGroupPhase({
      change4w: 5,
      change8w: 8,
      phase2Ratio: 0.45,
      totalStocks: 5,
    });
    expect(result).toBe(2);
  });

  it("allows Phase 2 when totalStocks is large", () => {
    const result = detectGroupPhase({
      change4w: 5,
      change8w: 8,
      phase2Ratio: 0.35,
      totalStocks: 50,
    });
    expect(result).toBe(2);
  });

  it("allows Phase 2 when totalStocks is not provided (backward compat)", () => {
    const result = detectGroupPhase({
      change4w: 5,
      change8w: 8,
      phase2Ratio: 0.45,
    });
    expect(result).toBe(2);
  });

  it("rejects Phase 2 for very small sector even with high phase2Ratio", () => {
    // 2 stocks, 1 in Phase 2 = 50% ratio, but only 2 total stocks
    const result = detectGroupPhase({
      change4w: 5,
      change8w: 8,
      phase2Ratio: 0.5,
      totalStocks: 2,
    });
    expect(result).not.toBe(2);
  });
});

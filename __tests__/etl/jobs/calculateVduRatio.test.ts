import { describe, it, expect } from "vitest";
import { calculateVduRatio } from "@/etl/jobs/build-stock-phases";

describe("calculateVduRatio", () => {
  it("returns null when volumes array has fewer than longPeriod entries", () => {
    const volumes = Array.from({ length: 30 }, () => 1000);
    expect(calculateVduRatio(volumes, 5, 50)).toBeNull();
  });

  it("returns 1.0 when all volumes are equal (no dry-up)", () => {
    const volumes = Array.from({ length: 50 }, () => 1000);
    expect(calculateVduRatio(volumes, 5, 50)).toBeCloseTo(1.0);
  });

  it("returns < 0.5 when recent 5-day volume is much lower than 50-day average (dry-up)", () => {
    // 5-day avg = 200, 50-day avg = 1000 → VDU = 0.2
    const volumes = [
      ...Array.from({ length: 5 }, () => 200),
      ...Array.from({ length: 45 }, () => 1178), // (1000*50 - 200*5) / 45 ≈ 1089
    ];
    // Recalculate: total = 200*5 + 1178*45 = 1000 + 53010 = 54010, avg = 1080.2
    // short avg = 200, ratio ≈ 200/1080.2 ≈ 0.185
    const result = calculateVduRatio(volumes, 5, 50);
    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(0.5);
  });

  it("returns > 1.0 when recent volume surges above average", () => {
    const volumes = [
      ...Array.from({ length: 5 }, () => 5000),
      ...Array.from({ length: 45 }, () => 1000),
    ];
    // short avg = 5000, long avg = (25000 + 45000)/50 = 1400
    const result = calculateVduRatio(volumes, 5, 50);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(1.0);
  });

  it("returns null when long-term average is zero", () => {
    const volumes = Array.from({ length: 50 }, () => 0);
    expect(calculateVduRatio(volumes, 5, 50)).toBeNull();
  });

  it("handles exact boundary: exactly longPeriod entries", () => {
    const volumes = Array.from({ length: 50 }, (_, i) => (i < 5 ? 500 : 1000));
    const result = calculateVduRatio(volumes, 5, 50);
    expect(result).not.toBeNull();
    // short avg = 500, long avg = (2500 + 45000)/50 = 950
    expect(result!).toBeCloseTo(500 / 950, 2);
  });
});

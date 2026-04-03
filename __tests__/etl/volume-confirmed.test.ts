import { describe, it, expect } from "vitest";
import {
  resolveVolumeConfirmed,
  calculateWeeklyVolRatio,
  resolveBreakoutSignal,
} from "@/etl/utils/common";

describe("resolveVolumeConfirmed", () => {
  describe("Phase != 2 → null", () => {
    it("returns null for Phase 1", () => {
      expect(resolveVolumeConfirmed(1, null, 3.0, null)).toBe(null);
    });

    it("returns null for Phase 3", () => {
      expect(resolveVolumeConfirmed(3, 2, 1.5, true)).toBe(null);
    });

    it("returns null for Phase 4", () => {
      expect(resolveVolumeConfirmed(4, 3, 0.5, null)).toBe(null);
    });
  });

  describe("New Phase 2 entry (prevPhase != 2)", () => {
    it("returns true when vol_ratio >= 2.0", () => {
      expect(resolveVolumeConfirmed(2, 1, 2.5, null)).toBe(true);
    });

    it("returns true when vol_ratio == 2.0 (boundary)", () => {
      expect(resolveVolumeConfirmed(2, 1, 2.0, null)).toBe(true);
    });

    it("returns false when vol_ratio < 2.0", () => {
      expect(resolveVolumeConfirmed(2, 1, 1.8, null)).toBe(false);
    });

    it("returns false when vol_ratio is null", () => {
      expect(resolveVolumeConfirmed(2, 1, null, null)).toBe(false);
    });

    it("returns true when prevPhase is null (first appearance) and vol >= 2x", () => {
      expect(resolveVolumeConfirmed(2, null, 3.0, null)).toBe(true);
    });

    it("returns false when prevPhase is null and vol < 2x", () => {
      expect(resolveVolumeConfirmed(2, null, 1.0, null)).toBe(false);
    });
  });

  describe("Phase 2 continuation (prevPhase == 2)", () => {
    it("keeps true once confirmed", () => {
      expect(resolveVolumeConfirmed(2, 2, 0.8, true)).toBe(true);
    });

    it("upgrades to true when vol_ratio >= 2.0 and previously unconfirmed", () => {
      expect(resolveVolumeConfirmed(2, 2, 2.5, false)).toBe(true);
    });

    it("upgrades to true when vol_ratio == 2.0 boundary and previously unconfirmed", () => {
      expect(resolveVolumeConfirmed(2, 2, 2.0, false)).toBe(true);
    });

    it("stays false when vol_ratio < 2.0 and previously unconfirmed", () => {
      expect(resolveVolumeConfirmed(2, 2, 1.5, false)).toBe(false);
    });

    it("stays false when vol_ratio is null and previously unconfirmed", () => {
      expect(resolveVolumeConfirmed(2, 2, null, false)).toBe(false);
    });

    it("defaults to false when prevVolumeConfirmed is null and vol < 2x", () => {
      expect(resolveVolumeConfirmed(2, 2, 1.5, null)).toBe(false);
    });

    it("upgrades from null to true when vol >= 2x", () => {
      expect(resolveVolumeConfirmed(2, 2, 3.0, null)).toBe(true);
    });
  });
});

describe("calculateWeeklyVolRatio", () => {
  it("returns null when insufficient data (< 25 days)", () => {
    const volumes = Array.from({ length: 20 }, () => 1000);
    expect(calculateWeeklyVolRatio(volumes)).toBe(null);
  });

  it("calculates ratio correctly with uniform volume", () => {
    // 25 days of 1000 each → recent 5 days = 5000, prior 20 days avg weekly = 5000
    const volumes = Array.from({ length: 25 }, () => 1000);
    expect(calculateWeeklyVolRatio(volumes)).toBeCloseTo(1.0);
  });

  it("detects volume surge (recent week 2x prior average)", () => {
    // Recent 5 days: 2000 each = 10000 total
    // Prior 20 days: 1000 each = 20000 total, weekly avg = 5000
    // Ratio = 10000 / 5000 = 2.0
    const recent = Array.from({ length: 5 }, () => 2000);
    const prior = Array.from({ length: 20 }, () => 1000);
    expect(calculateWeeklyVolRatio([...recent, ...prior])).toBeCloseTo(2.0);
  });

  it("detects volume dry-up (recent week 0.5x prior average)", () => {
    const recent = Array.from({ length: 5 }, () => 500);
    const prior = Array.from({ length: 20 }, () => 1000);
    expect(calculateWeeklyVolRatio([...recent, ...prior])).toBeCloseTo(0.5);
  });

  it("returns null when prior weekly average is zero", () => {
    const recent = Array.from({ length: 5 }, () => 1000);
    const prior = Array.from({ length: 20 }, () => 0);
    expect(calculateWeeklyVolRatio([...recent, ...prior])).toBe(null);
  });

  it("uses only the first 25 elements even if more data provided", () => {
    const recent = Array.from({ length: 5 }, () => 3000);
    const prior = Array.from({ length: 20 }, () => 1000);
    const extra = Array.from({ length: 30 }, () => 9999);
    const ratio = calculateWeeklyVolRatio([...recent, ...prior, ...extra]);
    // 15000 / 5000 = 3.0
    expect(ratio).toBeCloseTo(3.0);
  });
});

describe("resolveBreakoutSignal", () => {
  describe("Phase != 2 → null", () => {
    it("returns null for Phase 1", () => {
      expect(resolveBreakoutSignal(1, null, 3.0, 2.0)).toBe(null);
    });

    it("returns null for Phase 3", () => {
      expect(resolveBreakoutSignal(3, 2, 3.0, 2.0)).toBe(null);
    });

    it("returns null for Phase 4", () => {
      expect(resolveBreakoutSignal(4, 3, 3.0, 2.0)).toBe(null);
    });
  });

  describe("Phase 2 continuation (prevPhase == 2) → null", () => {
    it("returns null even with high volume", () => {
      expect(resolveBreakoutSignal(2, 2, 3.0, 2.0)).toBe(null);
    });

    it("returns null with low volume", () => {
      expect(resolveBreakoutSignal(2, 2, 0.5, 0.5)).toBe(null);
    });
  });

  describe("New Phase 2 entry (prevPhase != 2)", () => {
    it("confirmed when weeklyVolRatio >= 1.5", () => {
      expect(resolveBreakoutSignal(2, 1, 1.0, 1.5)).toBe("confirmed");
    });

    it("confirmed when dailyVolRatio >= 2.0 (even if weekly is low)", () => {
      expect(resolveBreakoutSignal(2, 1, 2.0, 1.0)).toBe("confirmed");
    });

    it("confirmed when both daily and weekly are high", () => {
      expect(resolveBreakoutSignal(2, 1, 3.0, 2.0)).toBe("confirmed");
    });

    it("unconfirmed when both ratios are below thresholds", () => {
      expect(resolveBreakoutSignal(2, 1, 1.5, 1.2)).toBe("unconfirmed");
    });

    it("unconfirmed when both ratios are null", () => {
      expect(resolveBreakoutSignal(2, 1, null, null)).toBe("unconfirmed");
    });

    it("confirmed when prevPhase is null (first appearance) with weekly volume", () => {
      expect(resolveBreakoutSignal(2, null, null, 1.8)).toBe("confirmed");
    });

    it("unconfirmed when prevPhase is null and no volume", () => {
      expect(resolveBreakoutSignal(2, null, 1.0, null)).toBe("unconfirmed");
    });

    it("confirmed from Phase 3→2 transition with weekly volume", () => {
      expect(resolveBreakoutSignal(2, 3, 1.0, 1.6)).toBe("confirmed");
    });

    it("confirmed from Phase 4→2 transition with daily volume", () => {
      expect(resolveBreakoutSignal(2, 4, 2.5, null)).toBe("confirmed");
    });

    it("boundary: weeklyVolRatio exactly 1.5 → confirmed", () => {
      expect(resolveBreakoutSignal(2, 1, null, 1.5)).toBe("confirmed");
    });

    it("boundary: weeklyVolRatio just below 1.5 → checks daily", () => {
      expect(resolveBreakoutSignal(2, 1, 1.9, 1.49)).toBe("unconfirmed");
    });
  });
});

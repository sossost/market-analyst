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
});

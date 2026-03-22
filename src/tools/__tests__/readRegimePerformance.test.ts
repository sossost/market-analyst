import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/debate/regimeThesisAnalyzer", () => ({
  getRegimePerformanceSummary: vi.fn(),
}));

vi.mock("@/debate/regimeStore", () => ({
  loadConfirmedRegime: vi.fn(),
}));

import { getRegimePerformanceSummary } from "@/debate/regimeThesisAnalyzer";
import { loadConfirmedRegime } from "@/debate/regimeStore";
import { readRegimePerformance } from "../readRegimePerformance";

const mockGetSummary = vi.mocked(getRegimePerformanceSummary);
const mockLoadRegime = vi.mocked(loadConfirmedRegime);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readRegimePerformance tool", () => {
  it("returns empty message when no resolved theses", async () => {
    mockGetSummary.mockResolvedValue({
      regimeHitRates: [],
      regimeBiases: [],
      totalResolved: 0,
      overallHitRate: 0,
      hasSufficientData: false,
    });
    mockLoadRegime.mockResolvedValue(null);

    const raw = await readRegimePerformance.execute({});
    const result = JSON.parse(raw);

    expect(result.totalResolved).toBe(0);
    expect(result.regimeHitRates).toEqual([]);
    expect(result.message).toContain("분석할 수 없습니다");
  });

  it("returns regime performance with current regime", async () => {
    mockGetSummary.mockResolvedValue({
      regimeHitRates: [
        { regime: "MID_BULL", total: 10, confirmed: 7, invalidated: 3, hitRate: 0.7 },
      ],
      regimeBiases: [],
      totalResolved: 10,
      overallHitRate: 0.7,
      hasSufficientData: true,
    });
    mockLoadRegime.mockResolvedValue({
      regimeDate: "2025-01-01",
      regime: "MID_BULL",
      rationale: "test",
      confidence: "high",
      isConfirmed: true,
      confirmedAt: "2025-01-01",
    });

    const raw = await readRegimePerformance.execute({});
    const result = JSON.parse(raw);

    expect(result.totalResolved).toBeUndefined(); // not in success path
    expect(result.currentRegime).toBe("MID_BULL");
    expect(result.overallHitRate).toBe(0.7);
    expect(result.regimeHitRates).toHaveLength(1);
    expect(result.message).toContain("1개 레짐");
  });

  it("returns null currentRegime when no confirmed regime", async () => {
    mockGetSummary.mockResolvedValue({
      regimeHitRates: [
        { regime: "EARLY_BULL", total: 5, confirmed: 3, invalidated: 2, hitRate: 0.6 },
      ],
      regimeBiases: [],
      totalResolved: 5,
      overallHitRate: 0.6,
      hasSufficientData: true,
    });
    mockLoadRegime.mockResolvedValue(null);

    const raw = await readRegimePerformance.execute({});
    const result = JSON.parse(raw);

    expect(result.currentRegime).toBeNull();
  });

  it("has correct tool definition", () => {
    expect(readRegimePerformance.definition.name).toBe("read_regime_performance");
    expect(readRegimePerformance.definition.input_schema.type).toBe("object");
  });
});

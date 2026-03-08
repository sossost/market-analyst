import { describe, it, expect } from "vitest";
import {
  extractConditionKeys,
  generateConditionCombinations,
  conditionKeyToName,
  aggregateFailureRates,
  parseFailureConditions,
} from "@/etl/jobs/collect-failure-patterns";
import type { FailureConditions } from "@/types/failure";

describe("parseFailureConditions", () => {
  it("parses valid JSON with all fields", () => {
    const json = JSON.stringify({
      marketBreadthDirection: "declining",
      sectorRsIsolated: true,
      volumeConfirmed: false,
      sepaGrade: "A",
    });

    const result = parseFailureConditions(json);
    expect(result).toEqual({
      marketBreadthDirection: "declining",
      sectorRsIsolated: true,
      volumeConfirmed: false,
      sepaGrade: "A",
    });
  });

  it("defaults missing fields to null", () => {
    const result = parseFailureConditions("{}");
    expect(result).toEqual({
      marketBreadthDirection: null,
      sectorRsIsolated: null,
      volumeConfirmed: null,
      sepaGrade: null,
    });
  });

  it("returns null for invalid JSON", () => {
    expect(parseFailureConditions("not-json")).toBeNull();
  });

  it("returns null for non-object JSON (array)", () => {
    expect(parseFailureConditions("[1,2,3]")).toBeNull();
  });

  it("returns null for JSON null", () => {
    expect(parseFailureConditions("null")).toBeNull();
  });

  it("returns null for JSON primitive", () => {
    expect(parseFailureConditions('"string"')).toBeNull();
  });

  it("handles partial fields gracefully", () => {
    const json = JSON.stringify({ marketBreadthDirection: "improving" });
    const result = parseFailureConditions(json);
    expect(result).toEqual({
      marketBreadthDirection: "improving",
      sectorRsIsolated: null,
      volumeConfirmed: null,
      sepaGrade: null,
    });
  });
});

describe("collect-failure-patterns logic", () => {
  describe("extractConditionKeys", () => {
    it("extracts all non-null conditions", () => {
      const conditions: FailureConditions = {
        marketBreadthDirection: "declining",
        sectorRsIsolated: true,
        volumeConfirmed: false,
        sepaGrade: "A",
      };

      const keys = extractConditionKeys(conditions);
      expect(keys).toEqual([
        "breadth:declining",
        "sector_isolated:true",
        "volume:false",
        "sepa:A",
      ]);
    });

    it("skips null values", () => {
      const conditions: FailureConditions = {
        marketBreadthDirection: "declining",
        sectorRsIsolated: null,
        volumeConfirmed: null,
        sepaGrade: null,
      };

      const keys = extractConditionKeys(conditions);
      expect(keys).toEqual(["breadth:declining"]);
    });

    it("returns empty array when all conditions are null", () => {
      const conditions: FailureConditions = {
        marketBreadthDirection: null,
        sectorRsIsolated: null,
        volumeConfirmed: null,
        sepaGrade: null,
      };

      const keys = extractConditionKeys(conditions);
      expect(keys).toEqual([]);
    });

    it("groups C and F grades as C-F", () => {
      const conditionsC: FailureConditions = {
        marketBreadthDirection: null,
        sectorRsIsolated: null,
        volumeConfirmed: null,
        sepaGrade: "C",
      };
      const conditionsF: FailureConditions = {
        marketBreadthDirection: null,
        sectorRsIsolated: null,
        volumeConfirmed: null,
        sepaGrade: "F",
      };

      expect(extractConditionKeys(conditionsC)).toEqual(["sepa:C-F"]);
      expect(extractConditionKeys(conditionsF)).toEqual(["sepa:C-F"]);
    });

    it("keeps S, A, B grades as-is", () => {
      for (const grade of ["S", "A", "B"] as const) {
        const conditions: FailureConditions = {
          marketBreadthDirection: null,
          sectorRsIsolated: null,
          volumeConfirmed: null,
          sepaGrade: grade,
        };
        expect(extractConditionKeys(conditions)).toEqual([`sepa:${grade}`]);
      }
    });

    it("handles breadth direction values", () => {
      for (const direction of ["improving", "declining", "neutral"] as const) {
        const conditions: FailureConditions = {
          marketBreadthDirection: direction,
          sectorRsIsolated: null,
          volumeConfirmed: null,
          sepaGrade: null,
        };
        expect(extractConditionKeys(conditions)).toEqual([`breadth:${direction}`]);
      }
    });
  });

  describe("generateConditionCombinations", () => {
    it("returns individual keys for single key", () => {
      expect(generateConditionCombinations(["breadth:declining"])).toEqual([
        "breadth:declining",
      ]);
    });

    it("returns individual + pair for two keys", () => {
      const result = generateConditionCombinations([
        "breadth:declining",
        "sector_isolated:true",
      ]);

      expect(result).toEqual([
        "breadth:declining",
        "sector_isolated:true",
        "breadth:declining|sector_isolated:true",
      ]);
    });

    it("returns individual + all pairs for three keys", () => {
      const result = generateConditionCombinations([
        "breadth:declining",
        "sector_isolated:true",
        "volume:false",
      ]);

      expect(result).toHaveLength(6); // 3 individual + 3 pairs
      expect(result).toContain("breadth:declining");
      expect(result).toContain("sector_isolated:true");
      expect(result).toContain("volume:false");
      expect(result).toContain("breadth:declining|sector_isolated:true");
      expect(result).toContain("breadth:declining|volume:false");
      expect(result).toContain("sector_isolated:true|volume:false");
    });

    it("returns individual + all pairs for four keys", () => {
      const result = generateConditionCombinations([
        "breadth:declining",
        "sector_isolated:true",
        "volume:false",
        "sepa:C-F",
      ]);

      expect(result).toHaveLength(10); // 4 individual + 6 pairs
    });

    it("returns empty for empty keys", () => {
      expect(generateConditionCombinations([])).toEqual([]);
    });

    it("sorts pair keys alphabetically for consistency", () => {
      const result = generateConditionCombinations([
        "volume:false",
        "breadth:declining",
      ]);

      // pair should be sorted: breadth before volume
      expect(result[2]).toBe("breadth:declining|volume:false");
    });
  });

  describe("conditionKeyToName", () => {
    it("translates breadth:declining", () => {
      expect(conditionKeyToName("breadth:declining")).toBe("브레드스 악화");
    });

    it("translates breadth:improving", () => {
      expect(conditionKeyToName("breadth:improving")).toBe("브레드스 개선");
    });

    it("translates breadth:neutral", () => {
      expect(conditionKeyToName("breadth:neutral")).toBe("브레드스 보합");
    });

    it("translates sector_isolated:true", () => {
      expect(conditionKeyToName("sector_isolated:true")).toBe("섹터 고립 상승");
    });

    it("translates sector_isolated:false", () => {
      expect(conditionKeyToName("sector_isolated:false")).toBe("섹터 동반 상승");
    });

    it("translates volume:true", () => {
      expect(conditionKeyToName("volume:true")).toBe("거래량 확인");
    });

    it("translates volume:false", () => {
      expect(conditionKeyToName("volume:false")).toBe("거래량 미확인");
    });

    it("translates sepa:C-F", () => {
      expect(conditionKeyToName("sepa:C-F")).toBe("펀더멘탈 부실");
    });

    it("translates sepa:A", () => {
      expect(conditionKeyToName("sepa:A")).toBe("펀더멘탈 A등급");
    });

    it("translates compound key with separator", () => {
      expect(conditionKeyToName("breadth:declining|sector_isolated:true")).toBe(
        "브레드스 악화 + 섹터 고립 상승",
      );
    });
  });

  describe("aggregateFailureRates", () => {
    it("counts failures and totals per combination", () => {
      const records = [
        { isFailure: true, conditionCombinations: ["breadth:declining", "volume:false"] },
        { isFailure: true, conditionCombinations: ["breadth:declining", "volume:true"] },
        { isFailure: false, conditionCombinations: ["breadth:declining", "volume:false"] },
      ];

      const stats = aggregateFailureRates(records);

      // breadth:declining appears 3 times, 2 failures
      expect(stats.get("breadth:declining")).toEqual({ failureCount: 2, totalCount: 3 });
      // volume:false appears 2 times, 1 failure
      expect(stats.get("volume:false")).toEqual({ failureCount: 1, totalCount: 2 });
      // volume:true appears 1 time, 1 failure
      expect(stats.get("volume:true")).toEqual({ failureCount: 1, totalCount: 1 });
    });

    it("returns empty map for empty records", () => {
      const stats = aggregateFailureRates([]);
      expect(stats.size).toBe(0);
    });

    it("handles all successes", () => {
      const records = [
        { isFailure: false, conditionCombinations: ["breadth:improving"] },
        { isFailure: false, conditionCombinations: ["breadth:improving"] },
      ];

      const stats = aggregateFailureRates(records);
      expect(stats.get("breadth:improving")).toEqual({ failureCount: 0, totalCount: 2 });
    });

    it("handles all failures", () => {
      const records = [
        { isFailure: true, conditionCombinations: ["sepa:C-F"] },
        { isFailure: true, conditionCombinations: ["sepa:C-F"] },
        { isFailure: true, conditionCombinations: ["sepa:C-F"] },
      ];

      const stats = aggregateFailureRates(records);
      expect(stats.get("sepa:C-F")).toEqual({ failureCount: 3, totalCount: 3 });
    });

    it("handles compound combinations", () => {
      const records = [
        {
          isFailure: true,
          conditionCombinations: [
            "breadth:declining",
            "sector_isolated:true",
            "breadth:declining|sector_isolated:true",
          ],
        },
        {
          isFailure: false,
          conditionCombinations: [
            "breadth:declining",
            "sector_isolated:false",
            "breadth:declining|sector_isolated:false",
          ],
        },
      ];

      const stats = aggregateFailureRates(records);

      expect(stats.get("breadth:declining")).toEqual({ failureCount: 1, totalCount: 2 });
      expect(stats.get("sector_isolated:true")).toEqual({ failureCount: 1, totalCount: 1 });
      expect(stats.get("sector_isolated:false")).toEqual({ failureCount: 0, totalCount: 1 });
      expect(stats.get("breadth:declining|sector_isolated:true")).toEqual({
        failureCount: 1,
        totalCount: 1,
      });
      expect(stats.get("breadth:declining|sector_isolated:false")).toEqual({
        failureCount: 0,
        totalCount: 1,
      });
    });
  });
});

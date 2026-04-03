import { describe, it, expect } from "vitest";
import { applyIndustrySectorCap } from "@/lib/industryFilter.js";

interface TestIndustry {
  industry: string;
  sector: string;
  avgRs: number;
}

describe("applyIndustrySectorCap", () => {
  it("limits each sector to sectorCap entries", () => {
    const input: TestIndustry[] = [
      { industry: "Oil & Gas E&P", sector: "Energy", avgRs: 90 },
      { industry: "Oil & Gas Midstream", sector: "Energy", avgRs: 85 },
      { industry: "Oil & Gas Drilling", sector: "Energy", avgRs: 80 },
      { industry: "Semiconductors", sector: "Technology", avgRs: 70 },
      { industry: "Software", sector: "Technology", avgRs: 65 },
      { industry: "Biotech", sector: "Healthcare", avgRs: 60 },
    ];

    const result = applyIndustrySectorCap(input, 2, 10);

    const energyCount = result.filter((r) => r.sector === "Energy").length;
    const techCount = result.filter((r) => r.sector === "Technology").length;

    expect(energyCount).toBe(2);
    expect(techCount).toBe(2);
    expect(result).toHaveLength(5);
  });

  it("drops Energy entries beyond cap=2 when Energy has 7 inputs", () => {
    const input: TestIndustry[] = Array.from({ length: 7 }, (_, i) => ({
      industry: `Energy Industry ${i + 1}`,
      sector: "Energy",
      avgRs: 90 - i,
    }));

    const result = applyIndustrySectorCap(input, 2, 10);

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.sector === "Energy")).toBe(true);
  });

  it("returns all entries when total is less than topN", () => {
    const input: TestIndustry[] = [
      { industry: "Oil & Gas E&P", sector: "Energy", avgRs: 90 },
      { industry: "Semiconductors", sector: "Technology", avgRs: 70 },
      { industry: "Biotech", sector: "Healthcare", avgRs: 60 },
    ];

    const result = applyIndustrySectorCap(input, 2, 10);

    expect(result).toHaveLength(3);
  });

  it("truncates to topN even when more entries are available", () => {
    const input: TestIndustry[] = [
      { industry: "Ind A", sector: "A", avgRs: 99 },
      { industry: "Ind B", sector: "B", avgRs: 98 },
      { industry: "Ind C", sector: "C", avgRs: 97 },
      { industry: "Ind D", sector: "D", avgRs: 96 },
      { industry: "Ind E", sector: "E", avgRs: 95 },
    ];

    const result = applyIndustrySectorCap(input, 2, 3);

    expect(result).toHaveLength(3);
  });

  it("returns empty array for empty input", () => {
    const result = applyIndustrySectorCap([], 2, 10);
    expect(result).toHaveLength(0);
  });

  it("handles sector='' edge case without throwing", () => {
    const input: TestIndustry[] = [
      { industry: "Unknown A", sector: "", avgRs: 80 },
      { industry: "Unknown B", sector: "", avgRs: 75 },
      { industry: "Unknown C", sector: "", avgRs: 70 },
    ];

    const result = applyIndustrySectorCap(input, 2, 10);

    // 빈 문자열도 하나의 섹터로 카운팅 — 2개 제한 적용
    expect(result).toHaveLength(2);
  });

  it("preserves RS-descending order from input", () => {
    const input: TestIndustry[] = [
      { industry: "Oil & Gas E&P", sector: "Energy", avgRs: 90 },
      { industry: "Semiconductors", sector: "Technology", avgRs: 85 },
      { industry: "Oil & Gas Midstream", sector: "Energy", avgRs: 80 },
      { industry: "Software", sector: "Technology", avgRs: 75 },
      { industry: "Biotech", sector: "Healthcare", avgRs: 70 },
    ];

    const result = applyIndustrySectorCap(input, 2, 10);

    // 입력 순서(RS 내림차순)를 유지해야 한다
    expect(result.map((r) => r.industry)).toEqual([
      "Oil & Gas E&P",
      "Semiconductors",
      "Oil & Gas Midstream",
      "Software",
      "Biotech",
    ]);
  });

  it("does not mutate the input array", () => {
    const input: TestIndustry[] = [
      { industry: "Oil & Gas E&P", sector: "Energy", avgRs: 90 },
      { industry: "Semiconductors", sector: "Technology", avgRs: 70 },
    ];
    const inputCopy = [...input];

    applyIndustrySectorCap(input, 2, 10);

    expect(input).toEqual(inputCopy);
  });
});

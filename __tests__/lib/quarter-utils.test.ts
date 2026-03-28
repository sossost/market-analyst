import { describe, it, expect } from "vitest";
import { parseQuarterStr, periodEndDateToAsOfQ } from "@/lib/quarter-utils";

describe("parseQuarterStr", () => {
  it("parses 'Q4 2025' format", () => {
    expect(parseQuarterStr("Q4 2025")).toEqual({ quarter: 4, year: 2025 });
  });

  it("parses '2025Q4' format", () => {
    expect(parseQuarterStr("2025Q4")).toEqual({ quarter: 4, year: 2025 });
  });

  it("returns null for invalid format", () => {
    expect(parseQuarterStr("invalid")).toBeNull();
  });
});

describe("periodEndDateToAsOfQ", () => {
  it("converts Q1 end dates (Jan-Mar)", () => {
    expect(periodEndDateToAsOfQ("2025-03-31")).toBe("Q1 2025");
    expect(periodEndDateToAsOfQ("2025-01-31")).toBe("Q1 2025");
  });

  it("converts Q2 end dates (Apr-Jun)", () => {
    expect(periodEndDateToAsOfQ("2025-06-30")).toBe("Q2 2025");
    expect(periodEndDateToAsOfQ("2025-04-30")).toBe("Q2 2025");
  });

  it("converts Q3 end dates (Jul-Sep)", () => {
    expect(periodEndDateToAsOfQ("2025-09-30")).toBe("Q3 2025");
  });

  it("converts Q4 end dates (Oct-Dec)", () => {
    expect(periodEndDateToAsOfQ("2025-12-31")).toBe("Q4 2025");
    expect(periodEndDateToAsOfQ("2025-10-31")).toBe("Q4 2025");
  });
});

import { describe, it, expect } from "vitest";
import { parseQuarterStr, periodEndDateToAsOfQ, reportDateToAsOfQ } from "@/lib/quarter-utils";

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

describe("reportDateToAsOfQ", () => {
  it("maps Jan-Mar announcement to Q4 prior year", () => {
    expect(reportDateToAsOfQ("2026-01-15")).toBe("Q4 2025");
    expect(reportDateToAsOfQ("2026-02-28")).toBe("Q4 2025");
    expect(reportDateToAsOfQ("2026-03-31")).toBe("Q4 2025");
  });

  it("maps Apr-Jun announcement to Q1 same year", () => {
    expect(reportDateToAsOfQ("2026-04-01")).toBe("Q1 2026");
    expect(reportDateToAsOfQ("2026-05-15")).toBe("Q1 2026");
    expect(reportDateToAsOfQ("2026-06-30")).toBe("Q1 2026");
  });

  it("maps Jul-Sep announcement to Q2 same year", () => {
    expect(reportDateToAsOfQ("2025-07-01")).toBe("Q2 2025");
    expect(reportDateToAsOfQ("2025-08-14")).toBe("Q2 2025");
    expect(reportDateToAsOfQ("2025-09-30")).toBe("Q2 2025");
  });

  it("maps Oct-Dec announcement to Q3 same year", () => {
    expect(reportDateToAsOfQ("2025-10-01")).toBe("Q3 2025");
    expect(reportDateToAsOfQ("2025-11-07")).toBe("Q3 2025");
    expect(reportDateToAsOfQ("2025-12-31")).toBe("Q3 2025");
  });

  it("returns null for invalid date", () => {
    expect(reportDateToAsOfQ("invalid")).toBeNull();
    expect(reportDateToAsOfQ("2025-13-01")).toBeNull();
    expect(reportDateToAsOfQ("2025-00-15")).toBeNull();
  });
});

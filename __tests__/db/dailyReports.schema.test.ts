import { describe, it, expect } from "vitest";
import { dailyReports } from "../../src/db/schema/analyst.js";
import { getTableName, getTableColumns } from "drizzle-orm";

describe("dailyReports schema", () => {
  it("has correct table name", () => {
    expect(getTableName(dailyReports)).toBe("daily_reports");
  });

  it("has all required columns", () => {
    const columns = getTableColumns(dailyReports);
    const columnNames = Object.keys(columns);

    expect(columnNames).toContain("id");
    expect(columnNames).toContain("reportDate");
    expect(columnNames).toContain("type");
    expect(columnNames).toContain("reportedSymbols");
    expect(columnNames).toContain("marketSummary");
    expect(columnNames).toContain("fullContent");
    expect(columnNames).toContain("metadata");
    expect(columnNames).toContain("createdAt");
  });

  it("has 8 columns total", () => {
    const columns = getTableColumns(dailyReports);
    expect(Object.keys(columns)).toHaveLength(8);
  });

  it("reportDate column maps to report_date", () => {
    const columns = getTableColumns(dailyReports);
    expect(columns.reportDate.name).toBe("report_date");
  });

  it("type column has default value of daily", () => {
    const columns = getTableColumns(dailyReports);
    expect(columns.type.hasDefault).toBe(true);
  });

  it("reportedSymbols and marketSummary are not null", () => {
    const columns = getTableColumns(dailyReports);
    expect(columns.reportedSymbols.notNull).toBe(true);
    expect(columns.marketSummary.notNull).toBe(true);
  });

  it("fullContent and metadata are nullable", () => {
    const columns = getTableColumns(dailyReports);
    expect(columns.fullContent.notNull).toBe(false);
    expect(columns.metadata.notNull).toBe(false);
  });
});

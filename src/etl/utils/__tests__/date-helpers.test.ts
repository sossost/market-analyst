import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { execute: mockExecute },
}));

import {
  isWeekendDate,
  getLatestTradeDate,
  getLatestPriceDate,
  getPreviousTradeDate,
} from "../date-helpers.js";

describe("isWeekendDate", () => {
  it.each([
    ["2026-04-04", true, "토요일"],
    ["2026-04-05", true, "일요일"],
    ["2026-04-11", true, "토요일"],
    ["2026-04-12", true, "일요일"],
  ])("%s → %s (%s)", (date, expected) => {
    expect(isWeekendDate(date)).toBe(expected);
  });

  it.each([
    ["2026-04-05", true],  // Sunday
    ["2026-04-06", false], // Monday
    ["2026-04-07", false], // Tuesday
    ["2026-04-08", false], // Wednesday
    ["2026-04-09", false], // Thursday
    ["2026-04-03", false], // Friday
    ["2026-04-04", true],  // Saturday
  ])("%s weekend=%s (full week)", (date, expected) => {
    expect(isWeekendDate(date)).toBe(expected);
  });

  it("handles year boundary correctly", () => {
    // 2026-01-03 is Saturday, 2026-01-04 is Sunday
    expect(isWeekendDate("2026-01-03")).toBe(true);
    expect(isWeekendDate("2026-01-04")).toBe(true);
    expect(isWeekendDate("2026-01-05")).toBe(false); // Monday
  });
});

describe("getLatestTradeDate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the latest trade date", async () => {
    mockExecute.mockResolvedValue({ rows: [{ result_date: "2026-04-03" }] });
    const result = await getLatestTradeDate();
    expect(result).toBe("2026-04-03");
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("returns null when no rows", async () => {
    mockExecute.mockResolvedValue({ rows: [{ result_date: null }] });
    const result = await getLatestTradeDate();
    expect(result).toBeNull();
  });
});

describe("getLatestPriceDate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TARGET_DATE;
  });

  it("returns the latest price date", async () => {
    mockExecute.mockResolvedValue({ rows: [{ result_date: "2026-04-03" }] });
    const result = await getLatestPriceDate();
    expect(result).toBe("2026-04-03");
  });

  it("respects TARGET_DATE override without querying DB", async () => {
    process.env.TARGET_DATE = "2026-04-10";
    const result = await getLatestPriceDate();
    expect(result).toBe("2026-04-10");
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("returns null when no data", async () => {
    mockExecute.mockResolvedValue({ rows: [{ result_date: null }] });
    const result = await getLatestPriceDate();
    expect(result).toBeNull();
  });
});

describe("getPreviousTradeDate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns previous trade date", async () => {
    mockExecute.mockResolvedValue({ rows: [{ result_date: "2026-04-02" }] });
    const result = await getPreviousTradeDate("2026-04-03");
    expect(result).toBe("2026-04-02");
  });

  it("throws on invalid date format", async () => {
    await expect(getPreviousTradeDate("invalid")).rejects.toThrow("Invalid date format");
  });

  it("returns null when no previous date exists", async () => {
    mockExecute.mockResolvedValue({ rows: [{ result_date: null }] });
    const result = await getPreviousTradeDate("2020-01-01");
    expect(result).toBeNull();
  });
});

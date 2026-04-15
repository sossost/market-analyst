import { describe, it, expect } from "vitest";
import { validatePriceData } from "../validation.js";

describe("validatePriceData", () => {
  const validPrice = {
    symbol: "AAPL",
    date: "2026-04-03",
    open: 150,
    high: 155,
    low: 148,
    close: 153,
    volume: 1000000,
  };

  it("passes for valid weekday price data", () => {
    const result = validatePriceData(validPrice);
    expect(result.isValid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns on Saturday date", () => {
    const result = validatePriceData({ ...validPrice, date: "2026-04-04" });
    expect(result.isValid).toBe(true);
    expect(result.warnings).toContain("Weekend date detected: 2026-04-04");
  });

  it("warns on Sunday date", () => {
    const result = validatePriceData({ ...validPrice, date: "2026-04-05" });
    expect(result.isValid).toBe(true);
    expect(result.warnings).toContain("Weekend date detected: 2026-04-05");
  });

  it("does not warn on Friday date", () => {
    const result = validatePriceData({ ...validPrice, date: "2026-04-03" });
    expect(result.warnings.filter((w) => w.includes("Weekend"))).toHaveLength(0);
  });

  it("fails on missing symbol", () => {
    const result = validatePriceData({ ...validPrice, symbol: "" });
    expect(result.isValid).toBe(false);
  });

  it("fails on invalid date format", () => {
    const result = validatePriceData({ ...validPrice, date: "04-03-2026" });
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.stringContaining("Invalid date format")]),
    );
  });

  it("fails when high < low", () => {
    const result = validatePriceData({ ...validPrice, high: 100, low: 200 });
    expect(result.isValid).toBe(false);
  });
});

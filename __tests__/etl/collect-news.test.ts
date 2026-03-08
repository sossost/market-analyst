import { describe, it, expect } from "vitest";
import { parseAge } from "@/etl/jobs/collect-news";

describe("parseAge", () => {
  it("returns null for undefined", () => {
    expect(parseAge(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseAge("")).toBeNull();
  });

  it("returns null for unparseable format", () => {
    expect(parseAge("yesterday")).toBeNull();
  });

  it("returns null for non-matching pattern", () => {
    expect(parseAge("about 2 hours ago")).toBeNull();
  });

  it("parses hours ago", () => {
    const result = parseAge("2 hours ago");
    expect(result).not.toBeNull();

    const parsed = new Date(result!);
    const diff = Date.now() - parsed.getTime();
    // Allow 5 second tolerance for test execution time
    const TWO_HOURS_MS = 2 * 3_600_000;
    const TOLERANCE_MS = 5_000;
    expect(diff).toBeGreaterThanOrEqual(TWO_HOURS_MS - TOLERANCE_MS);
    expect(diff).toBeLessThanOrEqual(TWO_HOURS_MS + TOLERANCE_MS);
  });

  it("parses singular unit (1 hour ago)", () => {
    const result = parseAge("1 hour ago");
    expect(result).not.toBeNull();

    const parsed = new Date(result!);
    const diff = Date.now() - parsed.getTime();
    const ONE_HOUR_MS = 3_600_000;
    const TOLERANCE_MS = 5_000;
    expect(diff).toBeGreaterThanOrEqual(ONE_HOUR_MS - TOLERANCE_MS);
    expect(diff).toBeLessThanOrEqual(ONE_HOUR_MS + TOLERANCE_MS);
  });

  it("parses days ago", () => {
    const result = parseAge("3 days ago");
    expect(result).not.toBeNull();

    const parsed = new Date(result!);
    const diff = Date.now() - parsed.getTime();
    const THREE_DAYS_MS = 3 * 86_400_000;
    const TOLERANCE_MS = 5_000;
    expect(diff).toBeGreaterThanOrEqual(THREE_DAYS_MS - TOLERANCE_MS);
    expect(diff).toBeLessThanOrEqual(THREE_DAYS_MS + TOLERANCE_MS);
  });

  it("parses minutes ago", () => {
    const result = parseAge("30 minutes ago");
    expect(result).not.toBeNull();

    const parsed = new Date(result!);
    const diff = Date.now() - parsed.getTime();
    const THIRTY_MINUTES_MS = 30 * 60_000;
    const TOLERANCE_MS = 5_000;
    expect(diff).toBeGreaterThanOrEqual(THIRTY_MINUTES_MS - TOLERANCE_MS);
    expect(diff).toBeLessThanOrEqual(THIRTY_MINUTES_MS + TOLERANCE_MS);
  });

  it("parses seconds ago", () => {
    const result = parseAge("45 seconds ago");
    expect(result).not.toBeNull();

    const parsed = new Date(result!);
    const diff = Date.now() - parsed.getTime();
    const FORTY_FIVE_SECONDS_MS = 45_000;
    const TOLERANCE_MS = 5_000;
    expect(diff).toBeGreaterThanOrEqual(FORTY_FIVE_SECONDS_MS - TOLERANCE_MS);
    expect(diff).toBeLessThanOrEqual(FORTY_FIVE_SECONDS_MS + TOLERANCE_MS);
  });

  it("parses weeks ago", () => {
    const result = parseAge("1 week ago");
    expect(result).not.toBeNull();

    const parsed = new Date(result!);
    const diff = Date.now() - parsed.getTime();
    const ONE_WEEK_MS = 604_800_000;
    const TOLERANCE_MS = 5_000;
    expect(diff).toBeGreaterThanOrEqual(ONE_WEEK_MS - TOLERANCE_MS);
    expect(diff).toBeLessThanOrEqual(ONE_WEEK_MS + TOLERANCE_MS);
  });

  it("returns valid ISO string", () => {
    const result = parseAge("5 hours ago");
    expect(result).not.toBeNull();
    expect(() => new Date(result!)).not.toThrow();
    expect(new Date(result!).toISOString()).toBe(result);
  });
});

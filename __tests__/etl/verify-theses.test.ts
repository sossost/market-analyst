import { describe, it, expect } from "vitest";

/**
 * Thesis 검증 로직의 핵심: timeframe 만료 판정.
 * DB 의존 없이 순수 로직만 테스트.
 */
function isThesisExpired(
  debateDate: string,
  timeframeDays: number,
  today: string,
): boolean {
  const debate = new Date(debateDate);
  const expiry = new Date(debate);
  expiry.setDate(expiry.getDate() + timeframeDays);
  return new Date(today) >= expiry;
}

describe("verify-theses logic", () => {
  it("thesis is not expired within timeframe", () => {
    expect(isThesisExpired("2026-03-01", 30, "2026-03-15")).toBe(false);
  });

  it("thesis is expired exactly at timeframe boundary", () => {
    expect(isThesisExpired("2026-03-01", 30, "2026-03-31")).toBe(true);
  });

  it("thesis is expired after timeframe", () => {
    expect(isThesisExpired("2026-01-01", 60, "2026-03-15")).toBe(true);
  });

  it("90-day thesis is not expired at day 89", () => {
    expect(isThesisExpired("2026-01-01", 90, "2026-03-31")).toBe(false);
  });

  it("90-day thesis is expired at day 90", () => {
    expect(isThesisExpired("2026-01-01", 90, "2026-04-01")).toBe(true);
  });
});

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

/**
 * 진행률 50%+ 안전망 판정 로직 (#810).
 * expireStalledTheses의 SQL 조건을 JS로 재현.
 */
function isThesisStalled(
  debateDate: string,
  timeframeDays: number,
  today: string,
  progressThreshold: number = 0.5,
): boolean {
  const debate = new Date(debateDate);
  const todayDate = new Date(today);

  // 진행률 >= threshold
  const stalledDate = new Date(debate);
  stalledDate.setDate(stalledDate.getDate() + Math.floor(timeframeDays * progressThreshold));
  const isStalled = todayDate >= stalledDate;

  // timeframe 미초과 (초과분은 expireStaleTheses가 처리)
  const expiryDate = new Date(debate);
  expiryDate.setDate(expiryDate.getDate() + timeframeDays);
  const isNotExpired = todayDate < expiryDate;

  return isStalled && isNotExpired;
}

describe("verify-theses logic", () => {
  describe("timeframe 만료 판정", () => {
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

  describe("50% 안전망 판정 (#810)", () => {
    it("90일 thesis — 44일째(49%)는 안전망 미해당", () => {
      // 2026-03-05 + 44일 = 2026-04-18
      expect(isThesisStalled("2026-03-05", 90, "2026-04-18")).toBe(false);
    });

    it("90일 thesis — 45일째(50%)는 안전망 해당", () => {
      // 2026-03-05 + 45일 = 2026-04-19
      expect(isThesisStalled("2026-03-05", 90, "2026-04-19")).toBe(true);
    });

    it("30일 thesis — 15일째(50%)는 안전망 해당", () => {
      expect(isThesisStalled("2026-03-01", 30, "2026-03-16")).toBe(true);
    });

    it("60일 thesis — 29일째(48%)는 안전망 미해당", () => {
      expect(isThesisStalled("2026-03-01", 60, "2026-03-30")).toBe(false);
    });

    it("60일 thesis — 30일째(50%)는 안전망 해당", () => {
      expect(isThesisStalled("2026-03-01", 60, "2026-03-31")).toBe(true);
    });

    it("timeframe 100% 초과 시 안전망 미해당 (expireStaleTheses가 처리)", () => {
      // 90일 thesis가 91일째 → timeframe 초과이므로 안전망 대상 아님
      expect(isThesisStalled("2026-01-01", 90, "2026-04-02")).toBe(false);
    });

    it("issue #810 시나리오: thesis #7 (90일, 2026-03-05 생성)", () => {
      // 2026-04-15 (41일째) — 아직 50% 미달
      expect(isThesisStalled("2026-03-05", 90, "2026-04-15")).toBe(false);
      expect(isThesisExpired("2026-03-05", 90, "2026-04-15")).toBe(false);

      // 2026-04-19 (45일째) — 50% 안전망 해당
      expect(isThesisStalled("2026-03-05", 90, "2026-04-19")).toBe(true);

      // 2026-06-03 (90일째) — timeframe 만료
      expect(isThesisExpired("2026-03-05", 90, "2026-06-03")).toBe(true);
      expect(isThesisStalled("2026-03-05", 90, "2026-06-03")).toBe(false); // expireStaleTheses가 처리
    });
  });
});

import { describe, it, expect } from "vitest";
import { resolvePortfolioTier } from "../run-weekly-agent";
import { FEATURED_MIN_RS_SCORE } from "@/tools/validation";

describe("resolvePortfolioTier", () => {
  it("FEATURED_MIN_RS_SCORE는 70이다", () => {
    expect(FEATURED_MIN_RS_SCORE).toBe(70);
  });

  // ── standard 요청은 항상 통과 ──

  it("standard 요청은 RS와 무관하게 standard 반환", () => {
    expect(resolvePortfolioTier("standard", 50)).toBe("standard");
    expect(resolvePortfolioTier("standard", 80)).toBe("standard");
    expect(resolvePortfolioTier("standard", null)).toBe("standard");
  });

  // ── featured 요청 + RS 70 이상 → featured 유지 ──

  it("featured + RS 70 → featured 유지", () => {
    expect(resolvePortfolioTier("featured", 70)).toBe("featured");
  });

  it("featured + RS 95 → featured 유지", () => {
    expect(resolvePortfolioTier("featured", 95)).toBe("featured");
  });

  // ── featured 요청 + RS 70 미만 → standard 다운그레이드 ──

  it("featured + RS 69 → standard 다운그레이드", () => {
    expect(resolvePortfolioTier("featured", 69)).toBe("standard");
  });

  it("featured + RS 60 → standard 다운그레이드", () => {
    expect(resolvePortfolioTier("featured", 60)).toBe("standard");
  });

  // ── featured 요청 + RS null/undefined → standard 다운그레이드 ──

  it("featured + RS null → standard 다운그레이드", () => {
    expect(resolvePortfolioTier("featured", null)).toBe("standard");
  });

  it("featured + RS undefined → standard 다운그레이드", () => {
    expect(resolvePortfolioTier("featured", undefined)).toBe("standard");
  });
});

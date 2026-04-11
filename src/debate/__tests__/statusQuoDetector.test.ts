/**
 * statusQuoDetector 단위 테스트 (#733).
 *
 * 검증 항목:
 *   1. targetCondition이 이미 충족 → true (status_quo)
 *   2. targetCondition이 미충족 → false (변화 예측)
 *   3. 파싱 불가 조건 → false (보수적: non-status_quo)
 *   4. 메트릭 미발견 → false
 *   5. 섹터 RS 조건 — 이미 충족 케이스
 *   6. 섹터 RS 조건 — 미충족 케이스
 *   7. Fear & Greed 조건 — 이미 충족 케이스
 *   8. 경계값 — 정확히 같은 값 (> vs >=)
 */

import { describe, it, expect } from "vitest";
import { detectStatusQuo } from "../statusQuoDetector.js";
import type { MarketSnapshot } from "../marketDataLoader.js";

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

function makeSnapshot(
  sectors: Array<{ sector: string; avgRs: number }> = [],
  overrides?: { fearGreedScore?: number; spClose?: number },
): MarketSnapshot {
  return {
    date: "2026-03-16",
    indices: [
      { name: "S&P 500", close: overrides?.spClose ?? 5800, changePercent: 0.5 },
      { name: "NASDAQ", close: 18000, changePercent: 0.8 },
      { name: "VIX", close: 18, changePercent: -1.2 },
    ],
    sectors: sectors.map((s) => ({
      sector: s.sector,
      avgRs: s.avgRs,
      rsRank: 1,
      groupPhase: 2,
      prevGroupPhase: null,
      change4w: null,
      change12w: null,
      phase2Ratio: 0.5,
      phase1to2Count5d: 0,
    })),
    newPhase2Stocks: [],
    topPhase2Stocks: [],
    breadth: null,
    fearGreed: {
      score: overrides?.fearGreedScore ?? 55,
      rating: "Neutral",
      previousClose: 50,
      previous1Week: 48,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("detectStatusQuo", () => {
  it("S&P 500 > 5500 — 현재 5800이면 status_quo", () => {
    const snapshot = makeSnapshot();
    expect(detectStatusQuo("S&P 500 > 5500", snapshot)).toBe(true);
  });

  it("S&P 500 > 6000 — 현재 5800이면 non-status_quo", () => {
    const snapshot = makeSnapshot();
    expect(detectStatusQuo("S&P 500 > 6000", snapshot)).toBe(false);
  });

  it("파싱 불가 조건 → false (보수적 판정)", () => {
    const snapshot = makeSnapshot();
    expect(detectStatusQuo("금리 인하 25bp 이상", snapshot)).toBe(false);
  });

  it("메트릭 미발견 → false", () => {
    const snapshot = makeSnapshot();
    expect(detectStatusQuo("Unknown Metric > 100", snapshot)).toBe(false);
  });

  it("섹터 RS — Energy RS > 65, 현재 70이면 status_quo", () => {
    const snapshot = makeSnapshot([{ sector: "Energy", avgRs: 70 }]);
    expect(detectStatusQuo("Energy RS > 65", snapshot)).toBe(true);
  });

  it("섹터 RS — Technology RS > 60, 현재 45이면 non-status_quo", () => {
    const snapshot = makeSnapshot([{ sector: "Technology", avgRs: 45 }]);
    expect(detectStatusQuo("Technology RS > 60", snapshot)).toBe(false);
  });

  it("Fear & Greed < 25 — 현재 15이면 status_quo", () => {
    const snapshot = makeSnapshot([], { fearGreedScore: 15 });
    expect(detectStatusQuo("Fear & Greed < 25", snapshot)).toBe(true);
  });

  it("Fear & Greed < 25 — 현재 55이면 non-status_quo", () => {
    const snapshot = makeSnapshot([], { fearGreedScore: 55 });
    expect(detectStatusQuo("Fear & Greed < 25", snapshot)).toBe(false);
  });

  it("경계값 — S&P 500 > 5800, 현재 5800이면 non-status_quo (> not >=)", () => {
    const snapshot = makeSnapshot([], { spClose: 5800 });
    expect(detectStatusQuo("S&P 500 > 5800", snapshot)).toBe(false);
  });

  it("경계값 — S&P 500 >= 5800, 현재 5800이면 status_quo", () => {
    const snapshot = makeSnapshot([], { spClose: 5800 });
    expect(detectStatusQuo("S&P 500 >= 5800", snapshot)).toBe(true);
  });

  it("Technology RS <= 50 — 현재 45이면 status_quo", () => {
    const snapshot = makeSnapshot([{ sector: "Technology", avgRs: 45 }]);
    expect(detectStatusQuo("Technology RS <= 50", snapshot)).toBe(true);
  });

  it("Technology RS <= 50 — 현재 55이면 non-status_quo", () => {
    const snapshot = makeSnapshot([{ sector: "Technology", avgRs: 55 }]);
    expect(detectStatusQuo("Technology RS <= 50", snapshot)).toBe(false);
  });
});

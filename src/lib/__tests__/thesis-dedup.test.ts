import { describe, it, expect } from "vitest";
import {
  buildConditionKey,
  getDedupedCounts,
  deduplicateTheses,
  getDedupedHitMiss,
} from "@/lib/thesis-dedup";

// ── buildConditionKey ──

describe("buildConditionKey", () => {
  it("정규화된 metric + condition 결합", () => {
    expect(buildConditionKey("Technology RS", "> 50")).toBe("Technology RS::> 50");
  });

  it("Tech RS → Technology RS로 metric 정규화", () => {
    expect(buildConditionKey("Tech RS", "> 50")).toBe("Technology RS::> 50");
  });

  it("condition 공백 정규화", () => {
    expect(buildConditionKey("Technology RS", ">  50")).toBe("Technology RS::> 50");
  });

  it("condition 대소문자 정규화", () => {
    expect(buildConditionKey("S&P 500", "Above 5800")).toBe("S&P 500::above 5800");
  });

  it("SPX → S&P 500 별칭 적용", () => {
    expect(buildConditionKey("SPX", "> 5800")).toBe("S&P 500::> 5800");
  });
});

// ── getDedupedCounts ──

describe("getDedupedCounts", () => {
  it("중복 없는 경우 — 원래 카운트 유지", () => {
    const theses = [
      { verificationMetric: "Technology RS", targetCondition: "> 50", status: "CONFIRMED" },
      { verificationMetric: "S&P 500", targetCondition: "> 5800", status: "INVALIDATED" },
      { verificationMetric: "VIX", targetCondition: "< 20", status: "EXPIRED" },
    ];
    expect(getDedupedCounts(theses)).toEqual({ confirmed: 1, invalidated: 1, expired: 1 });
  });

  it("동일 조건 8건 CONFIRMED → 1건으로 보정 (#911 핵심 케이스)", () => {
    const theses = Array.from({ length: 8 }, () => ({
      verificationMetric: "Technology RS",
      targetCondition: "> 50",
      status: "CONFIRMED",
    }));
    // 1건의 다른 조건 추가
    theses.push({
      verificationMetric: "S&P 500",
      targetCondition: "> 5800",
      status: "CONFIRMED",
    });
    expect(getDedupedCounts(theses)).toEqual({ confirmed: 2, invalidated: 0, expired: 0 });
  });

  it("동일 조건 내 CONFIRMED + INVALIDATED → CONFIRMED 우선", () => {
    const theses = [
      { verificationMetric: "Technology RS", targetCondition: "> 50", status: "CONFIRMED" },
      { verificationMetric: "Technology RS", targetCondition: "> 50", status: "INVALIDATED" },
    ];
    expect(getDedupedCounts(theses)).toEqual({ confirmed: 1, invalidated: 0, expired: 0 });
  });

  it("동일 조건 내 INVALIDATED + EXPIRED → INVALIDATED 우선", () => {
    const theses = [
      { verificationMetric: "Technology RS", targetCondition: "> 50", status: "INVALIDATED" },
      { verificationMetric: "Technology RS", targetCondition: "> 50", status: "EXPIRED" },
    ];
    expect(getDedupedCounts(theses)).toEqual({ confirmed: 0, invalidated: 1, expired: 0 });
  });

  it("ACTIVE thesis는 무시", () => {
    const theses = [
      { verificationMetric: "Technology RS", targetCondition: "> 50", status: "ACTIVE" },
      { verificationMetric: "Technology RS", targetCondition: "> 50", status: "CONFIRMED" },
    ];
    expect(getDedupedCounts(theses)).toEqual({ confirmed: 1, invalidated: 0, expired: 0 });
  });

  it("빈 배열 → 모두 0", () => {
    expect(getDedupedCounts([])).toEqual({ confirmed: 0, invalidated: 0, expired: 0 });
  });

  it("metric 별칭이 다르지만 동일 지표 → 1건으로 보정", () => {
    const theses = [
      { verificationMetric: "Tech RS", targetCondition: "> 50", status: "CONFIRMED" },
      { verificationMetric: "Technology RS", targetCondition: "> 50", status: "CONFIRMED" },
      { verificationMetric: "Information Technology RS", targetCondition: "> 50", status: "CONFIRMED" },
    ];
    expect(getDedupedCounts(theses)).toEqual({ confirmed: 1, invalidated: 0, expired: 0 });
  });

  it("같은 metric 다른 condition → 별도 카운트", () => {
    const theses = [
      { verificationMetric: "Technology RS", targetCondition: "> 50", status: "CONFIRMED" },
      { verificationMetric: "Technology RS", targetCondition: "> 60", status: "CONFIRMED" },
    ];
    expect(getDedupedCounts(theses)).toEqual({ confirmed: 2, invalidated: 0, expired: 0 });
  });

  it("이슈 #911 시나리오 — tech 적중률 보정", () => {
    // 8건 동일 조건 CONFIRMED + 7건 다른 조건 CONFIRMED + 1건 INVALIDATED
    const theses = [
      // 동일 조건 8건
      ...Array.from({ length: 8 }, () => ({
        verificationMetric: "Technology RS",
        targetCondition: "> 50",
        status: "CONFIRMED",
      })),
      // 다른 조건 7건 CONFIRMED
      ...Array.from({ length: 7 }, (_, i) => ({
        verificationMetric: `Metric ${i}`,
        targetCondition: `> ${i * 10}`,
        status: "CONFIRMED",
      })),
      // 1건 INVALIDATED
      { verificationMetric: "VIX", targetCondition: "< 20", status: "INVALIDATED" },
    ];
    // 중복 보정: 8건→1건 + 7건 = 8 CONFIRMED, 1 INVALIDATED
    // hitRate = 8 / 9 ≈ 88.9%
    const result = getDedupedCounts(theses);
    expect(result.confirmed).toBe(8);
    expect(result.invalidated).toBe(1);
    expect(result.expired).toBe(0);
  });
});

// ── deduplicateTheses ──

describe("deduplicateTheses", () => {
  it("동일 조건 3건 → 1건 대표만 남김", () => {
    const theses = [
      { verificationMetric: "Technology RS", targetCondition: "> 50", status: "CONFIRMED" },
      { verificationMetric: "Technology RS", targetCondition: "> 50", status: "CONFIRMED" },
      { verificationMetric: "Technology RS", targetCondition: "> 50", status: "CONFIRMED" },
    ];
    expect(deduplicateTheses(theses)).toHaveLength(1);
    expect(deduplicateTheses(theses)[0].status).toBe("CONFIRMED");
  });

  it("대표 선정 시 CONFIRMED 우선", () => {
    const theses = [
      { verificationMetric: "Technology RS", targetCondition: "> 50", status: "EXPIRED" },
      { verificationMetric: "Technology RS", targetCondition: "> 50", status: "CONFIRMED" },
    ];
    expect(deduplicateTheses(theses)[0].status).toBe("CONFIRMED");
  });

  it("ACTIVE thesis 제외", () => {
    const theses = [
      { verificationMetric: "Technology RS", targetCondition: "> 50", status: "ACTIVE" },
      { verificationMetric: "Technology RS", targetCondition: "> 50", status: "CONFIRMED" },
    ];
    expect(deduplicateTheses(theses)).toHaveLength(1);
  });
});

// ── getDedupedHitMiss ──

describe("getDedupedHitMiss", () => {
  function makeThesisMap(entries: Array<{ id: number; metric: string; condition: string; status: string }>) {
    return new Map(
      entries.map((e) => [e.id, {
        id: e.id,
        verificationMetric: e.metric,
        targetCondition: e.condition,
        status: e.status,
      }]),
    );
  }

  it("동일 조건 3건 CONFIRMED → 1 hit", () => {
    const thesisMap = makeThesisMap([
      { id: 1, metric: "Technology RS", condition: "> 50", status: "CONFIRMED" },
      { id: 2, metric: "Technology RS", condition: "> 50", status: "CONFIRMED" },
      { id: 3, metric: "Technology RS", condition: "> 50", status: "CONFIRMED" },
    ]);
    expect(getDedupedHitMiss([1, 2, 3], thesisMap)).toEqual({ hits: 1, misses: 0 });
  });

  it("다른 조건 2건 CONFIRMED + 1건 INVALIDATED → 2 hits, 1 miss", () => {
    const thesisMap = makeThesisMap([
      { id: 1, metric: "Technology RS", condition: "> 50", status: "CONFIRMED" },
      { id: 2, metric: "S&P 500", condition: "> 5800", status: "CONFIRMED" },
      { id: 3, metric: "VIX", condition: "< 20", status: "INVALIDATED" },
    ]);
    expect(getDedupedHitMiss([1, 2, 3], thesisMap)).toEqual({ hits: 2, misses: 1 });
  });

  it("sourceIds에 없는 thesis는 무시", () => {
    const thesisMap = makeThesisMap([
      { id: 1, metric: "Technology RS", condition: "> 50", status: "CONFIRMED" },
    ]);
    expect(getDedupedHitMiss([1, 999], thesisMap)).toEqual({ hits: 1, misses: 0 });
  });

  it("EXPIRED thesis는 hit/miss에서 제외", () => {
    const thesisMap = makeThesisMap([
      { id: 1, metric: "Technology RS", condition: "> 50", status: "EXPIRED" },
    ]);
    expect(getDedupedHitMiss([1], thesisMap)).toEqual({ hits: 0, misses: 0 });
  });

  it("같은 조건 CONFIRMED + INVALIDATED → CONFIRMED 우선 (1 hit)", () => {
    const thesisMap = makeThesisMap([
      { id: 1, metric: "Technology RS", condition: "> 50", status: "CONFIRMED" },
      { id: 2, metric: "Technology RS", condition: "> 50", status: "INVALIDATED" },
    ]);
    expect(getDedupedHitMiss([1, 2], thesisMap)).toEqual({ hits: 1, misses: 0 });
  });
});

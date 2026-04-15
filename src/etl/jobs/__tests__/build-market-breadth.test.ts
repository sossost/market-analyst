import { describe, it, expect, vi } from "vitest";
import {
  computePercentileRank,
  computeBreadthScore,
  computeBreadthScoreV2,
  computeDivergenceSignal,
} from "../build-market-breadth.js";

// DB 의존성 mock (buildMarketBreadth import 시 pool/db 초기화 방지)
vi.mock("@/db/client", () => ({
  db: { insert: vi.fn(), $client: { end: vi.fn() } },
  pool: { query: vi.fn(), end: vi.fn() },
}));
vi.mock("dotenv/config", () => ({}));

// ────────────────────────────────────────────
// computePercentileRank
// ────────────────────────────────────────────
describe("computePercentileRank", () => {
  it("빈 배열이면 중립값 50을 반환한다", () => {
    expect(computePercentileRank(30, [])).toBe(50);
  });

  it("null만 포함된 배열이면 중립값 50을 반환한다", () => {
    expect(computePercentileRank(30, [null, null, null])).toBe(50);
  });

  it("value가 window 최솟값이면 0을 초과하는 퍼센타일을 반환한다 (자기 자신 포함)", () => {
    // [10, 20, 30, 40, 50] 에서 10 이하는 1개 → 1/5 × 100 = 20
    expect(computePercentileRank(10, [10, 20, 30, 40, 50])).toBe(20);
  });

  it("value가 window 최댓값이면 100을 반환한다", () => {
    // [10, 20, 30, 40, 50] 에서 50 이하는 5개 → 5/5 × 100 = 100
    expect(computePercentileRank(50, [10, 20, 30, 40, 50])).toBe(100);
  });

  it("window 중앙값이면 약 50 퍼센타일을 반환한다", () => {
    // [10, 20, 30, 40, 50] 에서 30 이하는 3개 → 3/5 × 100 = 60
    expect(computePercentileRank(30, [10, 20, 30, 40, 50])).toBe(60);
  });

  it("null을 포함한 배열에서 null을 무시하고 계산한다", () => {
    // null 제거 → [10, 30, 50], 30 이하 2개 → 2/3 × 100 ≈ 66.67
    const result = computePercentileRank(30, [10, null, 30, null, 50]);
    expect(result).toBeCloseTo(66.67, 1);
  });

  it("window에 없는 값(범위 밖)도 올바르게 계산한다", () => {
    // [10, 20, 30] 에서 0 이하는 0개 → 0/3 × 100 = 0
    expect(computePercentileRank(0, [10, 20, 30])).toBe(0);
  });
});

// ────────────────────────────────────────────
// computeBreadthScore
// ────────────────────────────────────────────
describe("computeBreadthScore", () => {
  const makeWindow = (overrides: Partial<{
    phase2Ratios: (number | null)[];
    adRatios:     (number | null)[];
    hlRatios:     (number | null)[];
    marketAvgRs:  (number | null)[];
    fearGreedScores: (number | null)[];
    breadthScores:   (number | null)[];
  }> = {}) => ({
    phase2Ratios:    [20, 30, 40, 50, 60],
    adRatios:        [0.5, 1.0, 1.5, 2.0, 2.5],
    hlRatios:        [0.5, 1.0, 1.5, 2.0, 2.5],
    marketAvgRs:     [40, 50, 60, 70, 80],
    fearGreedScores: [20, 40, 60, 80, 90],
    breadthScores:   [30, 40, 50, 60, 70],
    ...overrides,
  });

  it("fear_greed가 있을 때 가중치 합이 1이 되어 점수를 계산한다", () => {
    // window = [20,30,40,50,60] 에서 50은 4/5 이하 → phase2Pct=80%
    // window = [0.5,1.0,1.5,2.0,2.5] 에서 1.5는 3/5 이하 → adPct=hlPct=60%
    // window = [40,50,60,70,80] 에서 60은 3/5 이하 → rsPct=60%
    // fearGreedScore=60 → 그대로 사용
    // score = 80×0.35 + 60×0.20 + 60×0.20 + 60×0.15 + 60×0.10
    //       = 28 + 12 + 12 + 9 + 6 = 67
    const current = {
      phase2Ratio:    50,
      adRatio:        1.5,
      hlRatio:        1.5,
      marketAvgRs:    60,
      fearGreedScore: 60,
    };
    const score = computeBreadthScore(current, makeWindow());
    expect(score).toBeCloseTo(67, 1);
  });

  it("fear_greed가 null이면 나머지 4개 가중치를 재정규화하여 계산한다", () => {
    // phase2Pct=80%, adPct=60%, hlPct=60%, rsPct=60%
    // score = 80×0.4375 + 60×0.25 + 60×0.1875 + 60×0.125
    //       = 35 + 15 + 11.25 + 7.5 = 68.75
    const current = {
      phase2Ratio:    50,
      adRatio:        1.5,
      hlRatio:        1.5,
      marketAvgRs:    60,
      fearGreedScore: null,
    };
    const score = computeBreadthScore(current, makeWindow());
    expect(score).toBeCloseTo(68.75, 1);
  });

  it("결과는 0 미만으로 내려가지 않는다 (하단 클램핑)", () => {
    const current = {
      phase2Ratio:    0,
      adRatio:        0,
      hlRatio:        0,
      marketAvgRs:    0,
      fearGreedScore: 0,
    };
    // 모든 퍼센타일 = 0이므로 score = 0
    const score = computeBreadthScore(current, makeWindow());
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("결과는 100을 초과하지 않는다 (상단 클램핑)", () => {
    const current = {
      phase2Ratio:    100,
      adRatio:        100,
      hlRatio:        100,
      marketAvgRs:    100,
      fearGreedScore: 100,
    };
    const score = computeBreadthScore(current, makeWindow());
    expect(score).toBeLessThanOrEqual(100);
  });

  it("소수점 2자리로 반올림한다", () => {
    const score = computeBreadthScore(
      { phase2Ratio: 35, adRatio: 1.2, hlRatio: 1.3, marketAvgRs: 55, fearGreedScore: 45 },
      makeWindow(),
    );
    const decimal = score.toString().split(".")[1];
    expect(decimal == null || decimal.length <= 2).toBe(true);
  });

  it("adRatio가 null이면 adPct를 50으로 대체하여 계산한다", () => {
    const baseScore = computeBreadthScore(
      { phase2Ratio: 50, adRatio: 1.5, hlRatio: 1.5, marketAvgRs: 60, fearGreedScore: 60 },
      makeWindow(),
    );
    const nullAdScore = computeBreadthScore(
      { phase2Ratio: 50, adRatio: null, hlRatio: 1.5, marketAvgRs: 60, fearGreedScore: 60 },
      makeWindow(),
    );
    // adPct=50이므로 base(60)와 다소 달라야 함 (50 vs 60)
    expect(nullAdScore).not.toBe(baseScore);
  });
});

// ────────────────────────────────────────────
// computeDivergenceSignal
// ────────────────────────────────────────────
describe("computeDivergenceSignal", () => {
  it("spx5dChange가 null이면 null을 반환한다", () => {
    expect(computeDivergenceSignal(60, [50, 51, 52, 53, 54], null)).toBeNull();
  });

  it("pastBreadthScores가 5개 미만이면 null을 반환한다", () => {
    expect(computeDivergenceSignal(60, [50, 51, 52, 53], -2)).toBeNull();
  });

  it("5일 전 값(인덱스 4)이 null이면 null을 반환한다", () => {
    expect(computeDivergenceSignal(60, [50, 51, 52, 53, null], -2)).toBeNull();
  });

  it("SPX 하락(< -1%) + BreadthScore 상승(> +3) 조합은 positive를 반환한다", () => {
    // 5일 전 score = 50, 오늘 = 60 → breadthChange = +10
    // spx5dChange = -2 (< -1)
    expect(computeDivergenceSignal(60, [55, 56, 57, 58, 50], -2)).toBe("positive");
  });

  it("SPX 상승(> +1%) + BreadthScore 하락(< -3) 조합은 negative를 반환한다", () => {
    // 5일 전 score = 70, 오늘 = 60 → breadthChange = -10
    // spx5dChange = +3 (> +1)
    expect(computeDivergenceSignal(60, [65, 64, 63, 62, 70], 3)).toBe("negative");
  });

  it("임계값을 정확히 만족해도 해당 신호를 반환한다 (경계값 exclusive 확인)", () => {
    // spx5dChange = -1 → 조건 < -1 불충족 → null
    expect(computeDivergenceSignal(60, [55, 56, 57, 58, 50], -1)).toBeNull();
  });

  it("임계값을 초과하면 신호를 반환한다", () => {
    // spx5dChange = -1.01 → 조건 < -1 충족, breadthChange = +10 > +3
    expect(computeDivergenceSignal(60, [55, 56, 57, 58, 50], -1.01)).toBe("positive");
  });

  it("조건 불충족 시 null을 반환한다", () => {
    // spx5dChange = 0 (중립)
    expect(computeDivergenceSignal(60, [55, 56, 57, 58, 55], 0)).toBeNull();
  });

  it("SPX 상승 + BreadthScore 소폭 하락(-3 이하 아님)은 null을 반환한다", () => {
    // breadthChange = -2 (> -3이므로 조건 미충족)
    expect(computeDivergenceSignal(60, [55, 56, 57, 58, 62], 2)).toBeNull();
  });
});

// ────────────────────────────────────────────
// computeBreadthScoreV2
// ────────────────────────────────────────────
describe("computeBreadthScoreV2", () => {
  // 퍼센타일 계산에 사용할 고정 window (DESC 정렬 가정)
  const makeWindow = (overrides: Partial<{
    phase2Ratios:     (number | null)[];
    phase2Momentum5d: (number | null)[];
    netPhaseFlow5d:   (number | null)[];
    adNet5d:          (number | null)[];
    vixClosePrices:   (number | null)[];
    breadthScores:    (number | null)[];
  }> = {}) => ({
    phase2Ratios:     [20, 30, 40, 50, 60],
    phase2Momentum5d: [-2, -1, 0, 1, 2],
    netPhaseFlow5d:   [-10, -5, 0, 5, 10],
    adNet5d:          [-500, -250, 0, 250, 500],
    vixClosePrices:   [10, 15, 20, 25, 30],
    breadthScores:    [30, 40, 50, 60, 70],
    ...overrides,
  });

  it("VIX가 있을 때 5개 가중치 합이 1.0이 되어 0~100 범위로 계산된다", () => {
    // phase2Ratio=50 → phase2Pct = 4/5*100 = 80
    // momentum=1(50-5dAgo=49 → 50-49=1) → phase2Momentum5d 배열에서 1 이하 4개 → 4/5*100 = 80
    // netPhaseFlow5d=5 → 5 이하 4개 → 80
    // adNet5d=250 → 4/5*100 = 80
    // vixClose=10 → vixPct = 1/5*100 = 20, 역퍼센타일 = 100-20 = 80
    // score = 80*0.30 + 80*0.20 + 80*0.20 + 80*0.15 + 80*0.15 = 80
    const current = {
      phase2Ratio:      50,
      phase2Ratio5dAgo: 49,
      netPhaseFlow5d:   5,
      adNet5d:          250,
      vixClose:         10,
    };
    const score = computeBreadthScoreV2(current, makeWindow());
    expect(score).toBeCloseTo(80, 1);
  });

  it("VIX가 null이면 나머지 4개 가중치를 재정규화하여 합이 1.0이 된다", () => {
    // 재정규화 가중치: 0.3529 + 0.2353 + 0.2353 + 0.1765 = 1.0
    // 모두 pct=80이면: 80*(0.3529+0.2353+0.2353+0.1765) = 80*1.0 = 80
    const current = {
      phase2Ratio:      50,
      phase2Ratio5dAgo: 49,
      netPhaseFlow5d:   5,
      adNet5d:          250,
      vixClose:         null,
    };
    const score = computeBreadthScoreV2(current, makeWindow());
    expect(score).toBeCloseTo(80, 1);
  });

  it("phase2Ratio5dAgo가 null이면 모멘텀 컴포넌트를 50으로 대체한다", () => {
    // phase2Ratio5dAgo=null → momentumPct=50
    // phase2Pct=80, momentumPct=50(대체), netFlowPct=80, adNetPct=80
    // vixClose=10 → vixPct=80
    // score = 80*0.30 + 50*0.20 + 80*0.20 + 80*0.15 + 80*0.15 = 24+10+16+12+12 = 74
    const current = {
      phase2Ratio:      50,
      phase2Ratio5dAgo: null,
      netPhaseFlow5d:   5,
      adNet5d:          250,
      vixClose:         10,
    };
    const score = computeBreadthScoreV2(current, makeWindow());
    expect(score).toBeCloseTo(74, 1);
  });

  it("netPhaseFlow5d가 null이면 순유입 컴포넌트를 50으로 대체한다", () => {
    // netPhaseFlow5d=null → netFlowPct=50
    // score = 80*0.30 + 80*0.20 + 50*0.20 + 80*0.15 + 80*0.15 = 24+16+10+12+12 = 74
    const current = {
      phase2Ratio:      50,
      phase2Ratio5dAgo: 49,
      netPhaseFlow5d:   null,
      adNet5d:          250,
      vixClose:         10,
    };
    const score = computeBreadthScoreV2(current, makeWindow());
    expect(score).toBeCloseTo(74, 1);
  });

  it("adNet5d가 null이면 A/D 컴포넌트를 50으로 대체한다", () => {
    // adNet5d=null → adNetPct=50
    // score = 80*0.30 + 80*0.20 + 80*0.20 + 50*0.15 + 80*0.15 = 24+16+16+7.5+12 = 75.5
    const current = {
      phase2Ratio:      50,
      phase2Ratio5dAgo: 49,
      netPhaseFlow5d:   5,
      adNet5d:          null,
      vixClose:         10,
    };
    const score = computeBreadthScoreV2(current, makeWindow());
    expect(score).toBeCloseTo(75.5, 1);
  });

  it("VIX가 높을수록(공포) 역퍼센타일이 낮아 점수에 불리하게 반영된다", () => {
    // vixClose=10(낮음) → vixPct_raw=20, 역퍼센타일=80 → 유리
    // vixClose=30(높음) → vixPct_raw=100, 역퍼센타일=0 → 불리
    const baseInput = {
      phase2Ratio:      50,
      phase2Ratio5dAgo: 49,
      netPhaseFlow5d:   5,
      adNet5d:          250,
    };
    const lowVixScore  = computeBreadthScoreV2({ ...baseInput, vixClose: 10  }, makeWindow());
    const highVixScore = computeBreadthScoreV2({ ...baseInput, vixClose: 30  }, makeWindow());
    expect(lowVixScore).toBeGreaterThan(highVixScore);
  });

  it("결과는 0 미만으로 내려가지 않는다 (하단 클램핑)", () => {
    // 모든 퍼센타일이 0이 되도록: window 최댓값보다 큰 값 / VIX=최댓값
    const current = {
      phase2Ratio:      0,
      phase2Ratio5dAgo: 100, // momentum이 가장 낮도록
      netPhaseFlow5d:   -1000,
      adNet5d:          -10000,
      vixClose:         100,  // 역퍼센타일 = 0
    };
    const score = computeBreadthScoreV2(current, makeWindow());
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("결과는 100을 초과하지 않는다 (상단 클램핑)", () => {
    // 모든 퍼센타일이 100이 되도록: window 최솟값보다 작은 값 / VIX=최솟값
    const current = {
      phase2Ratio:      100,
      phase2Ratio5dAgo: 0,    // momentum이 가장 높도록
      netPhaseFlow5d:   1000,
      adNet5d:          10000,
      vixClose:         1,    // 역퍼센타일 = 100
    };
    const score = computeBreadthScoreV2(current, makeWindow());
    expect(score).toBeLessThanOrEqual(100);
  });

  it("결과는 소수점 2자리로 반올림된다", () => {
    const current = {
      phase2Ratio:      35,
      phase2Ratio5dAgo: 33,
      netPhaseFlow5d:   3,
      adNet5d:          100,
      vixClose:         18,
    };
    const score = computeBreadthScoreV2(current, makeWindow());
    const decimal = score.toString().split(".")[1];
    expect(decimal == null || decimal.length <= 2).toBe(true);
  });

  it("phase2Momentum5d window가 빈 배열이어도 중립값(50)으로 처리된다", () => {
    // computePercentileRank가 빈 배열이면 50 반환하므로
    // momentumPct=50이 돼야 함
    const current = {
      phase2Ratio:      50,
      phase2Ratio5dAgo: 49,
      netPhaseFlow5d:   5,
      adNet5d:          250,
      vixClose:         10,
    };
    const windowWithEmptyMomentum = makeWindow({ phase2Momentum5d: [] });
    const score = computeBreadthScoreV2(current, windowWithEmptyMomentum);
    // momentumPct=50으로 대체됨
    // score = 80*0.30 + 50*0.20 + 80*0.20 + 80*0.15 + 80*0.15 = 74
    expect(score).toBeCloseTo(74, 1);
  });
});

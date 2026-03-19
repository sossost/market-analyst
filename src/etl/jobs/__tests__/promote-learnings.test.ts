import { describe, it, expect, vi } from "vitest";
import {
  BOOTSTRAP_THRESHOLD,
  COLD_START_THRESHOLD,
  GROWTH_PHASE_THRESHOLD,
  getPromotionThresholds,
  buildPromotionCandidates,
  buildCautionPrinciple,
} from "../promote-learnings.js";

// DB/외부 의존성 mock
// main()이 모듈 로드 시 즉시 실행되므로 DB 쿼리 체인을 완전히 mock한다.
// vi.mock factory는 호이스팅되므로, 외부 변수 참조는 vi.hoisted()로 선언한다.
const { mockSelect, mockUpdate, mockInsert } = vi.hoisted(() => ({
  mockSelect: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  }),
  mockUpdate: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  }),
  mockInsert: vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/db/client", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
    insert: mockInsert,
  },
  pool: { end: vi.fn() },
}));
vi.mock("dotenv/config", () => ({}));
vi.mock("@/etl/utils/validation", () => ({ assertValidEnvironment: vi.fn() }));
const { mockBinomialTest } = vi.hoisted(() => ({
  mockBinomialTest: vi.fn().mockReturnValue({ isSignificant: true, pValue: 0.01, cohenH: 0.5 }),
}));
vi.mock("@/lib/statisticalTests", () => ({
  binomialTest: mockBinomialTest,
}));
vi.mock("@/lib/biasDetector", () => ({
  detectBullBias: vi.fn().mockReturnValue({ bullRatio: 0.5, bullCount: 5, bearCount: 5, totalLearnings: 10, isSkewed: false }),
}));
vi.mock("@/agent/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── 상수 ────────────────────────────────────────────────────────────────────

describe("상수 경계값", () => {
  it("BOOTSTRAP_THRESHOLD는 2이다", () => {
    expect(BOOTSTRAP_THRESHOLD).toBe(2);
  });

  it("COLD_START_THRESHOLD는 5이다", () => {
    expect(COLD_START_THRESHOLD).toBe(5);
  });

  it("GROWTH_PHASE_THRESHOLD는 15이다", () => {
    expect(GROWTH_PHASE_THRESHOLD).toBe(15);
  });
});

// ─── getPromotionThresholds ───────────────────────────────────────────────────

describe("getPromotionThresholds", () => {
  it("활성 학습 0건(bootstrap) — 최소 기준 + binomial test 면제", () => {
    const thresholds = getPromotionThresholds(0);
    expect(thresholds).toEqual({ minHits: 2, minHitRate: 0.55, minTotal: 3, skipBinomialTest: true });
  });

  it("활성 학습 1건(bootstrap) — 최소 기준 + binomial test 면제", () => {
    const thresholds = getPromotionThresholds(1);
    expect(thresholds).toEqual({ minHits: 2, minHitRate: 0.55, minTotal: 3, skipBinomialTest: true });
  });

  it("활성 학습 BOOTSTRAP_THRESHOLD = 2건(cold start) — 완화 기준 반환", () => {
    const thresholds = getPromotionThresholds(BOOTSTRAP_THRESHOLD);
    expect(thresholds).toEqual({ minHits: 3, minHitRate: 0.60, minTotal: 5, skipBinomialTest: false });
  });

  it("활성 학습 COLD_START_THRESHOLD - 1 = 4건 — 완화 기준 반환", () => {
    const thresholds = getPromotionThresholds(COLD_START_THRESHOLD - 1);
    expect(thresholds).toEqual({ minHits: 3, minHitRate: 0.60, minTotal: 5, skipBinomialTest: false });
  });

  it("활성 학습 COLD_START_THRESHOLD = 5건 — 성장기 기준 반환", () => {
    const thresholds = getPromotionThresholds(COLD_START_THRESHOLD);
    expect(thresholds).toEqual({ minHits: 5, minHitRate: 0.65, minTotal: 8, skipBinomialTest: false });
  });

  it("활성 학습 GROWTH_PHASE_THRESHOLD - 1 = 14건 — 성장기 기준 반환", () => {
    const thresholds = getPromotionThresholds(GROWTH_PHASE_THRESHOLD - 1);
    expect(thresholds).toEqual({ minHits: 5, minHitRate: 0.65, minTotal: 8, skipBinomialTest: false });
  });

  it("활성 학습 GROWTH_PHASE_THRESHOLD = 15건 — 엄격 기준 반환", () => {
    const thresholds = getPromotionThresholds(GROWTH_PHASE_THRESHOLD);
    expect(thresholds).toEqual({ minHits: 10, minHitRate: 0.70, minTotal: 10, skipBinomialTest: false });
  });

  it("활성 학습 50건(최대) — 엄격 기준 반환", () => {
    const thresholds = getPromotionThresholds(50);
    expect(thresholds).toEqual({ minHits: 10, minHitRate: 0.70, minTotal: 10, skipBinomialTest: false });
  });
});

// ─── buildPromotionCandidates ─────────────────────────────────────────────────

function makeThesis(overrides: Partial<{
  id: number;
  agentPersona: string;
  verificationMetric: string;
  verificationMethod: string | null;
  status: string;
}>) {
  return {
    id: 1,
    agentPersona: "trend-follower",
    verificationMetric: "RS > 80",
    verificationMethod: "quantitative",
    status: "CONFIRMED",
    ticker: "AAPL",
    sectorName: "Technology",
    thesisText: "test",
    thesisType: "bullish",
    targetPrice: null,
    stopLoss: null,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    verifiedAt: null,
    ...overrides,
  };
}

describe("buildPromotionCandidates", () => {
  it("임계값 미달 — 후보 없음", () => {
    const confirmed = [makeThesis({ id: 1 })];
    const invalidated: ReturnType<typeof makeThesis>[] = [];
    const existingSourceIds = new Set<number>();

    // bootstrap: minHits=2 필요, 1개만 있으므로 탈락
    const candidates = buildPromotionCandidates(
      confirmed as never,
      invalidated as never,
      existingSourceIds,
      0, // bootstrap → minHits=2
    );

    expect(candidates).toHaveLength(0);
  });

  it("bootstrap 기준(minHits=2, minTotal=3) 충족 — binomial test 면제로 후보 생성", () => {
    const confirmed = [
      makeThesis({ id: 1 }),
      makeThesis({ id: 2 }),
    ];
    const invalidated = [makeThesis({ id: 3 })];
    const existingSourceIds = new Set<number>();

    // bootstrap (0 learnings): minHits=2, minTotal=3, skipBinomialTest=true
    const candidates = buildPromotionCandidates(
      confirmed as never,
      invalidated as never,
      existingSourceIds,
      0,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].hitCount).toBe(2);
    expect(candidates[0].missCount).toBe(1);
    expect(candidates[0].persona).toBe("trend-follower");
    expect(candidates[0].metric).toBe("RS > 80");
  });

  it("cold start 기준(minHits=3, minTotal=5) 충족 — 후보 생성", () => {
    const confirmed = [
      makeThesis({ id: 1 }),
      makeThesis({ id: 2 }),
      makeThesis({ id: 3 }),
      makeThesis({ id: 4 }),
      makeThesis({ id: 5 }),
    ];
    const invalidated: ReturnType<typeof makeThesis>[] = [];
    const existingSourceIds = new Set<number>();

    const candidates = buildPromotionCandidates(
      confirmed as never,
      invalidated as never,
      existingSourceIds,
      3, // cold start (2~4) → minHits=3
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].hitCount).toBe(5);
    expect(candidates[0].missCount).toBe(0);
    expect(candidates[0].persona).toBe("trend-follower");
    expect(candidates[0].metric).toBe("RS > 80");
  });

  it("기존 sourceThesisIds에 포함된 thesis는 후보에서 제외", () => {
    const confirmed = [
      makeThesis({ id: 1 }),
      makeThesis({ id: 2 }),
      makeThesis({ id: 3 }),
      makeThesis({ id: 4 }),
      makeThesis({ id: 5 }),
    ];
    const existingSourceIds = new Set<number>([1, 2, 3, 4, 5]);

    const candidates = buildPromotionCandidates(
      confirmed as never,
      [] as never,
      existingSourceIds,
      0,
    );

    expect(candidates).toHaveLength(0);
  });

  it("activeLearningCount 기본값 0 — bootstrap 기준 적용", () => {
    const confirmed = [
      makeThesis({ id: 1 }),
      makeThesis({ id: 2 }),
      makeThesis({ id: 3 }),
    ];
    // activeLearningCount 파라미터 생략 → 기본값 0 → bootstrap
    const candidates = buildPromotionCandidates(
      confirmed as never,
      [] as never,
      new Set<number>(),
    );

    expect(candidates).toHaveLength(1);
  });

  it("bootstrap 단계에서 binomial test 실패해도 후보가 통과한다", () => {
    // binomial test가 not significant를 반환하도록 설정
    mockBinomialTest.mockReturnValueOnce({ isSignificant: false, pValue: 0.5, cohenH: 0.1 });

    const confirmed = [
      makeThesis({ id: 10 }),
      makeThesis({ id: 11 }),
    ];
    const invalidated = [makeThesis({ id: 12 })];

    // bootstrap (0 learnings) → skipBinomialTest=true
    const candidates = buildPromotionCandidates(
      confirmed as never,
      invalidated as never,
      new Set<number>(),
      0,
    );

    // binomial test가 not significant이지만 bootstrap이므로 통과
    expect(candidates).toHaveLength(1);
  });

  it("cold start 단계에서 binomial test 실패하면 후보가 탈락한다", () => {
    mockBinomialTest.mockReturnValueOnce({ isSignificant: false, pValue: 0.5, cohenH: 0.1 });

    const confirmed = [
      makeThesis({ id: 20 }),
      makeThesis({ id: 21 }),
      makeThesis({ id: 22 }),
      makeThesis({ id: 23 }),
      makeThesis({ id: 24 }),
    ];

    // cold start (3 learnings) → skipBinomialTest=false
    const candidates = buildPromotionCandidates(
      confirmed as never,
      [] as never,
      new Set<number>(),
      3,
    );

    // binomial test not significant → 탈락
    expect(candidates).toHaveLength(0);
  });
});

// ─── buildCautionPrinciple ────────────────────────────────────────────────────

describe("buildCautionPrinciple", () => {
  it("패턴명, 실패율, 관측수를 포함한 원칙 문자열 반환", () => {
    const result = buildCautionPrinciple("volume_drop", 0.75, 20);
    expect(result).toContain("[경계]");
    expect(result).toContain("volume_drop");
    expect(result).toContain("75%");
    expect(result).toContain("20회 관측");
  });

  it("실패율 0%도 정상 처리", () => {
    const result = buildCautionPrinciple("no_failure", 0, 10);
    expect(result).toContain("0%");
    expect(result).toContain("10회 관측");
  });
});

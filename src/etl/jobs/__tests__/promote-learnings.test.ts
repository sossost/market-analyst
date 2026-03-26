import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  BOOTSTRAP_THRESHOLD,
  COLD_START_THRESHOLD,
  GROWTH_PHASE_THRESHOLD,
  MIN_MATURATION_HITS,
  getPromotionThresholds,
  buildPromotionCandidates,
  buildCautionPrinciple,
  normalizeMetricKey,
  demoteImmatureLearnings,
  absorbNewTheses,
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
vi.mock("@/lib/logger", () => ({
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
    expect(thresholds).toEqual({ minHits: 1, minHitRate: 0.55, minTotal: 1, skipBinomialTest: true });
  });

  it("활성 학습 1건(bootstrap) — 최소 기준 + binomial test 면제", () => {
    const thresholds = getPromotionThresholds(1);
    expect(thresholds).toEqual({ minHits: 1, minHitRate: 0.55, minTotal: 1, skipBinomialTest: true });
  });

  it("활성 학습 BOOTSTRAP_THRESHOLD = 2건(cold start) — binomial 면제 + minTotal=2 반환", () => {
    const thresholds = getPromotionThresholds(BOOTSTRAP_THRESHOLD);
    expect(thresholds).toEqual({ minHits: 2, minHitRate: 0.55, minTotal: 2, skipBinomialTest: true });
  });

  it("활성 학습 COLD_START_THRESHOLD - 1 = 4건 — binomial 면제 + minTotal=2 반환", () => {
    const thresholds = getPromotionThresholds(COLD_START_THRESHOLD - 1);
    expect(thresholds).toEqual({ minHits: 2, minHitRate: 0.55, minTotal: 2, skipBinomialTest: true });
  });

  it("활성 학습 COLD_START_THRESHOLD = 5건 — 성장기 기준 반환", () => {
    const thresholds = getPromotionThresholds(COLD_START_THRESHOLD);
    expect(thresholds).toEqual({ minHits: 3, minHitRate: 0.60, minTotal: 5, skipBinomialTest: false });
  });

  it("활성 학습 GROWTH_PHASE_THRESHOLD - 1 = 14건 — 성장기 기준 반환", () => {
    const thresholds = getPromotionThresholds(GROWTH_PHASE_THRESHOLD - 1);
    expect(thresholds).toEqual({ minHits: 3, minHitRate: 0.60, minTotal: 5, skipBinomialTest: false });
  });

  it("활성 학습 GROWTH_PHASE_THRESHOLD = 15건 — 정상 운영 기준 반환", () => {
    const thresholds = getPromotionThresholds(GROWTH_PHASE_THRESHOLD);
    expect(thresholds).toEqual({ minHits: 5, minHitRate: 0.65, minTotal: 8, skipBinomialTest: false });
  });

  it("활성 학습 50건(최대) — 정상 운영 기준 반환", () => {
    const thresholds = getPromotionThresholds(50);
    expect(thresholds).toEqual({ minHits: 5, minHitRate: 0.65, minTotal: 8, skipBinomialTest: false });
  });
});

// ─── buildPromotionCandidates ─────────────────────────────────────────────────

function makeThesis(overrides: Partial<{
  id: number;
  agentPersona: string;
  verificationMetric: string;
  verificationMethod: string | null;
  status: string;
}> = {}) {
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
  it("bootstrap 단일 thesis — 후보 생성 (minHits=1, minTotal=1)", () => {
    const confirmed = [makeThesis({ id: 1 })];
    const invalidated: ReturnType<typeof makeThesis>[] = [];
    const existingSourceIds = new Set<number>();

    // bootstrap: minHits=1, minTotal=1 → 단일 confirmed thesis로 승격 가능
    const candidates = buildPromotionCandidates(
      confirmed as never,
      invalidated as never,
      existingSourceIds,
      0, // bootstrap
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].hitCount).toBe(1);
    expect(candidates[0].missCount).toBe(0);
  });

  it("bootstrap 기준(minHits=1, minTotal=1) 충족 — binomial test 면제로 후보 생성", () => {
    const confirmed = [
      makeThesis({ id: 1 }),
      makeThesis({ id: 2 }),
    ];
    const invalidated = [makeThesis({ id: 3 })];
    const existingSourceIds = new Set<number>();

    // bootstrap (0 learnings): minHits=1, minTotal=1, skipBinomialTest=true
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

  it("bootstrap에서 hitRate 55% 미만이면 탈락", () => {
    const confirmed = [makeThesis({ id: 1 })];
    const invalidated = [
      makeThesis({ id: 2 }),
      makeThesis({ id: 3 }),
    ];
    const existingSourceIds = new Set<number>();

    // hitRate = 1/3 = 33% < 55% → 탈락
    const candidates = buildPromotionCandidates(
      confirmed as never,
      invalidated as never,
      existingSourceIds,
      0,
    );

    expect(candidates).toHaveLength(0);
  });

  it("cold start 기준(minHits=2, minTotal=2) 충족 — 후보 생성", () => {
    const confirmed = [
      makeThesis({ id: 1 }),
      makeThesis({ id: 2 }),
    ];
    const invalidated: ReturnType<typeof makeThesis>[] = [];
    const existingSourceIds = new Set<number>();

    // cold start (2~4): minHits=2, minTotal=2 → 2건만으로도 승격 가능
    const candidates = buildPromotionCandidates(
      confirmed as never,
      invalidated as never,
      existingSourceIds,
      3, // cold start (2~4) → minHits=2
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].hitCount).toBe(2);
    expect(candidates[0].missCount).toBe(0);
    expect(candidates[0].persona).toBe("trend-follower");
    expect(candidates[0].metric).toBe("RS > 80");
  });

  it("cold start에서 minHits=2 미만이면 탈락", () => {
    const confirmed = [makeThesis({ id: 1 })];
    const invalidated: ReturnType<typeof makeThesis>[] = [];
    const existingSourceIds = new Set<number>();

    // cold start: minHits=2, 1건만 있으므로 탈락
    const candidates = buildPromotionCandidates(
      confirmed as never,
      invalidated as never,
      existingSourceIds,
      3, // cold start
    );

    expect(candidates).toHaveLength(0);
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

  it("activeLearningCount 기본값 0 — bootstrap 기준 적용 (단일 thesis도 승격)", () => {
    const confirmed = [makeThesis({ id: 1 })];
    // activeLearningCount 파라미터 생략 → 기본값 0 → bootstrap (minHits=1)
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

  it("cold start 단계에서 binomial test 실패해도 후보가 통과한다 (#437)", () => {
    mockBinomialTest.mockReturnValueOnce({ isSignificant: false, pValue: 0.5, cohenH: 0.1 });

    const confirmed = [
      makeThesis({ id: 20 }),
      makeThesis({ id: 21 }),
      makeThesis({ id: 22 }),
    ];

    // cold start (3 learnings) → skipBinomialTest=true (#437: 소표본에서 binomial 불가)
    const candidates = buildPromotionCandidates(
      confirmed as never,
      [] as never,
      new Set<number>(),
      3,
    );

    // cold start에서도 binomial test 면제 → 통과
    expect(candidates).toHaveLength(1);
  });

  it("growth 단계에서 binomial test 실패하면 후보가 탈락한다", () => {
    mockBinomialTest.mockReturnValueOnce({ isSignificant: false, pValue: 0.5, cohenH: 0.1 });

    const confirmed = [
      makeThesis({ id: 30 }),
      makeThesis({ id: 31 }),
      makeThesis({ id: 32 }),
      makeThesis({ id: 33 }),
      makeThesis({ id: 34 }),
    ];

    // growth (5 learnings) → skipBinomialTest=false, minHits=3
    const candidates = buildPromotionCandidates(
      confirmed as never,
      [] as never,
      new Set<number>(),
      5,
    );

    // binomial test not significant → 탈락
    expect(candidates).toHaveLength(0);
  });
});

// ─── normalizeMetricKey ───────────────────────────────────────────────────────

describe("normalizeMetricKey", () => {
  it("'Tech RS' → 'Technology RS'로 정규화", () => {
    expect(normalizeMetricKey("Tech RS")).toBe("Technology RS");
  });

  it("'Information Technology RS' → 'Technology RS'로 정규화", () => {
    expect(normalizeMetricKey("Information Technology RS")).toBe("Technology RS");
  });

  it("'Technology 섹터 RS' → 'Technology RS'로 정규화", () => {
    expect(normalizeMetricKey("Technology 섹터 RS")).toBe("Technology RS");
  });

  it("'Technology sector RS' → 'Technology RS'로 정규화", () => {
    expect(normalizeMetricKey("Technology sector RS")).toBe("Technology RS");
  });

  it("'Technology RS score' → 'Technology RS'로 정규화", () => {
    expect(normalizeMetricKey("Technology RS score")).toBe("Technology RS");
  });

  it("'Financials RS' → 'Financial Services RS'로 정규화", () => {
    expect(normalizeMetricKey("Financials RS")).toBe("Financial Services RS");
  });

  it("'Consumer Discretionary RS' → 'Consumer Cyclical RS'로 정규화", () => {
    expect(normalizeMetricKey("Consumer Discretionary RS")).toBe("Consumer Cyclical RS");
  });

  it("'Consumer Staples RS' → 'Consumer Defensive RS'로 정규화", () => {
    expect(normalizeMetricKey("Consumer Staples RS")).toBe("Consumer Defensive RS");
  });

  it("'Health RS' → 'Healthcare RS'로 정규화", () => {
    expect(normalizeMetricKey("Health RS")).toBe("Healthcare RS");
  });

  it("SPX → S&P 500으로 정규화", () => {
    expect(normalizeMetricKey("SPX")).toBe("S&P 500");
  });

  it("QQQ → NASDAQ으로 정규화", () => {
    expect(normalizeMetricKey("QQQ")).toBe("NASDAQ");
  });

  it("공포탐욕지수 → Fear & Greed로 정규화", () => {
    expect(normalizeMetricKey("공포탐욕지수")).toBe("Fear & Greed");
  });

  it("이미 정규화된 메트릭은 그대로 유지", () => {
    expect(normalizeMetricKey("S&P 500")).toBe("S&P 500");
    expect(normalizeMetricKey("Technology RS")).toBe("Technology RS");
    expect(normalizeMetricKey("VIX")).toBe("VIX");
  });

  it("알 수 없는 메트릭은 그대로 반환", () => {
    expect(normalizeMetricKey("Custom Metric")).toBe("Custom Metric");
  });
});

// ─── buildPromotionCandidates with normalized metrics ─────────────────────────

describe("buildPromotionCandidates — 메트릭 정규화", () => {
  it("다른 표기의 같은 메트릭이 하나의 그룹으로 병합된다", () => {
    const confirmed = [
      makeThesis({ id: 100, agentPersona: "tech", verificationMetric: "Tech RS" }),
      makeThesis({ id: 101, agentPersona: "tech", verificationMetric: "Technology RS" }),
    ];
    const invalidated = [
      makeThesis({ id: 102, agentPersona: "tech", verificationMetric: "Information Technology RS" }),
    ];

    const candidates = buildPromotionCandidates(
      confirmed as never,
      invalidated as never,
      new Set<number>(),
      0, // bootstrap
    );

    // 3개 모두 "Technology RS"로 정규화 → 1개 그룹
    expect(candidates).toHaveLength(1);
    expect(candidates[0].hitCount).toBe(2);
    expect(candidates[0].missCount).toBe(1);
    expect(candidates[0].metric).toBe("Technology RS");
  });

  it("EXPIRED theses가 invalidated로 전달되면 miss로 카운트된다", () => {
    const confirmed = [
      makeThesis({ id: 200, agentPersona: "macro", verificationMetric: "S&P 500" }),
      makeThesis({ id: 201, agentPersona: "macro", verificationMetric: "S&P 500" }),
    ];
    // EXPIRED theses를 invalidated로 전달 (main()에서 합침)
    const expiredAsInvalidated = [
      makeThesis({ id: 202, agentPersona: "macro", verificationMetric: "S&P 500", status: "EXPIRED" }),
    ];

    const candidates = buildPromotionCandidates(
      confirmed as never,
      expiredAsInvalidated as never,
      new Set<number>(),
      0, // bootstrap
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].hitCount).toBe(2);
    expect(candidates[0].missCount).toBe(1);
    expect(candidates[0].persona).toBe("macro");
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

// ─── MIN_MATURATION_HITS 상수 ────────────────────────────────────────────────

describe("MIN_MATURATION_HITS 상수", () => {
  it("MIN_MATURATION_HITS는 3이다", () => {
    expect(MIN_MATURATION_HITS).toBe(3);
  });
});

// ─── demoteImmatureLearnings ─────────────────────────────────────────────────

function makeLearning(overrides: Partial<{
  id: number;
  hitCount: number;
  missCount: number;
  category: string;
  isActive: boolean;
  principle: string;
  sourceThesisIds: string;
}> = {}) {
  return {
    id: 1,
    principle: "[test] test learning",
    category: "confirmed",
    hitCount: 1,
    missCount: 0,
    hitRate: "1.00",
    sourceThesisIds: "[]",
    firstConfirmed: "2026-01-01",
    lastVerified: "2026-03-01",
    expiresAt: "2026-07-01",
    isActive: true,
    verificationPath: "quantitative",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("demoteImmatureLearnings", () => {
  beforeEach(() => {
    mockUpdate.mockClear();
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it("activeLearningCount < COLD_START_THRESHOLD이면 강등하지 않는다 (bootstrap 보호)", async () => {
    const learnings = [
      makeLearning({ id: 1, hitCount: 1, category: "confirmed" }),
    ];

    const result = await demoteImmatureLearnings(learnings as never, COLD_START_THRESHOLD - 1);

    expect(result).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("activeLearningCount >= COLD_START_THRESHOLD이고 hit_count < MIN_MATURATION_HITS이면 강등한다", async () => {
    const learnings = [
      makeLearning({ id: 1, hitCount: 1, category: "confirmed" }),
      makeLearning({ id: 2, hitCount: 2, category: "confirmed" }),
    ];

    const result = await demoteImmatureLearnings(learnings as never, COLD_START_THRESHOLD);

    expect(result).toBe(2);
  });

  it("hit_count >= MIN_MATURATION_HITS인 학습은 강등하지 않는다", async () => {
    const learnings = [
      makeLearning({ id: 1, hitCount: 3, category: "confirmed" }),
      makeLearning({ id: 2, hitCount: 10, category: "confirmed" }),
    ];

    const result = await demoteImmatureLearnings(learnings as never, COLD_START_THRESHOLD);

    expect(result).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("caution 카테고리는 성숙도 게이트 대상에서 제외한다", async () => {
    const learnings = [
      makeLearning({ id: 1, hitCount: 1, category: "caution" }),
    ];

    const result = await demoteImmatureLearnings(learnings as never, COLD_START_THRESHOLD);

    expect(result).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("confirmed hit_count=1과 caution hit_count=1이 혼재 시 confirmed만 강등", async () => {
    const learnings = [
      makeLearning({ id: 1, hitCount: 1, category: "confirmed" }),
      makeLearning({ id: 2, hitCount: 1, category: "caution" }),
      makeLearning({ id: 3, hitCount: 5, category: "confirmed" }),
    ];

    const result = await demoteImmatureLearnings(learnings as never, COLD_START_THRESHOLD);

    expect(result).toBe(1); // confirmed id=1만 강등
  });
});

// ─── absorbNewTheses ────────────────────────────────────────────────────────

describe("absorbNewTheses", () => {
  beforeEach(() => {
    mockUpdate.mockClear();
    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it("같은 persona+metric인 새 thesis를 기존 학습에 흡수한다", async () => {
    const learnings = [
      makeLearning({
        id: 10,
        hitCount: 2,
        category: "confirmed",
        sourceThesisIds: JSON.stringify([1, 2]),
        principle: "[macro] S&P 500 관련 전망이 2회 적중 (적중률 100%, 2회 관측)",
      }),
    ];

    const allTheses = [
      // 기존 sourced theses
      makeThesis({ id: 1, agentPersona: "macro", verificationMetric: "S&P 500", status: "CONFIRMED" }),
      makeThesis({ id: 2, agentPersona: "macro", verificationMetric: "S&P 500", status: "CONFIRMED" }),
      // 새로 판정된 thesis (같은 persona+metric)
      makeThesis({ id: 10, agentPersona: "macro", verificationMetric: "S&P 500", status: "CONFIRMED" }),
      makeThesis({ id: 11, agentPersona: "macro", verificationMetric: "SPX", status: "INVALIDATED" }),
    ];

    const result = await absorbNewTheses(
      learnings as never,
      allTheses as never,
      "2026-03-25",
    );

    expect(result).toBe(2); // thesis 10, 11 흡수
    // in-memory 갱신 확인
    expect(learnings[0].hitCount).toBe(3);  // 1, 2, 10 = CONFIRMED
    expect(learnings[0].missCount).toBe(1); // 11 = INVALIDATED
    expect(JSON.parse(learnings[0].sourceThesisIds ?? "[]")).toEqual(expect.arrayContaining([1, 2, 10, 11]));
  });

  it("다른 persona의 thesis는 흡수하지 않는다", async () => {
    const learnings = [
      makeLearning({
        id: 20,
        hitCount: 1,
        category: "confirmed",
        sourceThesisIds: JSON.stringify([1]),
      }),
    ];

    const allTheses = [
      makeThesis({ id: 1, agentPersona: "macro", verificationMetric: "S&P 500", status: "CONFIRMED" }),
      // 다른 persona
      makeThesis({ id: 5, agentPersona: "tech", verificationMetric: "S&P 500", status: "CONFIRMED" }),
    ];

    const result = await absorbNewTheses(
      learnings as never,
      allTheses as never,
      "2026-03-25",
    );

    expect(result).toBe(0);
  });

  it("caution 카테고리 학습은 흡수 대상에서 제외한다", async () => {
    const learnings = [
      makeLearning({
        id: 30,
        hitCount: 2,
        category: "caution",
        sourceThesisIds: JSON.stringify([1]),
      }),
    ];

    const allTheses = [
      makeThesis({ id: 1, agentPersona: "macro", verificationMetric: "S&P 500", status: "CONFIRMED" }),
      makeThesis({ id: 5, agentPersona: "macro", verificationMetric: "S&P 500", status: "CONFIRMED" }),
    ];

    const result = await absorbNewTheses(
      learnings as never,
      allTheses as never,
      "2026-03-25",
    );

    expect(result).toBe(0);
  });

  it("이미 sourceThesisIds에 있는 thesis는 중복 흡수하지 않는다", async () => {
    const learnings = [
      makeLearning({
        id: 40,
        hitCount: 2,
        category: "confirmed",
        sourceThesisIds: JSON.stringify([1, 2]),
      }),
    ];

    const allTheses = [
      makeThesis({ id: 1, agentPersona: "macro", verificationMetric: "S&P 500", status: "CONFIRMED" }),
      makeThesis({ id: 2, agentPersona: "macro", verificationMetric: "S&P 500", status: "CONFIRMED" }),
    ];

    const result = await absorbNewTheses(
      learnings as never,
      allTheses as never,
      "2026-03-25",
    );

    expect(result).toBe(0);
  });

  it("정규화된 메트릭으로 매칭한다 (SPX → S&P 500)", async () => {
    const learnings = [
      makeLearning({
        id: 50,
        hitCount: 1,
        category: "confirmed",
        sourceThesisIds: JSON.stringify([1]),
      }),
    ];

    const allTheses = [
      makeThesis({ id: 1, agentPersona: "macro", verificationMetric: "S&P 500", status: "CONFIRMED" }),
      // SPX는 S&P 500으로 정규화되므로 매칭
      makeThesis({ id: 5, agentPersona: "macro", verificationMetric: "SPX", status: "CONFIRMED" }),
    ];

    const result = await absorbNewTheses(
      learnings as never,
      allTheses as never,
      "2026-03-25",
    );

    expect(result).toBe(1);
    expect(learnings[0].hitCount).toBe(2);
  });

  it("학습이 없으면 0을 반환한다", async () => {
    const result = await absorbNewTheses(
      [] as never,
      [makeThesis({ id: 1 })] as never,
      "2026-03-25",
    );

    expect(result).toBe(0);
  });
});

// ─── normalizeMetricKey — commodity 별칭 (#427) ─────────────────────────────

describe("normalizeMetricKey — commodity/rates aliases", () => {
  it("'WTI' → 'WTI Crude'로 정규화", () => {
    expect(normalizeMetricKey("WTI")).toBe("WTI Crude");
  });

  it("'crude oil' → 'WTI Crude'로 정규화", () => {
    expect(normalizeMetricKey("crude oil")).toBe("WTI Crude");
  });

  it("'원유' → 'WTI Crude'로 정규화", () => {
    expect(normalizeMetricKey("원유")).toBe("WTI Crude");
  });

  it("'gold' → 'Gold'로 정규화", () => {
    expect(normalizeMetricKey("gold")).toBe("Gold");
  });

  it("'DXY' → 'DXY'로 정규화", () => {
    expect(normalizeMetricKey("DXY")).toBe("DXY");
  });

  it("'달러인덱스' → 'DXY'로 정규화", () => {
    expect(normalizeMetricKey("달러인덱스")).toBe("DXY");
  });

  it("'10y' → 'US 10Y Yield'로 정규화", () => {
    expect(normalizeMetricKey("10y")).toBe("US 10Y Yield");
  });
});

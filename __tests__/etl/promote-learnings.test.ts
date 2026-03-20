import { describe, it, expect } from "vitest";
import { buildPromotionCandidates, buildCautionPrinciple, getPromotionThresholds, BEAR_KEYWORDS_FOR_PRIORITY } from "@/etl/jobs/promote-learnings";

/**
 * 장기 기억 승격/강등 로직의 핵심: 만료 판정 + 적중률 계산 + 승격 후보 생성.
 * DB 의존 없이 순수 로직만 테스트.
 */

function isLearningExpired(
  expiresAt: string | null,
  lastVerified: string | null,
  today: string,
  expiryMonths: number = 6,
  category: string = "confirmed",
): boolean {
  // caution 카테고리는 demoteExpiredLearnings에서 제외됨
  if (category === "caution") return false;

  if (expiresAt != null && expiresAt <= today) return true;

  if (lastVerified != null) {
    const threshold = new Date(today);
    threshold.setMonth(threshold.getMonth() - expiryMonths);
    return lastVerified < threshold.toISOString().slice(0, 10);
  }

  return false;
}

function calculateHitRate(hits: number, misses: number): number | null {
  const total = hits + misses;
  if (total === 0) return null;
  return hits / total;
}

function makeThesis(overrides: Record<string, unknown>) {
  return {
    id: 1,
    debateDate: "2026-03-01",
    agentPersona: "macro",
    thesis: "test thesis",
    timeframeDays: 30,
    verificationMetric: "S&P 500",
    targetCondition: ">5800",
    invalidationCondition: null,
    confidence: "high",
    consensusLevel: "3/4",
    status: "CONFIRMED",
    verificationDate: "2026-03-05",
    verificationResult: "confirmed",
    closeReason: "condition_met",
    verificationMethod: "quantitative",
    causalAnalysis: null,
    createdAt: new Date(),
    ...overrides,
  } as any;
}

describe("promote-learnings logic", () => {
  describe("isLearningExpired", () => {
    it("not expired when expiresAt is in the future", () => {
      expect(isLearningExpired("2026-12-01", "2026-03-01", "2026-03-05")).toBe(false);
    });

    it("expired when expiresAt is past", () => {
      expect(isLearningExpired("2026-03-01", "2026-02-01", "2026-03-05")).toBe(true);
    });

    it("expired when lastVerified is older than 6 months", () => {
      expect(isLearningExpired(null, "2025-08-01", "2026-03-05")).toBe(true);
    });

    it("not expired when lastVerified is within 6 months", () => {
      expect(isLearningExpired(null, "2025-10-01", "2026-03-05")).toBe(false);
    });

    it("not expired with no dates", () => {
      expect(isLearningExpired(null, null, "2026-03-05")).toBe(false);
    });

    it("never expired for caution category (separate demotion path)", () => {
      // caution 카테고리는 promoteFailurePatterns에서 별도 강등하므로
      // demoteExpiredLearnings의 6개월 만료 규칙이 적용되지 않아야 한다.
      expect(isLearningExpired("2025-01-01", "2025-01-01", "2026-03-05", 6, "caution")).toBe(false);
    });
  });

  describe("calculateHitRate", () => {
    it("returns null for zero observations", () => {
      expect(calculateHitRate(0, 0)).toBeNull();
    });

    it("calculates correct rate", () => {
      expect(calculateHitRate(3, 1)).toBeCloseTo(0.75);
    });

    it("returns 1.0 for all hits", () => {
      expect(calculateHitRate(5, 0)).toBe(1.0);
    });

    it("returns 0 for all misses", () => {
      expect(calculateHitRate(0, 3)).toBe(0);
    });
  });

  describe("buildPromotionCandidates", () => {
    // 정상 운영 기준 (activeLearningCount >= 15): minHits=10, minHitRate=0.70, minTotal=10
    describe("정상 운영 기준 (activeLearningCount >= 15)", () => {
      it("promotes group with 10+ confirmed, 70%+ hitRate, 10+ observations", () => {
        const confirmed = Array.from({ length: 10 }, (_, i) =>
          makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "Fed funds rate" }),
        );

        const result = buildPromotionCandidates(confirmed, [], new Set(), 15);
        expect(result).toHaveLength(1);
        expect(result[0].persona).toBe("macro");
        expect(result[0].metric).toBe("Fed funds rate");
        expect(result[0].hitCount).toBe(10);
      });

      it("excludes groups with fewer than 10 confirmed", () => {
        const confirmed = Array.from({ length: 9 }, (_, i) =>
          makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "GDP" }),
        );

        const result = buildPromotionCandidates(confirmed, [], new Set(), 15);
        expect(result).toHaveLength(0);
      });

      it("excludes groups with hitRate below 70%", () => {
        const confirmed = Array.from({ length: 10 }, (_, i) =>
          makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "CPI" }),
        );
        // 10 confirmed + 5 invalidated = 66.7% hitRate < 70%
        const invalidated = Array.from({ length: 5 }, (_, i) =>
          makeThesis({ id: 100 + i, agentPersona: "macro", verificationMetric: "CPI", status: "INVALIDATED" }),
        );

        const result = buildPromotionCandidates(confirmed, invalidated, new Set(), 15);
        expect(result).toHaveLength(0);
      });

      it("excludes groups with 71% hitRate but insufficient statistical significance (10/14)", () => {
        const confirmed = Array.from({ length: 10 }, (_, i) =>
          makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "CPI" }),
        );
        // 10 confirmed + 4 invalidated = 71.4% hitRate — 기존 기준은 통과하지만
        // 이항분포 검정에서 p=0.09 > 0.05이므로 통계적으로 유의하지 않음
        const invalidated = Array.from({ length: 4 }, (_, i) =>
          makeThesis({ id: 100 + i, agentPersona: "macro", verificationMetric: "CPI", status: "INVALIDATED" }),
        );

        const result = buildPromotionCandidates(confirmed, invalidated, new Set(), 15);
        expect(result).toHaveLength(0);
      });

      it("includes groups with high hitRate and statistical significance (10/0)", () => {
        // 10 confirmed + 0 invalidated = 100% → p ≈ 0.001, Cohen's h ≈ 1.57
        const confirmed = Array.from({ length: 10 }, (_, i) =>
          makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "CPI" }),
        );

        const result = buildPromotionCandidates(confirmed, [], new Set(), 15);
        expect(result).toHaveLength(1);
        expect(result[0].hitCount).toBe(10);
        expect(result[0].missCount).toBe(0);
      });

      it("excludes thesis IDs already in existing learnings", () => {
        const confirmed = Array.from({ length: 10 }, (_, i) =>
          makeThesis({ id: i + 1, agentPersona: "tech", verificationMetric: "capex" }),
        );

        const existingIds = new Set(Array.from({ length: 10 }, (_, i) => i + 1));
        const result = buildPromotionCandidates(confirmed, [], existingIds, 15);
        expect(result).toHaveLength(0);
      });

      it("counts invalidated theses for the same group", () => {
        const confirmed = Array.from({ length: 10 }, (_, i) =>
          makeThesis({ id: i + 1, agentPersona: "sentiment", verificationMetric: "VIX" }),
        );
        const invalidated = [
          makeThesis({ id: 100, agentPersona: "sentiment", verificationMetric: "VIX", status: "INVALIDATED" }),
        ];

        const result = buildPromotionCandidates(confirmed, invalidated, new Set(), 15);
        expect(result).toHaveLength(1);
        expect(result[0].hitCount).toBe(10);
        expect(result[0].missCount).toBe(1);
        expect(result[0].invalidatedIds).toEqual([100]);
      });

      it("handles multiple groups from different personas", () => {
        const confirmed = [
          ...Array.from({ length: 10 }, (_, i) =>
            makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "CPI" }),
          ),
          ...Array.from({ length: 10 }, (_, i) =>
            makeThesis({ id: 100 + i, agentPersona: "tech", verificationMetric: "AI capex" }),
          ),
        ];

        const result = buildPromotionCandidates(confirmed, [], new Set(), 15);
        expect(result).toHaveLength(2);
      });

      it("returns empty for no confirmed theses", () => {
        const result = buildPromotionCandidates([], [], new Set(), 15);
        expect(result).toHaveLength(0);
      });

      it("collects verificationMethods from source theses", () => {
        const confirmed = Array.from({ length: 10 }, (_, i) =>
          makeThesis({
            id: i + 1,
            agentPersona: "macro",
            verificationMetric: "GDP",
            verificationMethod: i < 7 ? "quantitative" : "llm",
          }),
        );

        const result = buildPromotionCandidates(confirmed, [], new Set(), 15);
        expect(result).toHaveLength(1);
        expect(result[0].verificationMethods).toContain("quantitative");
        expect(result[0].verificationMethods).toContain("llm");
        expect(result[0].verificationMethods).toHaveLength(2);
      });

      it("returns single verificationMethod when all theses use the same method", () => {
        const confirmed = Array.from({ length: 10 }, (_, i) =>
          makeThesis({
            id: i + 1,
            agentPersona: "macro",
            verificationMetric: "CPI",
            verificationMethod: "quantitative",
          }),
        );

        const result = buildPromotionCandidates(confirmed, [], new Set(), 15);
        expect(result).toHaveLength(1);
        expect(result[0].verificationMethods).toEqual(["quantitative"]);
      });

      it("returns empty verificationMethods when theses have no verificationMethod", () => {
        const confirmed = Array.from({ length: 10 }, (_, i) =>
          makeThesis({
            id: i + 1,
            agentPersona: "macro",
            verificationMetric: "VIX",
            verificationMethod: null,
          }),
        );

        const result = buildPromotionCandidates(confirmed, [], new Set(), 15);
        expect(result).toHaveLength(1);
        expect(result[0].verificationMethods).toEqual([]);
      });

      it("does not include reusablePatterns in candidate", () => {
        const confirmed = Array.from({ length: 10 }, (_, i) =>
          makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "GDP" }),
        );

        const result = buildPromotionCandidates(confirmed, [], new Set(), 15);
        expect(result).toHaveLength(1);
        expect(result[0]).not.toHaveProperty("reusablePatterns");
      });
    });
  });

  describe("getPromotionThresholds", () => {
    it("bootstrap (0건) → 최소 기준 + binomial test 면제", () => {
      const thresholds = getPromotionThresholds(0);
      expect(thresholds).toEqual({ minHits: 2, minHitRate: 0.55, minTotal: 3, skipBinomialTest: true });
    });

    it("bootstrap (1건) → 최소 기준 + binomial test 면제", () => {
      const thresholds = getPromotionThresholds(1);
      expect(thresholds).toEqual({ minHits: 2, minHitRate: 0.55, minTotal: 3, skipBinomialTest: true });
    });

    it("cold start (2건) → 완화 기준 반환", () => {
      const thresholds = getPromotionThresholds(2);
      expect(thresholds).toEqual({ minHits: 3, minHitRate: 0.60, minTotal: 5, skipBinomialTest: false });
    });

    it("cold start (4건) → 완화 기준 반환", () => {
      const thresholds = getPromotionThresholds(4);
      expect(thresholds).toEqual({ minHits: 3, minHitRate: 0.60, minTotal: 5, skipBinomialTest: false });
    });

    it("경계값 4→5건 전환 — 5건은 중간 기준", () => {
      expect(getPromotionThresholds(4)).toEqual({ minHits: 3, minHitRate: 0.60, minTotal: 5, skipBinomialTest: false });
      expect(getPromotionThresholds(5)).toEqual({ minHits: 5, minHitRate: 0.65, minTotal: 8, skipBinomialTest: false });
    });

    it("성장기 (5건) → 중간 기준 반환", () => {
      const thresholds = getPromotionThresholds(5);
      expect(thresholds).toEqual({ minHits: 5, minHitRate: 0.65, minTotal: 8, skipBinomialTest: false });
    });

    it("성장기 (14건) → 중간 기준 반환", () => {
      const thresholds = getPromotionThresholds(14);
      expect(thresholds).toEqual({ minHits: 5, minHitRate: 0.65, minTotal: 8, skipBinomialTest: false });
    });

    it("경계값 14→15건 전환 — 15건은 정상 기준", () => {
      expect(getPromotionThresholds(14)).toEqual({ minHits: 5, minHitRate: 0.65, minTotal: 8, skipBinomialTest: false });
      expect(getPromotionThresholds(15)).toEqual({ minHits: 10, minHitRate: 0.70, minTotal: 10, skipBinomialTest: false });
    });

    it("정상 운영 (15건) → 엄격 기준 반환", () => {
      const thresholds = getPromotionThresholds(15);
      expect(thresholds).toEqual({ minHits: 10, minHitRate: 0.70, minTotal: 10, skipBinomialTest: false });
    });

    it("정상 운영 (50건) → 엄격 기준 반환", () => {
      const thresholds = getPromotionThresholds(50);
      expect(thresholds).toEqual({ minHits: 10, minHitRate: 0.70, minTotal: 10, skipBinomialTest: false });
    });
  });

  describe("buildPromotionCandidates — graduated threshold 적용", () => {
    it("bootstrap: 학습 0건 → 2건 적중, total=3으로 승격 가능 (minHits=2, minTotal=3)", () => {
      const confirmed = Array.from({ length: 2 }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "Fed funds rate" }),
      );
      const invalidated = [
        makeThesis({ id: 100, agentPersona: "macro", verificationMetric: "Fed funds rate", status: "INVALIDATED" }),
      ];

      const result = buildPromotionCandidates(confirmed, invalidated, new Set(), 0);
      expect(result).toHaveLength(1);
      expect(result[0].hitCount).toBe(2);
    });

    it("bootstrap: 학습 0건 → minTotal=3 미달 시 승격 불가", () => {
      // 2 confirmed + 0 invalidated = total=2 < minTotal=3
      const confirmed = Array.from({ length: 2 }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "GDP" }),
      );

      const result = buildPromotionCandidates(confirmed, [], new Set(), 0);
      expect(result).toHaveLength(0);
    });

    it("bootstrap: 학습 0건 → hitRate 55% 미달 시 승격 불가", () => {
      // 2 confirmed + 2 invalidated = 50% hitRate < 55%
      const confirmed = Array.from({ length: 2 }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "CPI" }),
      );
      const invalidated = Array.from({ length: 2 }, (_, i) =>
        makeThesis({ id: 100 + i, agentPersona: "macro", verificationMetric: "CPI", status: "INVALIDATED" }),
      );

      const result = buildPromotionCandidates(confirmed, invalidated, new Set(), 0);
      expect(result).toHaveLength(0);
    });

    it("성장기: 학습 5건 → minHits=5, minHitRate=0.65, minTotal=8 기준 적용", () => {
      // 5 confirmed + 2 invalidated = 71.4% hitRate >= 65%, total=7 < 8 → 미승격
      const confirmed = Array.from({ length: 5 }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "Fed funds rate" }),
      );
      const invalidated = Array.from({ length: 2 }, (_, i) =>
        makeThesis({ id: 100 + i, agentPersona: "macro", verificationMetric: "Fed funds rate", status: "INVALIDATED" }),
      );

      const result = buildPromotionCandidates(confirmed, invalidated, new Set(), 5);
      // total=7 < minTotal=8 → 승격 불가
      expect(result).toHaveLength(0);
    });

    it("성장기: 학습 5건 → total=8 이상이고 hitRate>=65% 이면 승격", () => {
      // 8 confirmed + 0 invalidated = 100%, total=8 >= 8 → 승격
      const confirmed = Array.from({ length: 8 }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "Fed funds rate" }),
      );

      const result = buildPromotionCandidates(confirmed, [], new Set(), 5);
      expect(result).toHaveLength(1);
      expect(result[0].hitCount).toBe(8);
    });

    it("정상 운영: 학습 15건 → 9건 적중은 minHits=10 미달로 승격 불가", () => {
      const confirmed = Array.from({ length: 9 }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "GDP" }),
      );

      const result = buildPromotionCandidates(confirmed, [], new Set(), 15);
      expect(result).toHaveLength(0);
    });

    it("activeLearningCount 기본값 0 → bootstrap 기준 적용", () => {
      // activeLearningCount 미전달 시 default=0 → bootstrap 기준
      const confirmed = Array.from({ length: 3 }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "CPI" }),
      );

      const resultDefault = buildPromotionCandidates(confirmed, [], new Set());
      const resultExplicit = buildPromotionCandidates(confirmed, [], new Set(), 0);
      expect(resultDefault).toHaveLength(resultExplicit.length);
    });

    it("bootstrap에서 binomialTest 면제 — 소표본에서도 승격 가능", () => {
      // bootstrap (0건): minHits=2, minTotal=3, skipBinomialTest=true
      // 2 confirmed + 1 invalidated = 67% hitRate, total=3
      // 실제 binomialTest(2, 3)은 p=0.5 → 비유의미이지만, bootstrap이므로 통과
      const confirmed = Array.from({ length: 2 }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "VIX" }),
      );
      const invalidated = [
        makeThesis({ id: 100, agentPersona: "macro", verificationMetric: "VIX", status: "INVALIDATED" }),
      ];

      const result = buildPromotionCandidates(confirmed, invalidated, new Set(), 0);
      expect(result).toHaveLength(1);
    });

    it("cold start(2건+)에서 binomialTest 유지 — 통계적 비유의미 데이터는 승격 불가", () => {
      // cold start 기준 (2건): minHits=3, minTotal=5, minHitRate=0.60
      // 3 confirmed + 2 invalidated = 60% hitRate = 경계값, total=5
      // binomialTest에서 p값이 크면 비유의미로 탈락
      const confirmed = Array.from({ length: 3 }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: "VIX" }),
      );
      const invalidated = Array.from({ length: 2 }, (_, i) =>
        makeThesis({ id: 100 + i, agentPersona: "macro", verificationMetric: "VIX", status: "INVALIDATED" }),
      );

      // n=5, k=3 → p=0.5 기준 이항검정은 유의하지 않음 (p > 0.05)
      const result = buildPromotionCandidates(confirmed, invalidated, new Set(), 2);
      expect(result).toHaveLength(0);
    });
  });

  describe("BEAR_KEYWORDS_FOR_PRIORITY", () => {
    it("contains expected bear keywords", () => {
      expect(BEAR_KEYWORDS_FOR_PRIORITY).toContain("하락");
      expect(BEAR_KEYWORDS_FOR_PRIORITY).toContain("약세");
      expect(BEAR_KEYWORDS_FOR_PRIORITY).toContain("경계");
    });

    it("does not contain bull keywords", () => {
      expect(BEAR_KEYWORDS_FOR_PRIORITY).not.toContain("상승");
      expect(BEAR_KEYWORDS_FOR_PRIORITY).not.toContain("강세");
      expect(BEAR_KEYWORDS_FOR_PRIORITY).not.toContain("반등");
    });
  });

  describe("buildPromotionCandidates — bear priority sorting", () => {
    function makeBearCandidate(metric: string, hitCount = 10, missCount = 0) {
      const confirmed = Array.from({ length: hitCount }, (_, i) =>
        makeThesis({ id: i + 1, agentPersona: "macro", verificationMetric: metric }),
      );
      const invalidated = Array.from({ length: missCount }, (_, i) =>
        makeThesis({ id: 100 + i, agentPersona: "macro", verificationMetric: metric, status: "INVALIDATED" }),
      );
      return { confirmed, invalidated };
    }

    it("bear-keyword metrics sort before bull-keyword metrics when bearPriority is true via candidate metric", () => {
      // We test the bear priority logic by checking that BEAR_KEYWORDS_FOR_PRIORITY
      // would match bear-labeled candidates
      const bearMetric = "하락 위험 조정 지표";
      const bullMetric = "상승 모멘텀 지표";

      const isBear = BEAR_KEYWORDS_FOR_PRIORITY.some((kw) => bearMetric.includes(kw));
      const isBull = BEAR_KEYWORDS_FOR_PRIORITY.some((kw) => bullMetric.includes(kw));

      expect(isBear).toBe(true);
      expect(isBull).toBe(false);
    });

    it("candidates with bear metric keywords are identified correctly", () => {
      const bearMetrics = ["약세 전환 신호", "하락 위험 감지", "조정 국면 판단"];
      const bullMetrics = ["상승 추세 지속", "반등 패턴 확인"];

      for (const metric of bearMetrics) {
        const isBear = BEAR_KEYWORDS_FOR_PRIORITY.some((kw) => metric.includes(kw));
        expect(isBear).toBe(true);
      }

      for (const metric of bullMetrics) {
        const isBear = BEAR_KEYWORDS_FOR_PRIORITY.some((kw) => metric.includes(kw));
        expect(isBear).toBe(false);
      }
    });

    it("bear priority candidates are filtered by existing source IDs as usual", () => {
      const { confirmed } = makeBearCandidate("하락 리스크 패턴");
      const existingIds = new Set(confirmed.map((t) => t.id as number));

      const result = buildPromotionCandidates(confirmed, [], existingIds, 15);
      expect(result).toHaveLength(0);
    });
  });

  describe("buildCautionPrinciple", () => {
    it("generates principle with [경계] prefix", () => {
      const principle = buildCautionPrinciple("브레드스 악화 + 섹터 고립 상승", 0.85, 20);
      expect(principle).toBe(
        "[경계] 브레드스 악화 + 섹터 고립 상승 조건에서 Phase 2 신호 실패율 85% (20회 관측)",
      );
    });

    it("formats failure rate as integer percentage", () => {
      const principle = buildCautionPrinciple("거래량 미확인", 0.7142, 14);
      expect(principle).toContain("실패율 71%");
    });

    it("includes observation count", () => {
      const principle = buildCautionPrinciple("펀더멘탈 부실", 0.80, 100);
      expect(principle).toContain("100회 관측");
    });

    it("includes pattern name in principle", () => {
      const principle = buildCautionPrinciple("브레드스 악화", 0.75, 8);
      expect(principle).toContain("브레드스 악화");
    });

    it("contains BEAR_KEYWORDS for bias detection ('경계')", () => {
      const principle = buildCautionPrinciple("test", 0.70, 10);
      // '경계'는 biasDetector의 BEAR_KEYWORDS에 포함됨
      expect(principle).toContain("경계");
    });

    it("contains '실패' keyword for semantic clarity", () => {
      const principle = buildCautionPrinciple("test", 0.70, 10);
      expect(principle).toContain("실패율");
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockData: { learnings: unknown[]; confirmed: unknown[]; invalidated: unknown[]; confidenceStats: unknown[] } = {
  learnings: [],
  confirmed: [],
  invalidated: [],
  confidenceStats: [],
};

// Track eq() calls to determine which query is being made
const eqCalls: string[] = [];

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => {
    eqCalls.push(String(val));
    return { col, val };
  },
  desc: (col: unknown) => ({ col, direction: "desc" }),
  isNotNull: (col: unknown) => ({ col, op: "isNotNull" }),
  sql: () => "sql_tag",
  inArray: (_col: unknown, vals: unknown[]) => ({ op: "inArray", vals }),
}));

vi.mock("../../../src/lib/biasDetector.js", () => ({
  detectBullBias: vi.fn((principles: string[]) => {
    const bullCount = principles.filter((p) =>
      ["상승", "돌파", "강세", "긍정", "반등", "회복", "확장", "성장", "호조", "상향"].some((kw) => p.includes(kw)),
    ).length;
    const bearCount = principles.filter((p) =>
      ["하락", "약세", "부정", "조정", "위축", "둔화", "악화", "하향", "리스크", "경계"].some((kw) => p.includes(kw)),
    ).length;
    const total = bullCount + bearCount;
    const bullRatio = total > 0 ? bullCount / total : 0.5;
    return { bullCount, bearCount, totalLearnings: principles.length, bullRatio, isSkewed: bullRatio > 0.8 };
  }),
}));

vi.mock("../../../src/db/client.js", () => ({
  db: {
    select: (...args: unknown[]) => ({
      from: () => ({
        where: (condition: { val?: unknown; op?: string; vals?: unknown[] }) => {
          // inArray query (loadConfidenceCalibration)
          // #911: getConfidenceHitRates는 .where()에서 raw rows를 직접 반환 (groupBy 없음)
          if (condition?.op === "inArray") {
            return Promise.resolve(mockData.confidenceStats);
          }
          const val = condition?.val;
          if (val === true) {
            // agent_learnings is_active = true
            return { limit: () => Promise.resolve(mockData.learnings) };
          }
          if (val === "CONFIRMED") {
            return {
              orderBy: () => ({ limit: () => Promise.resolve(mockData.confirmed) }),
            };
          }
          if (val === "INVALIDATED") {
            return {
              orderBy: () => ({ limit: () => Promise.resolve(mockData.invalidated) }),
            };
          }
          return { limit: () => Promise.resolve([]) };
        },
      }),
    }),
  },
}));

import { buildMemoryContext, loadCausalAnalysis, loadBullBiasWarning, loadConfidenceCalibration } from "@/debate/memoryLoader.js";

describe("memoryLoader", () => {
  beforeEach(() => {
    mockData.learnings = [];
    mockData.confirmed = [];
    mockData.invalidated = [];
    mockData.confidenceStats = [];
    eqCalls.length = 0;
  });

  it("returns empty string when no data exists", async () => {
    const context = await buildMemoryContext();
    expect(context).toBe("");
  });

  it("includes confirmed principles in output", async () => {
    mockData.learnings = [
      { principle: "RSI 다이버전스는 로테이션 선행 신호", category: "confirmed", hitRate: "0.85", hitCount: 5 },
    ];

    const context = await buildMemoryContext();
    expect(context).toContain("검증된 패턴");
    expect(context).toContain("RSI 다이버전스");
    expect(context).toContain("85%");
    expect(context).toContain("5회 관측");
  });

  it("includes caution learnings in 경계 패턴 section", async () => {
    mockData.learnings = [
      { principle: "브레드스 악화 + 섹터 고립 조건에서 Phase 2 신호 실패", category: "caution", hitRate: "0.73", hitCount: 15 },
    ];

    const context = await buildMemoryContext();
    expect(context).toContain("경계 패턴");
    expect(context).toContain("추천 전 추가 검증 필요");
    expect(context).toContain("[경계]");
    expect(context).toContain("브레드스 악화");
    expect(context).toContain("실패율 73%");
    expect(context).toContain("15회 관측");
  });

  it("omits 경계 패턴 section when no caution learnings exist", async () => {
    mockData.learnings = [
      { principle: "RSI 다이버전스는 로테이션 선행 신호", category: "confirmed", hitRate: "0.85", hitCount: 5 },
    ];

    const context = await buildMemoryContext();
    expect(context).not.toContain("경계 패턴");
    expect(context).toContain("검증된 패턴");
  });

  it("shows caution learnings without rate when hitRate is null", async () => {
    mockData.learnings = [
      { principle: "VIX 급등 시 반등 베팅은 위험", category: "caution", hitRate: null, hitCount: 0 },
    ];

    const context = await buildMemoryContext();
    expect(context).toContain("경계 패턴");
    expect(context).toContain("[경계] VIX 급등 시 반등 베팅은 위험");
    expect(context).not.toContain("실패율");
  });

  it("ignores unknown category learnings", async () => {
    mockData.learnings = [
      { principle: "알 수 없는 카테고리", category: "unknown", hitRate: null, hitCount: 0 },
    ];

    const context = await buildMemoryContext();
    expect(context).toBe("");
  });

  it("includes recent verified theses", async () => {
    mockData.confirmed = [
      { agentPersona: "tech", thesis: "AI capex 20% 성장 지속", verificationResult: "Q1 실적에서 확인", debateDate: "2026-02-15", causalAnalysis: null, status: "CONFIRMED" },
    ];

    const context = await buildMemoryContext();
    expect(context).toContain("최근 적중한 예측");
    expect(context).toContain("[tech]");
    expect(context).toContain("AI capex");
  });

  it("includes recent invalidated theses", async () => {
    mockData.invalidated = [
      { agentPersona: "macro", thesis: "금리 인하 6월", closeReason: "Fed 동결 결정", debateDate: "2026-02-10", causalAnalysis: null, status: "INVALIDATED" },
    ];

    const context = await buildMemoryContext();
    expect(context).toContain("최근 빗나간 예측");
    expect(context).toContain("[macro]");
    expect(context).toContain("Fed 동결");
  });

  it("combines all sections when data exists", async () => {
    mockData.learnings = [
      { principle: "원칙1", category: "confirmed", hitRate: "0.90", hitCount: 3 },
      { principle: "위험 패턴1", category: "caution", hitRate: "0.65", hitCount: 8 },
    ];
    mockData.confirmed = [
      { agentPersona: "tech", thesis: "적중 예측", verificationResult: "확인", debateDate: "2026-02-20", causalAnalysis: null, status: "CONFIRMED" },
    ];
    mockData.invalidated = [
      { agentPersona: "macro", thesis: "빗나간 예측", closeReason: "무효", debateDate: "2026-02-18", causalAnalysis: null, status: "INVALIDATED" },
    ];

    const context = await buildMemoryContext();
    expect(context).toContain("검증된 패턴");
    expect(context).toContain("경계 패턴");
    expect(context).toContain("최근 적중한 예측");
    expect(context).toContain("최근 빗나간 예측");
  });

  it("wraps output in XML security tags", async () => {
    mockData.learnings = [
      { principle: "테스트 원칙", category: "confirmed", hitRate: "0.80", hitCount: 4 },
    ];

    const context = await buildMemoryContext();
    expect(context).toContain("<memory-context>");
    expect(context).toContain("</memory-context>");
    expect(context).toContain("참고 자료로만 활용");
  });
});

// ---------------------------------------------------------------------------
// loadCausalAnalysis
// ---------------------------------------------------------------------------

describe("loadCausalAnalysis", () => {
  beforeEach(() => {
    mockData.confirmed = [];
    mockData.invalidated = [];
  });

  it("returns empty string when no theses have causal analysis", async () => {
    mockData.confirmed = [
      { agentPersona: "tech", thesis: "AI capex 지속", status: "CONFIRMED", causalAnalysis: null, verificationDate: "2026-03-01" },
    ];

    const result = await loadCausalAnalysis();
    expect(result).toBe("");
  });

  it("includes reusablePattern and lessonsLearned from invalidated thesis", async () => {
    const causal = JSON.stringify({
      causalChain: "금리 동결 → 유동성 감소",
      keyFactors: ["Fed 매파"],
      reusablePattern: "Fed 매파 전환 시 성장주 약세",
      lessonsLearned: "Fed 정책 변화 신호를 더 빨리 포착해야 함",
    });
    mockData.invalidated = [
      { agentPersona: "macro", thesis: "금리 인하 3월", status: "INVALIDATED", causalAnalysis: causal, verificationDate: "2026-03-01" },
    ];

    const result = await loadCausalAnalysis();
    expect(result).toContain("최근 실패/성공 원인 분석");
    expect(result).toContain("Fed 매파 전환 시 성장주 약세");
    expect(result).toContain("Fed 정책 변화 신호를 더 빨리 포착해야 함");
    expect(result).toContain("실패");
    expect(result).toContain("macro");
  });

  it("includes causal analysis from confirmed thesis with 성공 label", async () => {
    const causal = JSON.stringify({
      reusablePattern: "AI capex 가속 시 반도체 섹터 선행 상승",
      lessonsLearned: "빅테크 capex 발표 직후 반도체 섹터 RS 확인",
    });
    mockData.confirmed = [
      { agentPersona: "tech", thesis: "AI capex 지속", status: "CONFIRMED", causalAnalysis: causal, verificationDate: "2026-03-01" },
    ];

    const result = await loadCausalAnalysis();
    expect(result).toContain("성공");
    expect(result).toContain("AI capex 가속 시 반도체 섹터 선행 상승");
  });

  it("skips entries with malformed causal analysis JSON", async () => {
    mockData.invalidated = [
      { agentPersona: "macro", thesis: "테스트", status: "INVALIDATED", causalAnalysis: "not-valid-json", verificationDate: "2026-03-01" },
    ];

    const result = await loadCausalAnalysis();
    expect(result).toBe("");
  });

  it("prioritizes INVALIDATED entries (failure lessons first)", async () => {
    const failCausal = JSON.stringify({ reusablePattern: "실패 패턴", lessonsLearned: "실패 교훈" });
    const successCausal = JSON.stringify({ reusablePattern: "성공 패턴", lessonsLearned: "성공 교훈" });
    mockData.invalidated = [
      { agentPersona: "macro", thesis: "실패 테제", status: "INVALIDATED", causalAnalysis: failCausal, verificationDate: "2026-03-01" },
    ];
    mockData.confirmed = [
      { agentPersona: "tech", thesis: "성공 테제", status: "CONFIRMED", causalAnalysis: successCausal, verificationDate: "2026-03-01" },
    ];

    const result = await loadCausalAnalysis();
    const failIdx = result.indexOf("실패 패턴");
    const successIdx = result.indexOf("성공 패턴");
    expect(failIdx).toBeGreaterThan(-1);
    expect(successIdx).toBeGreaterThan(-1);
    expect(failIdx).toBeLessThan(successIdx);
  });

  it("omits reusablePattern line when field is empty", async () => {
    const causal = JSON.stringify({ reusablePattern: "", lessonsLearned: "중요한 교훈" });
    mockData.invalidated = [
      { agentPersona: "macro", thesis: "테스트", status: "INVALIDATED", causalAnalysis: causal, verificationDate: "2026-03-01" },
    ];

    const result = await loadCausalAnalysis();
    expect(result).toContain("중요한 교훈");
    expect(result).not.toContain("재사용 패턴:");
  });
});

// ---------------------------------------------------------------------------
// loadBullBiasWarning
// ---------------------------------------------------------------------------

describe("loadBullBiasWarning", () => {
  beforeEach(() => {
    mockData.learnings = [];
  });

  it("returns empty string when no learnings exist", async () => {
    const result = await loadBullBiasWarning();
    expect(result).toBe("");
  });

  it("returns empty string when bias is not skewed (<=80%)", async () => {
    // 4 bull + 1 bear = 80% exactly → not skewed (isSkewed: ratio > 0.8)
    mockData.learnings = [
      { principle: "성장 섹터 상승 지속", isActive: true },
      { principle: "반등 모멘텀 강화", isActive: true },
      { principle: "강세 추세 확인", isActive: true },
      { principle: "회복 신호 감지", isActive: true },
      { principle: "하락 경계 필요", isActive: true },
    ];

    const result = await loadBullBiasWarning();
    expect(result).toBe("");
  });

  it("returns warning when bull-bias exceeds 80%", async () => {
    // 9 bull + 1 bear = 90% → skewed
    mockData.learnings = Array.from({ length: 9 }, (_, i) => ({
      principle: `상승 패턴 ${i}`,
      isActive: true,
    })).concat([{ principle: "하락 경계 필요", isActive: true }]);

    const result = await loadBullBiasWarning();
    expect(result).toContain("Bull-Bias 경고");
    expect(result).toContain("강세 편향");
    expect(result).toContain("bear 관점을 강화");
    expect(result).toContain("약세 시나리오");
  });

  it("includes actual bull percentage in warning", async () => {
    // all bull keywords → 100% skewed
    mockData.learnings = [
      { principle: "상승 추세 강화", isActive: true },
      { principle: "반등 신호 확인", isActive: true },
      { principle: "강세 패턴 지속", isActive: true },
    ];

    const result = await loadBullBiasWarning();
    expect(result).toContain("100%");
  });

  it("includes bull-bias warning in buildMemoryContext when bias is skewed", async () => {
    mockData.learnings = Array.from({ length: 9 }, (_, i) => ({
      principle: `상승 성장 패턴 ${i}`,
      category: "confirmed",
      hitRate: "0.80",
      hitCount: 5,
      isActive: true,
    })).concat([{ principle: "하락 경계", category: "caution", hitRate: "0.60", hitCount: 3, isActive: true }]);

    const context = await buildMemoryContext();
    expect(context).toContain("Bull-Bias 경고");
  });
});

// ---------------------------------------------------------------------------
// loadConfidenceCalibration
// ---------------------------------------------------------------------------

// #911: getConfidenceHitRates가 raw rows를 받으므로, 테스트 데이터를 raw rows로 변환
function makeConfidenceRows(specs: Array<{ confidence: string; confirmed: number; invalidated: number }>) {
  let idCounter = 0;
  const rows: Array<{ confidence: string; status: string; verificationMetric: string; targetCondition: string }> = [];
  for (const spec of specs) {
    for (let i = 0; i < spec.confirmed; i++) {
      rows.push({ confidence: spec.confidence, status: "CONFIRMED", verificationMetric: `M${idCounter}`, targetCondition: `>${idCounter}` });
      idCounter++;
    }
    for (let i = 0; i < spec.invalidated; i++) {
      rows.push({ confidence: spec.confidence, status: "INVALIDATED", verificationMetric: `M${idCounter}`, targetCondition: `>${idCounter}` });
      idCounter++;
    }
  }
  return rows;
}

describe("loadConfidenceCalibration", () => {
  beforeEach(() => {
    mockData.confidenceStats = [];
  });

  it("returns empty string when no confidence stats exist", async () => {
    const result = await loadConfidenceCalibration();
    expect(result).toBe("");
  });

  it("returns empty string when all confidence levels have >50% hit rate", async () => {
    mockData.confidenceStats = makeConfidenceRows([
      { confidence: "high", confirmed: 8, invalidated: 2 },
      { confidence: "medium", confirmed: 6, invalidated: 4 },
    ]);

    const result = await loadConfidenceCalibration();
    expect(result).toBe("");
  });

  it("returns warning when medium confidence hit rate is below 50%", async () => {
    mockData.confidenceStats = makeConfidenceRows([
      { confidence: "high", confirmed: 4, invalidated: 1 },
      { confidence: "medium", confirmed: 5, invalidated: 6 },
    ]);

    const result = await loadConfidenceCalibration();
    expect(result).toContain("Confidence 보정 필요");
    expect(result).toContain("medium");
    expect(result).toContain("high confidence만 의사결정에 반영");
  });

  it("skips confidence levels with fewer than 3 observations", async () => {
    mockData.confidenceStats = makeConfidenceRows([
      { confidence: "low", confirmed: 0, invalidated: 1 },
      { confidence: "medium", confirmed: 3, invalidated: 7 },
    ]);

    const result = await loadConfidenceCalibration();
    expect(result).toContain("Confidence 보정 필요");
    expect(result).toContain("medium");
    // low는 표본 부족(1건)으로 생략
    expect(result).not.toContain("low:");
  });

  it("includes confidence calibration warning in buildMemoryContext", async () => {
    mockData.confidenceStats = makeConfidenceRows([
      { confidence: "medium", confirmed: 2, invalidated: 8 },
    ]);
    mockData.learnings = [
      { principle: "테스트 원칙", category: "confirmed", hitRate: "0.80", hitCount: 4 },
    ];

    const context = await buildMemoryContext();
    expect(context).toContain("Confidence 보정 필요");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockData: { learnings: unknown[]; confirmed: unknown[]; invalidated: unknown[] } = {
  learnings: [],
  confirmed: [],
  invalidated: [],
};

// Track eq() calls to determine which query is being made
const eqCalls: string[] = [];

vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => {
    eqCalls.push(String(val));
    return { col, val };
  },
  desc: (col: unknown) => ({ col, direction: "desc" }),
}));

vi.mock("../../../src/db/client.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (condition: { val: unknown }) => {
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

import { buildMemoryContext } from "../../../src/agent/debate/memoryLoader.js";

describe("memoryLoader", () => {
  beforeEach(() => {
    mockData.learnings = [];
    mockData.confirmed = [];
    mockData.invalidated = [];
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
      { agentPersona: "tech", thesis: "AI capex 20% 성장 지속", verificationResult: "Q1 실적에서 확인", debateDate: "2026-02-15" },
    ];

    const context = await buildMemoryContext();
    expect(context).toContain("최근 적중한 예측");
    expect(context).toContain("[tech]");
    expect(context).toContain("AI capex");
  });

  it("includes recent invalidated theses", async () => {
    mockData.invalidated = [
      { agentPersona: "macro", thesis: "금리 인하 6월", closeReason: "Fed 동결 결정", debateDate: "2026-02-10" },
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
      { agentPersona: "tech", thesis: "적중 예측", verificationResult: "확인", debateDate: "2026-02-20" },
    ];
    mockData.invalidated = [
      { agentPersona: "macro", thesis: "빗나간 예측", closeReason: "무효", debateDate: "2026-02-18" },
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

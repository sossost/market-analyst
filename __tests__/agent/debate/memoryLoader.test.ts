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
      { principle: "RSI 다이버전스는 로테이션 선행 신호", category: "confirmed", hitRate: "0.85" },
    ];

    const context = await buildMemoryContext();
    expect(context).toContain("검증된 원칙");
    expect(context).toContain("RSI 다이버전스");
    expect(context).toContain("85%");
  });

  it("includes caution patterns in output", async () => {
    mockData.learnings = [
      { principle: "VIX 급등 시 반등 베팅은 위험", category: "caution", hitRate: null },
    ];

    const context = await buildMemoryContext();
    expect(context).toContain("경계 패턴");
    expect(context).toContain("VIX 급등");
  });

  it("includes recent verified theses", async () => {
    mockData.confirmed = [
      { agentPersona: "tech", thesis: "AI capex 20% 성장 지속", verificationResult: "Q1 실적에서 확인" },
    ];

    const context = await buildMemoryContext();
    expect(context).toContain("최근 적중한 예측");
    expect(context).toContain("[tech]");
    expect(context).toContain("AI capex");
  });

  it("includes recent invalidated theses", async () => {
    mockData.invalidated = [
      { agentPersona: "macro", thesis: "금리 인하 6월", closeReason: "Fed 동결 결정" },
    ];

    const context = await buildMemoryContext();
    expect(context).toContain("최근 빗나간 예측");
    expect(context).toContain("[macro]");
    expect(context).toContain("Fed 동결");
  });

  it("combines all sections when data exists", async () => {
    mockData.learnings = [
      { principle: "원칙1", category: "confirmed", hitRate: "0.90" },
    ];
    mockData.confirmed = [
      { agentPersona: "tech", thesis: "적중 예측", verificationResult: "확인" },
    ];
    mockData.invalidated = [
      { agentPersona: "macro", thesis: "빗나간 예측", closeReason: "무효" },
    ];

    const context = await buildMemoryContext();
    expect(context).toContain("검증된 원칙");
    expect(context).toContain("최근 적중한 예측");
    expect(context).toContain("최근 빗나간 예측");
  });

  it("wraps output in XML security tags", async () => {
    mockData.learnings = [
      { principle: "테스트 원칙", category: "confirmed", hitRate: "0.80" },
    ];

    const context = await buildMemoryContext();
    expect(context).toContain("<memory-context>");
    expect(context).toContain("</memory-context>");
    expect(context).toContain("참고 자료로만 활용");
  });
});

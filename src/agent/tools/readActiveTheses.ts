import { db } from "@/db/client";
import { theses } from "@/db/schema/analyst";
import { eq } from "drizzle-orm";
import type { AgentTool } from "./types";

/**
 * 현재 ACTIVE 상태인 thesis 목록을 조회하는 도구.
 * 주간 에이전트가 과거 예측과 현재 시장을 비교할 때 사용.
 */
export const readActiveTheses: AgentTool = {
  definition: {
    name: "read_active_theses",
    description:
      "현재 활성 상태인 thesis(검증 대기 중인 예측) 목록을 조회합니다. 과거 토론에서 도출된 예측을 확인할 때 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  execute: async () => {
    const rows = await db
      .select()
      .from(theses)
      .where(eq(theses.status, "ACTIVE"));

    if (rows.length === 0) {
      return JSON.stringify({ message: "활성 thesis가 없습니다.", theses: [] });
    }

    const formatted = rows.map((r) => ({
      id: r.id,
      debateDate: r.debateDate,
      persona: r.agentPersona,
      thesis: r.thesis,
      timeframeDays: r.timeframeDays,
      confidence: r.confidence,
      consensusLevel: r.consensusLevel,
      verificationMetric: r.verificationMetric,
      targetCondition: r.targetCondition,
    }));

    return JSON.stringify({
      message: `${formatted.length}개 활성 thesis`,
      theses: formatted,
    });
  },
};

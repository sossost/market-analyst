import { db } from "@/db/client";
import { agentLearnings } from "@/db/schema/analyst";
import { eq } from "drizzle-orm";
import type { AgentTool } from "./types";

/**
 * 활성 장기 기억(검증된 원칙) 목록을 조회하는 도구.
 */
export const readLearnings: AgentTool = {
  definition: {
    name: "read_learnings",
    description:
      "에이전트의 장기 기억(검증된 원칙과 경계 패턴) 목록을 조회합니다. 과거 학습 내용을 확인할 때 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  execute: async () => {
    const rows = await db
      .select()
      .from(agentLearnings)
      .where(eq(agentLearnings.isActive, true));

    if (rows.length === 0) {
      return JSON.stringify({ message: "저장된 학습 내용이 없습니다.", learnings: [] });
    }

    const formatted = rows.map((r) => ({
      id: r.id,
      principle: r.principle,
      category: r.category,
      hitCount: r.hitCount,
      missCount: r.missCount,
      hitRate: r.hitRate,
      lastVerified: r.lastVerified,
    }));

    return JSON.stringify({
      message: `${formatted.length}개 활성 학습 원칙`,
      learnings: formatted,
    });
  },
};

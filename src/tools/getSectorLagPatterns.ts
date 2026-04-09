import { retryDatabaseOperation } from "@/etl/utils/retry";
import { findReliableSectorLagPatterns } from "@/db/repositories/index.js";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { validateNumber, validateString } from "./validation";

const DEFAULT_LIMIT = 30;
const VALID_TRANSITIONS = new Set(["1to2", "3to4"]);
const VALID_ENTITY_TYPES = new Set(["sector", "industry"]);

/**
 * 신뢰할 수 있는 섹터/업종 래그 패턴을 조회한다.
 * "선도 섹터 Phase 2 진입 → 후행 섹터 N일 뒤 진입" 예측에 사용.
 */
export const getSectorLagPatterns: AgentTool = {
  definition: {
    name: "get_sector_lag_patterns",
    description:
      "섹터/업종 간 Phase 전환 래그 패턴을 조회합니다. 선도 섹터가 Phase 2에 진입한 뒤 후행 섹터가 평균 N일 뒤 진입하는 패턴을 보여줍니다. 통계적으로 신뢰할 수 있는(p-value 기반) 패턴만 반환합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        transition: {
          type: "string",
          description: "Phase 전환 유형: '1to2' (Phase 1→2) 또는 '3to4' (Phase 3→4). 기본 '1to2'",
        },
        entity_type: {
          type: "string",
          description: "분석 단위: 'sector' 또는 'industry'. 기본 'sector'",
        },
        limit: {
          type: "number",
          description: "최대 반환 수 (기본 30)",
        },
      },
      required: [],
    },
  },

  async execute(input) {
    const transitionRaw = validateString(input.transition) ?? "1to2";
    const entityTypeRaw = validateString(input.entity_type) ?? "sector";

    if (!VALID_TRANSITIONS.has(transitionRaw)) {
      return JSON.stringify({
        error: "INVALID_TRANSITION",
        validValues: ["1to2", "3to4"],
      });
    }
    if (!VALID_ENTITY_TYPES.has(entityTypeRaw)) {
      return JSON.stringify({
        error: "INVALID_ENTITY_TYPE",
        validValues: ["sector", "industry"],
      });
    }

    const limit = validateNumber(input.limit, DEFAULT_LIMIT);

    const rows = await retryDatabaseOperation(() =>
      findReliableSectorLagPatterns({
        transition: transitionRaw as "1to2" | "3to4",
        entityType: entityTypeRaw as "sector" | "industry",
        limit,
      }),
    );

    const patterns = rows.map((r) => ({
      leaderEntity: r.leader_entity,
      followerEntity: r.follower_entity,
      entityType: r.entity_type,
      transition: r.transition,
      sampleCount: r.sample_count,
      avgLagDays: r.avg_lag_days != null ? toNum(r.avg_lag_days) : null,
      medianLagDays: r.median_lag_days != null ? toNum(r.median_lag_days) : null,
      stddevLagDays: r.stddev_lag_days != null ? toNum(r.stddev_lag_days) : null,
      pValue: r.p_value != null ? toNum(r.p_value) : null,
      lastObservedAt: r.last_observed_at,
      lastLagDays: r.last_lag_days,
    }));

    return JSON.stringify({
      transition: transitionRaw,
      entityType: entityTypeRaw,
      totalPatterns: patterns.length,
      patterns,
    });
  },
};

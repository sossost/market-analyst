import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { validateDate } from "./validation";
import { findUnusualStocks } from "@/db/repositories/stockPhaseRepository.js";

type UnusualCondition = "big_move" | "high_volume" | "phase_change";

const BIG_MOVE_THRESHOLD = 0.05;
const HIGH_VOLUME_RATIO = 2.0;
const MIN_CONDITIONS = 2;
const MIN_RS_SCORE = 40;
const MAX_RESULTS = 15;

// 역분할/액분할 의심 임계값 — 일간 수익률이 이 범위 밖이면 corporate action 가능성
const SPLIT_SUSPECT_UPPER = 0.9; // +90%
const SPLIT_SUSPECT_LOWER = -0.6; // -60%

// Phase 2 (상승 추세) 우선, Phase 1 (바닥→전환) 다음
const PHASE_PRIORITY: Readonly<Record<number, number>> = { 2: 0, 1: 1, 3: 2, 4: 3 } as const;

/**
 * 복합 조건으로 특이종목을 스크리닝한다.
 * 조건: 등락률 ±5%, 거래량 2배, Phase 전환 중 2개 이상 충족.
 */
export const getUnusualStocks: AgentTool = {
  definition: {
    name: "get_unusual_stocks",
    description:
      "복합 조건(등락률 ±5%, 거래량 평균 대비 2배, Phase 전환)으로 특이종목을 조회합니다. 3개 조건 중 2개 이상 충족 종목만 반환합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "조회 날짜 (YYYY-MM-DD)",
        },
      },
      required: ["date"],
    },
  },

  async execute(input) {
    const date = validateDate(input.date);
    if (date == null) {
      return JSON.stringify({ error: "Invalid or missing date parameter" });
    }

    const rows = await retryDatabaseOperation(() =>
      findUnusualStocks(date, BIG_MOVE_THRESHOLD, HIGH_VOLUME_RATIO),
    );

    const unusual = rows
      .map((r) => {
        const dailyReturn = toNum(r.daily_return);
        const volRatio = toNum(r.vol_ratio);
        const hasPhaseChange =
          r.prev_phase != null && r.prev_phase !== r.phase;

        const conditions: UnusualCondition[] = [];
        if (Math.abs(dailyReturn) >= BIG_MOVE_THRESHOLD) {
          conditions.push("big_move");
        }
        if (volRatio >= HIGH_VOLUME_RATIO) {
          conditions.push("high_volume");
        }
        if (hasPhaseChange) {
          conditions.push("phase_change");
        }

        const phase2WithDrop = r.phase === 2 && dailyReturn <= -BIG_MOVE_THRESHOLD;

        // 역분할/액분할 의심 플래그 — 극단적 가격 변동은 corporate action 가능성
        const splitSuspect =
          dailyReturn >= SPLIT_SUSPECT_UPPER || dailyReturn <= SPLIT_SUSPECT_LOWER;

        return {
          symbol: r.symbol,
          companyName: r.company_name,
          close: toNum(r.close),
          dailyReturn: Number((dailyReturn * 100).toFixed(2)),
          volume: toNum(r.volume),
          volRatio: Number(volRatio.toFixed(1)),
          phase: r.phase,
          prevPhase: r.prev_phase,
          rsScore: r.rs_score,
          sector: r.sector,
          industry: r.industry,
          conditions,
          phase2WithDrop,
          splitSuspect,
        };
      })
      .filter(
        (s) =>
          (s.conditions.length >= MIN_CONDITIONS || s.phase2WithDrop === true) &&
          s.rsScore >= MIN_RS_SCORE,
      )
      .sort((a, b) => {
        // Phase 2 우선, 같은 Phase면 RS 높은 순
        const phaseDiff =
          (PHASE_PRIORITY[a.phase] ?? 9) - (PHASE_PRIORITY[b.phase] ?? 9);
        if (phaseDiff !== 0) return phaseDiff;
        return b.rsScore - a.rsScore;
      });

    return JSON.stringify({
      date,
      totalFound: unusual.length,
      stocks: unusual.slice(0, MAX_RESULTS),
    });
  },
};

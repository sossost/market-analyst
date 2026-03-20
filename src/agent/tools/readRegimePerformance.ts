import { getRegimePerformanceSummary } from "@/agent/debate/regimeThesisAnalyzer";
import { loadConfirmedRegime } from "@/agent/debate/regimeStore";
import type { AgentTool } from "./types";

/**
 * 레짐별 thesis 적중률 및 편향 분석 도구.
 * 주간/일간 에이전트가 현재 레짐의 과거 성과를 참조할 때 사용.
 */
export const readRegimePerformance: AgentTool = {
  definition: {
    name: "read_regime_performance",
    description:
      "레짐별(EARLY_BULL/MID_BULL/LATE_BULL/EARLY_BEAR/BEAR) thesis 적중률과 편향을 분석합니다. 현재 레짐에서 과거 예측이 얼마나 정확했는지 확인할 때 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  execute: async () => {
    const [summary, currentRegime] = await Promise.all([
      getRegimePerformanceSummary(),
      loadConfirmedRegime(),
    ]);

    if (summary.totalResolved === 0) {
      return JSON.stringify({
        message: "해결된 thesis가 없어 레짐별 성과를 분석할 수 없습니다.",
        regimeHitRates: [],
        totalResolved: 0,
      });
    }

    return JSON.stringify({
      message: `${summary.regimeHitRates.length}개 레짐, ${summary.totalResolved}건 분석 완료`,
      currentRegime: currentRegime?.regime ?? null,
      overallHitRate: summary.overallHitRate,
      hasSufficientData: summary.hasSufficientData,
      regimeHitRates: summary.regimeHitRates,
      regimeBiases: summary.regimeBiases,
    });
  },
};

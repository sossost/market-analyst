/**
 * capture_weekly_insight 도구.
 *
 * 에이전트가 주간 분석 완료 후 해석 텍스트를 JSON으로 제출하는 도구.
 * 데이터 테이블은 포함하지 않는다 — 텍스트 판단과 서사만.
 *
 * createDraftCaptureTool 패턴과 동일하게 동작:
 * - 에이전트는 제출 성공으로 인식
 * - 실제로는 captured.insight에 결과가 저장됨
 */

import type { AgentTool } from "./types";
import { fillInsightDefaults, validateWeeklyReportInsight, type WeeklyReportInsight } from "./schemas/weeklyReportSchema.js";
import { logger } from "@/lib/logger";

/**
 * capture_weekly_insight 도구를 생성한다.
 * captured.insight에 에이전트가 제출한 WeeklyReportInsight를 저장한다.
 *
 * @param captured - 결과를 담을 컨테이너 (외부에서 주입, 루프 후 참조 가능)
 */
export function createCaptureWeeklyInsightTool(
  captured: { insight: WeeklyReportInsight | null },
): AgentTool {
  return {
    definition: {
      name: "capture_weekly_insight",
      description: "주간 리포트의 해석/판단 텍스트를 JSON으로 제출한다. 모든 도구 호출 및 save_watchlist 완료 후 마지막에 정확히 1회 호출한다. 데이터 테이블은 포함하지 않는다 — 텍스트 판단과 서사만 작성한다.",
      input_schema: {
        type: "object" as const,
        properties: {
          marketTemperature: {
            type: "string",
            enum: ["bullish", "neutral", "bearish"],
            description: "시장 온도 판정",
          },
          marketTemperatureLabel: {
            type: "string",
            description: "시장 온도 레이블. 예: '중립 — 관망', '강세 — 모멘텀 유지'",
          },
          sectorRotationNarrative: {
            type: "string",
            description: "섹터 로테이션 해석. 구조적 상승 vs 일회성 반등 판단, 2주 연속 상위 유지 섹터 강조. 숫자 테이블 금지.",
          },
          industryFlowNarrative: {
            type: "string",
            description: "업종 RS 자금 흐름 해석. Top 10 업종의 공통 테마와 자금 집중 방향.",
          },
          watchlistNarrative: {
            type: "string",
            description: "관심종목 서사 유효성. Phase 궤적이 thesis를 지지하는지, 이탈 우려 종목과 사유.",
          },
          gate5Summary: {
            type: "string",
            description: "5중 게이트 평가 결과 서술. 등록/해제 판단 근거. '신규 등록 없음' 케이스에서는 어떤 조건이 병목이었는지 서술.",
          },
          riskFactors: {
            type: "string",
            description: "다음 주 주의해야 할 매크로/기술적 리스크.",
          },
          nextWeekWatchpoints: {
            type: "string",
            description: "다음 주 확인이 필요한 시그널. Phase 2 임박 종목, RS 가속 업종, 데이터 확인 포인트.",
          },
          thesisScenarios: {
            type: "string",
            description: "현재 ACTIVE thesis와 이번 주 데이터 정합성. 진전된 thesis와 관망 중인 thesis 구분.",
          },
          regimeContext: {
            type: "string",
            description: "현재 시장 레짐 맥락. 레짐별 전략적 포지셔닝.",
          },
          discordMessage: {
            type: "string",
            description: "Discord 핵심 요약 3~5줄. 텍스트만, 링크 금지. 지수 주간 수익률 + Phase 2 비율 변화 + 신규 관심종목 건수 포함.",
          },
        },
        required: [
          "marketTemperature",
          "marketTemperatureLabel",
          "sectorRotationNarrative",
          "industryFlowNarrative",
          "watchlistNarrative",
          "gate5Summary",
          "riskFactors",
          "nextWeekWatchpoints",
          "thesisScenarios",
          "regimeContext",
          "discordMessage",
        ],
      },
    },

    async execute(input: Record<string, unknown>) {
      const isValid = validateWeeklyReportInsight(input);

      if (!isValid) {
        logger.warn("CaptureWeeklyInsight", "필수 필드 누락 또는 marketTemperature 값 오류 — 기본값으로 보완합니다");
      }

      const insight = fillInsightDefaults(input);
      captured.insight = insight;

      logger.info("CaptureWeeklyInsight", `인사이트 캡처 완료 (temperature: ${insight.marketTemperature})`);

      return JSON.stringify({
        success: true,
        status: "insight_captured",
        temperature: insight.marketTemperature,
      });
    },
  };
}

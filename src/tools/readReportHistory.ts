import { readReportLogs } from "@/lib/reportLog";
import type { AgentTool } from "./types";
import { validateNumber } from "./validation";

const DEFAULT_DAYS_BACK = 7;

/**
 * 최근 N일간의 리포트 이력을 조회한다.
 * Agent가 중복 종목을 판단하는 데 사용.
 */
export const readReportHistory: AgentTool = {
  definition: {
    name: "read_report_history",
    description:
      "최근 N일간의 리포트 이력을 조회합니다. 각 날짜별로 리포트에 포함된 종목, 선정 이유, 시장 요약을 반환합니다. 중복 종목 필터링과 트렌드 파악에 활용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        days_back: {
          type: "number",
          description: "조회할 일수 (기본 7)",
        },
      },
      required: [],
    },
  },

  async execute(input) {
    const daysBack = validateNumber(input.days_back, DEFAULT_DAYS_BACK);
    const logs = readReportLogs(daysBack);

    if (logs.length === 0) {
      return JSON.stringify({
        message: "리포트 이력이 없습니다. 첫 실행입니다.",
        logs: [],
      });
    }

    // Agent에게 핵심 정보만 전달 (토큰 절약)
    const summary = logs.map((log) => ({
      date: log.date,
      reportedSymbols: log.reportedSymbols.map((s) => ({
        symbol: s.symbol,
        rsScore: s.rsScore,
        phase: s.phase,
        prevPhase: s.prevPhase,
        sector: s.sector,
        reason: s.reason,
        firstReportedDate: s.firstReportedDate,
      })),
      marketSummary: log.marketSummary,
    }));

    return JSON.stringify({
      daysBack,
      totalLogs: logs.length,
      logs: summary,
    });
  },
};

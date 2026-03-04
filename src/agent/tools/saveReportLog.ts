import { saveReportLog } from "@/agent/reportLog";
import type { DailyReportLog } from "@/types";
import type { AgentTool } from "./types";
import { validateDate } from "./validation";

/**
 * 당일 리포트 이력을 JSON 파일로 저장한다.
 * 다음 날 Agent가 read_report_history로 참조.
 */
export const saveReportLogTool: AgentTool = {
  definition: {
    name: "save_report_log",
    description:
      "당일 리포트 이력을 JSON 파일로 저장합니다. 다음 날 Agent가 이 이력을 참조하여 중복 종목을 필터링합니다. report_data에는 date, reportedSymbols, marketSummary를 포함해야 합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        report_data: {
          type: "object",
          description: "리포트 데이터 (DailyReportLog 형식)",
          properties: {
            date: { type: "string" },
            reportedSymbols: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  symbol: { type: "string" },
                  phase: { type: "number" },
                  prevPhase: { type: ["number", "null"] },
                  rsScore: { type: "number" },
                  sector: { type: "string" },
                  industry: { type: "string" },
                  reason: { type: "string" },
                  firstReportedDate: { type: "string" },
                },
                required: [
                  "symbol",
                  "phase",
                  "rsScore",
                  "sector",
                  "industry",
                  "reason",
                  "firstReportedDate",
                ],
              },
            },
            marketSummary: {
              type: "object",
              properties: {
                phase2Ratio: { type: "number" },
                leadingSectors: {
                  type: "array",
                  items: { type: "string" },
                },
                totalAnalyzed: { type: "number" },
              },
              required: ["phase2Ratio", "leadingSectors", "totalAnalyzed"],
            },
          },
          required: ["date", "reportedSymbols", "marketSummary"],
        },
      },
      required: ["report_data"],
    },
  },

  async execute(input) {
    const rawData = input.report_data as Record<string, unknown>;
    const date = validateDate(rawData?.date);
    if (date == null) {
      return JSON.stringify({ error: "Invalid or missing date in report_data" });
    }

    const reportData = rawData as unknown as DailyReportLog;

    // metadata는 Agent loop에서 나중에 채워짐. 여기서는 플레이스홀더.
    const reportWithMetadata: DailyReportLog = {
      ...reportData,
      date,
      metadata: reportData.metadata ?? {
        model: "claude-opus-4-6",
        tokensUsed: { input: 0, output: 0 },
        toolCalls: 0,
        executionTime: 0,
      },
    };

    saveReportLog(reportWithMetadata);

    return JSON.stringify({
      success: true,
      date: reportWithMetadata.date,
      symbolCount: reportWithMetadata.reportedSymbols.length,
    });
  },
};

import { sendSlackMessage } from "@/agent/slack";
import type { AgentTool } from "./types";

/**
 * 슬랙 Webhook으로 리포트를 전달한다.
 */
export const sendSlackReport: AgentTool = {
  definition: {
    name: "send_slack_report",
    description:
      "슬랙 Webhook으로 리포트 메시지를 전달합니다. 슬랙 마크다운 포맷으로 작성된 메시지를 전달하세요. 4000자 이내로 작성해야 합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "슬랙으로 전달할 리포트 메시지 (마크다운 포맷)",
        },
      },
      required: ["message"],
    },
  },

  async execute(input) {
    const message = input.message as string;

    if (message.length === 0) {
      return JSON.stringify({ error: "메시지가 비어있습니다" });
    }

    await sendSlackMessage(message);
    return JSON.stringify({
      success: true,
      messageLength: message.length,
    });
  },
};

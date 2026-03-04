import { sendSlackMessage } from "@/agent/slack";
import type { AgentTool } from "./types";
import { validateString } from "./validation";

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
    const message = validateString(input.message);
    if (message == null) {
      return JSON.stringify({ error: "메시지가 비어있거나 유효하지 않습니다" });
    }

    await sendSlackMessage(message);
    return JSON.stringify({
      success: true,
      messageLength: message.length,
    });
  },
};

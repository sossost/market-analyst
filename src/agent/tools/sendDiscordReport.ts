import { sendDiscordMessage } from "@/agent/discord";
import type { AgentTool } from "./types";
import { validateString } from "./validation";

/**
 * Discord Webhook으로 리포트를 전달한다.
 */
export const sendDiscordReport: AgentTool = {
  definition: {
    name: "send_discord_report",
    description:
      "Discord Webhook으로 리포트 메시지를 전달합니다. 마크다운 포맷으로 작성된 메시지를 전달하세요. 2000자 이내로 작성해야 합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "Discord로 전달할 리포트 메시지 (마크다운 포맷)",
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

    await sendDiscordMessage(message);
    return JSON.stringify({
      success: true,
      messageLength: message.length,
    });
  },
};

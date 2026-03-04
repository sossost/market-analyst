import { sendDiscordFile, sendDiscordMessage } from "@/agent/discord";
import type { AgentTool } from "./types";
import { validateString } from "./validation";

/**
 * Discord Webhook으로 리포트를 전달하는 도구를 생성한다.
 * webhookEnvVar로 채널을 분리할 수 있다 (일간/주간).
 */
export function createSendDiscordReport(webhookEnvVar: string): AgentTool {
  return {
    definition: {
      name: "send_discord_report",
      description:
        "Discord Webhook으로 리포트를 전달합니다. message는 2000자 이내 요약, markdownContent는 상세 리포트(표 포함)로 MD 파일 첨부됩니다.",
      input_schema: {
        type: "object" as const,
        properties: {
          message: {
            type: "string",
            description: "Discord 메시지 본문 (2000자 이내 요약)",
          },
          markdownContent: {
            type: "string",
            description:
              "상세 리포트 마크다운 (표 포함). 제공 시 .md 파일로 첨부됩니다.",
          },
          filename: {
            type: "string",
            description:
              "첨부 파일명 (예: daily-2026-03-04.md). markdownContent와 함께 사용.",
          },
        },
        required: ["message"],
      },
    },

    async execute(input) {
      const message = validateString(input.message);
      if (message == null) {
        return JSON.stringify({
          error: "메시지가 비어있거나 유효하지 않습니다",
        });
      }

      const webhookUrl = process.env[webhookEnvVar];
      if (webhookUrl == null || webhookUrl === "") {
        return JSON.stringify({
          error: `${webhookEnvVar} 환경변수가 설정되지 않았습니다`,
        });
      }

      const mdContent = validateString(input.markdownContent);
      const filename = validateString(input.filename);

      if (mdContent != null && filename != null) {
        await sendDiscordFile(webhookUrl, message, filename, mdContent);
        return JSON.stringify({
          success: true,
          messageLength: message.length,
          fileAttached: true,
          filename,
        });
      }

      await sendDiscordMessage(message);
      return JSON.stringify({
        success: true,
        messageLength: message.length,
        fileAttached: false,
      });
    },
  };
}

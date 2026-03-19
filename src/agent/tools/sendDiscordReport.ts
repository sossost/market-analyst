import type Anthropic from "@anthropic-ai/sdk";
import { sendDiscordError, sendDiscordFile, sendDiscordMessage } from "@/agent/discord";
import { createGist } from "@/agent/gist";
import { sanitizePhase2Ratios, validateReport } from "@/agent/lib/reportValidator";
import { logger } from "@/agent/logger";
import type { AgentTool } from "./types";
import { validateString } from "./validation";

/**
 * send_discord_report 도구 스키마.
 * createSendDiscordReport와 createDraftCaptureTool에서 공유한다.
 */
export const SEND_DISCORD_REPORT_SCHEMA: Anthropic.Tool = {
  name: "send_discord_report",
  description:
    "Discord Webhook으로 리포트를 전달합니다. message는 2000자 이내 요약, markdownContent는 상세 리포트로 GitHub Gist에 업로드되어 링크가 첨부됩니다.",
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
          "상세 리포트 마크다운 (표 포함). GitHub Gist로 업로드됩니다.",
      },
      filename: {
        type: "string",
        description:
          "파일명 (예: daily-2026-03-04.md). markdownContent와 함께 사용.",
      },
    },
    required: ["message"],
  },
};

/**
 * 마크다운 리포트에 자동 품질 검증 결과를 삽입한다.
 * warnings/errors가 없으면 원본을 그대로 반환한다.
 *
 * @remarks errors가 있어도 이 함수는 삽입만 한다. 발송 차단은 execute에서 담당한다.
 */
export function appendValidationWarnings(markdown: string): string {
  const result = validateReport({ markdown });

  const messages = [...result.errors, ...result.warnings];
  if (messages.length === 0) {
    return markdown;
  }

  const warningSection = messages.map((msg) => `- ${msg}`).join("\n");
  return `${markdown}\n\n---\n**[자동 품질 검증 결과]**\n${warningSection}`;
}

/**
 * errors가 있을 때 에러 채널로 발송하고 차단 메시지를 반환한다.
 * 내부 전용 — execute에서만 호출.
 */
async function blockAndNotify(errors: string[]): Promise<string> {
  const errorSummary = errors.map((e) => `- ${e}`).join("\n");
  const notice = `리포트 품질 검증 실패로 발송이 차단되었습니다.\n\n${errorSummary}`;
  await sendDiscordError(notice);
  return JSON.stringify({
    success: false,
    error: `리포트 품질 검증 실패: ${errors.join(" | ")}. 발송 차단됨`,
  });
}

/**
 * Discord Webhook으로 리포트를 전달하는 도구를 생성한다.
 * markdownContent가 있으면 GitHub Gist로 생성하여 링크를 메시지에 추가.
 * Gist 실패 시 기존 MD 파일 첨부로 fallback.
 */
export function createSendDiscordReport(webhookEnvVar: string): AgentTool {
  return {
    definition: SEND_DISCORD_REPORT_SCHEMA,

    async execute(input) {
      const rawMessage = validateString(input.message);
      if (rawMessage == null) {
        return JSON.stringify({
          error: "메시지가 비어있거나 유효하지 않습니다",
        });
      }
      // 메시지 본문도 Phase 2 이중 변환 자동 교정
      const message = sanitizePhase2Ratios(rawMessage).text;

      const webhookUrl = process.env[webhookEnvVar];
      if (webhookUrl == null || webhookUrl === "") {
        return JSON.stringify({
          error: `${webhookEnvVar} 환경변수가 설정되지 않았습니다`,
        });
      }

      const rawMdContent = validateString(input.markdownContent);

      // Phase 2 비율 이중 변환(×100) 자동 교정 + 품질 검증
      let sanitizedMd: string | null = null;
      if (rawMdContent != null) {
        const { text, corrections } = sanitizePhase2Ratios(rawMdContent);
        sanitizedMd = text;
        if (corrections.length > 0) {
          logger.warn(
            "sendDiscordReport",
            `Phase 2 비율 이중 변환 자동 교정 ${corrections.length}건: ${corrections.join(", ")}`,
          );
        }

        const validationResult = validateReport({ markdown: sanitizedMd });
        if (validationResult.errors.length > 0) {
          return blockAndNotify(validationResult.errors);
        }
      }

      const mdContent =
        sanitizedMd != null
          ? appendValidationWarnings(sanitizedMd)
          : null;
      const filename = validateString(input.filename) ?? "report.md";

      try {
        if (mdContent != null) {
          // Gist 생성 시도
          const gist = await createGist(filename, mdContent, filename);

          if (gist != null) {
            // Gist 성공 → 메시지에 링크 추가
            const messageWithLink = `${message}\n\n📄 상세 리포트: ${gist.url}`;
            await sendDiscordMessage(messageWithLink, webhookEnvVar);
            return JSON.stringify({
              success: true,
              messageLength: messageWithLink.length,
              gistUrl: gist.url,
              gistId: gist.id,
            });
          }

          // Gist 실패 → MD 파일 첨부 fallback
          await sendDiscordFile(webhookUrl, message, filename, mdContent);
          return JSON.stringify({
            success: true,
            messageLength: message.length,
            fileAttached: true,
            filename,
            gistFallback: true,
          });
        }

        // MD 없음 → 메시지만 전송
        await sendDiscordMessage(message, webhookEnvVar);
        return JSON.stringify({
          success: true,
          messageLength: message.length,
          fileAttached: false,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ success: false, error: reason });
      }
    },
  };
}

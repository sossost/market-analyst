import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";

const FALLBACK_DIR = path.resolve(process.cwd(), "data/reports/fallback");
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Send a message to Discord via the given webhook URL.
 * Falls back to local file if webhook fails.
 */
async function sendToWebhook(
  webhookUrl: string,
  message: string,
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (response.ok === false) {
    const body = await response.text().catch(() => "");
    logger.error("Discord", `Webhook failed (${response.status}): ${body}`);
    saveFallback(message);
    throw new Error(`Discord webhook failed: ${response.status}`);
  }

  logger.info("Discord", "Message sent successfully");
}

/**
 * Send a message to Discord via the specified webhook env var.
 * Falls back to local file if webhook is not set or fails.
 */
export async function sendDiscordMessage(
  message: string,
  webhookEnvVar: string = "DISCORD_WEBHOOK_URL",
): Promise<void> {
  const webhookUrl = process.env[webhookEnvVar];
  if (webhookUrl == null || webhookUrl === "") {
    logger.warn("Discord", `${webhookEnvVar} not set, saving to fallback file`);
    saveFallback(message);
    return;
  }

  await sendToWebhook(webhookUrl, message);
}

/**
 * Send an error notification to Discord via DISCORD_ERROR_WEBHOOK_URL.
 * Falls back to DISCORD_WEBHOOK_URL if error webhook is not set.
 * Does not throw — errors are logged only.
 */
export async function sendDiscordError(errorMessage: string): Promise<void> {
  const message = `⚠️ Agent Core 에러\n\n${errorMessage}`;
  const errorWebhookUrl = process.env.DISCORD_ERROR_WEBHOOK_URL;
  const fallbackWebhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const webhookUrl =
    errorWebhookUrl != null && errorWebhookUrl !== ""
      ? errorWebhookUrl
      : fallbackWebhookUrl;

  if (webhookUrl == null || webhookUrl === "") {
    logger.warn("Discord", "No webhook URL available for error notification");
    saveFallback(message);
    return;
  }

  try {
    await sendToWebhook(webhookUrl, message);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error("Discord", `Failed to send error notification: ${reason}`);
  }
}

/**
 * Send a message with an attached MD file to Discord via multipart/form-data.
 * Falls back to text-only message if file upload fails.
 */
export async function sendDiscordFile(
  webhookUrl: string,
  message: string,
  filename: string,
  mdContent: string,
): Promise<void> {
  const formData = new FormData();
  formData.append("payload_json", JSON.stringify({ content: message, allowed_mentions: { parse: [] } }));
  formData.append(
    "files[0]",
    new Blob([mdContent], { type: "text/markdown" }),
    filename,
  );

  const response = await fetch(webhookUrl, {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (response.ok === false) {
    const body = await response.text().catch(() => "");
    logger.error("Discord", `File upload failed (${response.status}): ${body}`);
    saveFallback(mdContent);
    throw new Error(`Discord file upload failed: ${response.status}`);
  }

  logger.info("Discord", `File sent: ${filename}`);
}

/**
 * Save message to local file as fallback when Discord fails.
 */
function saveFallback(message: string): void {
  fs.mkdirSync(FALLBACK_DIR, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(FALLBACK_DIR, `discord-${timestamp}.txt`);
  fs.writeFileSync(filePath, message, "utf-8");
  logger.info("Discord", `Fallback saved: ${filePath}`);
}

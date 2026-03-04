import fs from "node:fs";
import path from "node:path";

const FALLBACK_DIR = path.resolve(process.cwd(), "data/reports/fallback");

/**
 * Send a message to Slack via Incoming Webhook.
 * Falls back to local file if webhook fails.
 */
export async function sendSlackMessage(message: string): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (webhookUrl == null || webhookUrl === "") {
    console.warn("  [Slack] SLACK_WEBHOOK_URL not set, saving to fallback file");
    saveFallback(message);
    return;
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(
      `  [Slack] Webhook failed (${response.status}): ${body}`,
    );
    saveFallback(message);
    throw new Error(`Slack webhook failed: ${response.status}`);
  }

  console.log("  [Slack] Message sent successfully");
}

/**
 * Send an error notification to Slack.
 * Does not throw — errors are logged only.
 */
export async function sendSlackError(errorMessage: string): Promise<void> {
  const message = `⚠️ Agent Core 에러\n\n${errorMessage}`;

  try {
    await sendSlackMessage(message);
  } catch {
    console.error("  [Slack] Failed to send error notification");
  }
}

/**
 * Save message to local file as fallback when Slack fails.
 */
function saveFallback(message: string): void {
  if (!fs.existsSync(FALLBACK_DIR)) {
    fs.mkdirSync(FALLBACK_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(FALLBACK_DIR, `slack-${timestamp}.txt`);
  fs.writeFileSync(filePath, message, "utf-8");
  console.log(`  [Slack] Fallback saved: ${filePath}`);
}

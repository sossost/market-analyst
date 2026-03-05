import { db } from "../../db/client.js";
import { agentLearnings, theses } from "../../db/schema/analyst.js";
import { eq, desc } from "drizzle-orm";
import { logger } from "../logger.js";

const MAX_LEARNINGS = 50;
const MAX_RECENT_THESES = 10;

/**
 * Load active learnings from DB and format as system prompt text.
 */
async function loadLearnings(): Promise<string> {
  const rows = await db
    .select()
    .from(agentLearnings)
    .where(eq(agentLearnings.isActive, true))
    .limit(MAX_LEARNINGS);

  if (rows.length === 0) return "";

  const confirmed = rows.filter((r) => r.category === "confirmed");
  const caution = rows.filter((r) => r.category === "caution");

  const lines: string[] = [];

  if (confirmed.length > 0) {
    lines.push("### 검증된 원칙");
    for (const r of confirmed) {
      const rate = r.hitRate != null ? ` (적중률 ${(Number(r.hitRate) * 100).toFixed(0)}%)` : "";
      lines.push(`- ${r.principle}${rate}`);
    }
  }

  if (caution.length > 0) {
    lines.push("\n### 경계 패턴");
    for (const r of caution) {
      lines.push(`- ⚠️ ${r.principle}`);
    }
  }

  return lines.join("\n");
}

/**
 * Load recently verified thesis results for context.
 */
async function loadRecentVerifications(): Promise<string> {
  const [confirmed, invalidated] = await Promise.all([
    db
      .select()
      .from(theses)
      .where(eq(theses.status, "CONFIRMED"))
      .orderBy(desc(theses.verificationDate))
      .limit(MAX_RECENT_THESES),
    db
      .select()
      .from(theses)
      .where(eq(theses.status, "INVALIDATED"))
      .orderBy(desc(theses.verificationDate))
      .limit(MAX_RECENT_THESES),
  ]);

  if (confirmed.length === 0 && invalidated.length === 0) return "";

  const lines: string[] = [];

  if (confirmed.length > 0) {
    lines.push("### 최근 적중한 예측");
    for (const r of confirmed) {
      lines.push(`- [${r.agentPersona}] ${r.thesis} → ${r.verificationResult ?? "확인됨"}`);
    }
  }

  if (invalidated.length > 0) {
    lines.push("\n### 최근 빗나간 예측");
    for (const r of invalidated) {
      lines.push(`- [${r.agentPersona}] ${r.thesis} → ${r.closeReason ?? "무효화"}`);
    }
  }

  return lines.join("\n");
}

/**
 * Build full memory context string for injection into debate system prompts.
 * Returns empty string if no learnings or verifications exist.
 */
export async function buildMemoryContext(): Promise<string> {
  const [learnings, verifications] = await Promise.all([
    loadLearnings(),
    loadRecentVerifications(),
  ]);

  const sections = [learnings, verifications].filter((s) => s.length > 0);

  if (sections.length === 0) {
    logger.info("MemoryLoader", "No memory context available");
    return "";
  }

  logger.info("MemoryLoader", `Memory context loaded (${sections.length} sections)`);
  return sections.join("\n\n");
}

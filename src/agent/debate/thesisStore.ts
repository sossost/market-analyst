import { db } from "../../db/client.js";
import { theses } from "../../db/schema/analyst.js";
import { eq } from "drizzle-orm";
import { logger } from "../logger.js";
import type { Thesis } from "../../types/debate.js";

/**
 * Save extracted theses to DB as ACTIVE.
 * Returns count of saved theses.
 */
export async function saveTheses(
  debateDate: string,
  extractedTheses: Thesis[],
): Promise<number> {
  if (extractedTheses.length === 0) {
    logger.info("ThesisStore", "No theses to save");
    return 0;
  }

  const rows = extractedTheses.map((t) => ({
    debateDate,
    agentPersona: t.agentPersona,
    thesis: t.thesis,
    timeframeDays: t.timeframeDays,
    verificationMetric: t.verificationMetric,
    targetCondition: t.targetCondition,
    invalidationCondition: t.invalidationCondition ?? null,
    confidence: t.confidence,
    consensusLevel: t.consensusLevel,
    status: "ACTIVE" as const,
  }));

  const result = await db.insert(theses).values(rows).returning({ id: theses.id });
  logger.info("ThesisStore", `Saved ${result.length} theses for ${debateDate}`);
  return result.length;
}

/**
 * Load active theses from DB.
 */
export async function loadActiveTheses() {
  return db
    .select()
    .from(theses)
    .where(eq(theses.status, "ACTIVE"));
}

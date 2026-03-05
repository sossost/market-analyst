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

  // 같은 날짜의 기존 thesis 삭제 (재실행 시 중복 방지)
  await db.delete(theses).where(eq(theses.debateDate, debateDate));

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

/**
 * ACTIVE theses를 주간 에이전트 프롬프트용 텍스트로 변환.
 * 빈 배열이면 빈 문자열 반환.
 */
export function formatThesesForPrompt(
  rows: Awaited<ReturnType<typeof loadActiveTheses>>,
): string {
  if (rows.length === 0) return "";

  const PERSONA_LABEL: Record<string, string> = {
    macro: "매크로 이코노미스트",
    tech: "테크 애널리스트",
    geopolitics: "지정학 전략가",
    sentiment: "시장 심리 분석가",
  };

  const lines: string[] = [];

  for (const t of rows) {
    const persona = PERSONA_LABEL[t.agentPersona] ?? t.agentPersona;
    const conf = t.confidence === "high" ? "HIGH" : t.confidence === "medium" ? "MED" : "LOW";
    lines.push(
      `- [${conf}/${t.consensusLevel}] ${persona}: ${t.thesis} (${t.timeframeDays}일, 검증: ${t.verificationMetric} ${t.targetCondition})`,
    );
  }

  return lines.join("\n");
}

import { db } from "@/db/client";
import {
  metaRegimes,
  narrativeChains,
  type MetaRegimePropagationType,
  type MetaRegimeStatus,
} from "@/db/schema/analyst";
import { eq, inArray, asc } from "drizzle-orm";
import { logger } from "@/lib/logger";

// ─── Types ──────────────────────────────────────────────────────────

export interface MetaRegimeInput {
  name: string;
  description?: string;
  propagationType: MetaRegimePropagationType;
  activatedAt?: Date;
}

export interface MetaRegimeWithChains {
  id: number;
  name: string;
  description: string | null;
  propagationType: MetaRegimePropagationType;
  status: MetaRegimeStatus;
  activatedAt: Date | null;
  peakAt: Date | null;
  chains: Array<{
    id: number;
    bottleneck: string;
    supplyChain: string;
    sequenceOrder: number | null;
    sequenceConfidence: string | null;
    status: string;
    activatedAt: Date | null;
    peakAt: Date | null;
  }>;
}

// ─── CRUD ───────────────────────────────────────────────────────────

export async function createMetaRegime(
  input: MetaRegimeInput,
): Promise<{ id: number }> {
  const [result] = await db
    .insert(metaRegimes)
    .values({
      name: input.name,
      description: input.description ?? null,
      propagationType: input.propagationType,
      activatedAt: input.activatedAt ?? new Date(),
    })
    .returning({ id: metaRegimes.id });

  if (result == null) {
    throw new Error(`Failed to insert meta-regime: no row returned for "${input.name}"`);
  }

  logger.info(
    "MetaRegime",
    `Created meta-regime #${result.id}: "${input.name}" (${input.propagationType})`,
  );

  return result;
}

export async function getActiveMetaRegimes(): Promise<
  Array<{
    id: number;
    name: string;
    description: string | null;
    propagationType: MetaRegimePropagationType;
    status: MetaRegimeStatus;
    activatedAt: Date | null;
    peakAt: Date | null;
  }>
> {
  const activeStatuses: MetaRegimeStatus[] = ["ACTIVE", "PEAKED"];
  return db
    .select({
      id: metaRegimes.id,
      name: metaRegimes.name,
      description: metaRegimes.description,
      propagationType: metaRegimes.propagationType,
      status: metaRegimes.status,
      activatedAt: metaRegimes.activatedAt,
      peakAt: metaRegimes.peakAt,
    })
    .from(metaRegimes)
    .where(inArray(metaRegimes.status, activeStatuses));
}

export async function getMetaRegimeWithChains(
  regimeId: number,
): Promise<MetaRegimeWithChains | null> {
  const [regime] = await db
    .select({
      id: metaRegimes.id,
      name: metaRegimes.name,
      description: metaRegimes.description,
      propagationType: metaRegimes.propagationType,
      status: metaRegimes.status,
      activatedAt: metaRegimes.activatedAt,
      peakAt: metaRegimes.peakAt,
    })
    .from(metaRegimes)
    .where(eq(metaRegimes.id, regimeId));

  if (regime == null) return null;

  const chains = await db
    .select({
      id: narrativeChains.id,
      bottleneck: narrativeChains.bottleneck,
      supplyChain: narrativeChains.supplyChain,
      sequenceOrder: narrativeChains.sequenceOrder,
      sequenceConfidence: narrativeChains.sequenceConfidence,
      status: narrativeChains.status,
      activatedAt: narrativeChains.activatedAt,
      peakAt: narrativeChains.peakAt,
    })
    .from(narrativeChains)
    .where(eq(narrativeChains.metaRegimeId, regimeId))
    .orderBy(asc(narrativeChains.sequenceOrder));

  return {
    ...regime,
    chains,
  };
}

// ─── Prompt Formatting ──────────────────────────────────────────────

/**
 * Sanitize a string for safe inclusion in a markdown table cell.
 * Strips newlines and replaces pipe characters to prevent table breakage.
 */
function sanitizeCell(value: string): string {
  return value.replace(/\|/g, "｜").replace(/\n/g, " ").trim();
}

const PROPAGATION_LABEL: Record<MetaRegimePropagationType, string> = {
  supply_chain: "병목 전파 (Bullwhip)",
  narrative_shift: "내러티브 전환",
};

/**
 * Format active meta-regimes with their chains for agent prompt injection.
 * Returns empty string if no active regimes exist.
 */
export async function formatMetaRegimesForPrompt(): Promise<string> {
  const regimes = await getActiveMetaRegimes();
  if (regimes.length === 0) return "";

  const sections: string[] = [
    "## 현재 활성 국면 (Meta-Regime)\n",
    "국면은 여러 내러티브 체인이 순차적으로 활성화되는 상위 테마 사이클입니다.",
    "현재 자금이 어디에 있고, 다음에 어디로 갈지 판단할 때 아래 순서를 참조하세요.\n",
  ];

  for (const regime of regimes) {
    const propagation = PROPAGATION_LABEL[regime.propagationType];
    const statusTag = regime.status === "PEAKED" ? " (피크 통과)" : "";

    sections.push(`### ${regime.name}${statusTag}`);
    sections.push(`- 전파 유형: ${propagation}`);

    if (regime.description != null) {
      sections.push(`- 설명: ${regime.description}`);
    }

    // Fetch chains for this regime
    const chains = await db
      .select({
        bottleneck: narrativeChains.bottleneck,
        supplyChain: narrativeChains.supplyChain,
        sequenceOrder: narrativeChains.sequenceOrder,
        sequenceConfidence: narrativeChains.sequenceConfidence,
        status: narrativeChains.status,
      })
      .from(narrativeChains)
      .where(eq(narrativeChains.metaRegimeId, regime.id))
      .orderBy(asc(narrativeChains.sequenceOrder));

    if (chains.length > 0) {
      sections.push("");
      sections.push("| 순서 | 체인 (병목) | 공급망 경로 | 상태 | 신뢰도 |");
      sections.push("|------|-----------|-----------|------|--------|");

      for (const chain of chains) {
        const order = chain.sequenceOrder ?? "—";
        const supply = chain.supplyChain !== "" ? sanitizeCell(chain.supplyChain) : "—";
        const confidence = chain.sequenceConfidence ?? "—";
        sections.push(
          `| ${order} | ${sanitizeCell(chain.bottleneck)} | ${supply} | ${chain.status} | ${confidence} |`,
        );
      }
    }

    sections.push("");
  }

  return sections.join("\n");
}

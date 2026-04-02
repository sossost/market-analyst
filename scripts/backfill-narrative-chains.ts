/**
 * Narrative Chains 백필 스크립트.
 *
 * 3/21~4/1 기간 동안 narrative_chains에 연결되지 못한
 * structural_narrative thesis 14건을 복구한다.
 *
 * 처리 로직:
 * 1. theses 테이블에서 category='structural_narrative' AND debate_date IN [2026-03-21, 2026-04-01] 조회
 * 2. 이미 narrative_chains.linked_thesis_ids에 포함된 thesis는 건너뜀 (중복 방지)
 * 3. 각 thesis에 대해 recordNarrativeChain 호출
 *
 * Usage:
 *   npx tsx scripts/backfill-narrative-chains.ts            # 실행
 *   npx tsx scripts/backfill-narrative-chains.ts --dry-run   # 처리 대상만 출력
 */
import "dotenv/config";
import { pool } from "../src/db/client.js";
import { db } from "../src/db/client.js";
import { narrativeChains, theses } from "../src/db/schema/analyst.js";
import { eq, and, gte, lte } from "drizzle-orm";
import { recordNarrativeChain } from "../src/debate/narrativeChainService.js";
import type { Thesis } from "../src/types/debate.js";

const TAG = "BACKFILL_NARRATIVE_CHAINS";
const BACKFILL_FROM = "2026-03-21";
const BACKFILL_TO = "2026-04-01";

interface ThesisRow {
  id: number;
  debateDate: string;
  agentPersona: string;
  thesis: string;
  timeframeDays: number;
  verificationMetric: string;
  targetCondition: string;
  invalidationCondition: string | null;
  confidence: string;
  consensusLevel: string;
  nextBottleneck: string | null;
  dissentReason: string | null;
}

async function fetchTargetTheses(): Promise<ThesisRow[]> {
  const rows = await db
    .select({
      id: theses.id,
      debateDate: theses.debateDate,
      agentPersona: theses.agentPersona,
      thesis: theses.thesis,
      timeframeDays: theses.timeframeDays,
      verificationMetric: theses.verificationMetric,
      targetCondition: theses.targetCondition,
      invalidationCondition: theses.invalidationCondition,
      confidence: theses.confidence,
      consensusLevel: theses.consensusLevel,
      nextBottleneck: theses.nextBottleneck,
      dissentReason: theses.dissentReason,
    })
    .from(theses)
    .where(
      and(
        eq(theses.category, "structural_narrative"),
        gte(theses.debateDate, BACKFILL_FROM),
        lte(theses.debateDate, BACKFILL_TO),
      ),
    )
    .orderBy(theses.debateDate);

  return rows;
}

async function fetchAlreadyLinkedThesisIds(): Promise<Set<number>> {
  const chains = await db
    .select({ linkedThesisIds: narrativeChains.linkedThesisIds })
    .from(narrativeChains);

  const linked = new Set<number>();
  for (const chain of chains) {
    const ids = chain.linkedThesisIds;
    if (Array.isArray(ids)) {
      for (const id of ids) {
        linked.add(id);
      }
    }
  }
  return linked;
}

function toThesisObject(row: ThesisRow): Thesis {
  return {
    agentPersona: row.agentPersona as Thesis["agentPersona"],
    thesis: row.thesis,
    timeframeDays: row.timeframeDays as Thesis["timeframeDays"],
    verificationMetric: row.verificationMetric,
    targetCondition: row.targetCondition,
    invalidationCondition: row.invalidationCondition ?? undefined,
    confidence: row.confidence as Thesis["confidence"],
    consensusLevel: row.consensusLevel as Thesis["consensusLevel"],
    category: "structural_narrative",
    nextBottleneck: row.nextBottleneck ?? null,
    dissentReason: row.dissentReason ?? null,
    // theses 테이블에 beneficiaryTickers/beneficiarySectors 컬럼이 없으므로 빈 배열로 구성
    beneficiaryTickers: [],
    beneficiarySectors: [],
  };
}

async function main() {
  const isDryRun = process.argv.includes("--dry-run");

  console.log(`[${TAG}] 백필 범위: ${BACKFILL_FROM} ~ ${BACKFILL_TO}`);
  if (isDryRun) {
    console.log(`[${TAG}] --dry-run 모드 — DB 수정 없이 처리 대상만 출력`);
  }

  const [targetTheses, alreadyLinked] = await Promise.all([
    fetchTargetTheses(),
    fetchAlreadyLinkedThesisIds(),
  ]);

  console.log(`[${TAG}] structural_narrative thesis 조회: ${targetTheses.length}건`);

  const pending = targetTheses.filter((row) => !alreadyLinked.has(row.id));
  const skipped = targetTheses.length - pending.length;

  console.log(`[${TAG}] 이미 연결됨(건너뜀): ${skipped}건`);
  console.log(`[${TAG}] 처리 대상: ${pending.length}건`);

  if (pending.length === 0) {
    console.log(`[${TAG}] 처리할 thesis 없음. 종료.`);
    return;
  }

  console.log(`\n처리 대상 목록:`);
  for (const row of pending) {
    console.log(`  #${row.id} (${row.debateDate}) ${row.thesis.slice(0, 80)}...`);
  }

  if (isDryRun) {
    console.log(`\n[${TAG}] Dry run 완료 — 변경 사항 없음.`);
    return;
  }

  let successCount = 0;
  let failCount = 0;

  for (const row of pending) {
    const thesisObj = toThesisObject(row);
    try {
      await recordNarrativeChain(thesisObj, row.id);
      successCount++;
      console.log(`[${TAG}] 완료 #${row.id} (${row.debateDate})`);
    } catch (err) {
      failCount++;
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[${TAG}] 실패 #${row.id}: ${reason}`);
    }
  }

  console.log(`\n[${TAG}] 처리 완료 — 성공: ${successCount}건, 실패: ${failCount}건`);
}

let exitCode = 0;
main()
  .catch((error) => {
    console.error(
      `[${TAG}] 치명적 오류:`,
      error instanceof Error ? error.message : String(error),
    );
    exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
    process.exit(exitCode);
  });

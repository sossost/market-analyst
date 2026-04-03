/**
 * Narrative Chains 전면 재백필 스크립트.
 *
 * #608: 서사체인 파싱 재설계 후, 오염된 기존 데이터를 삭제하고
 * 모든 structural_narrative thesis를 신규 로직으로 재처리한다.
 *
 * 처리 로직:
 * 1. narrative_chains 테이블 TRUNCATE (오염 데이터 삭제)
 * 2. theses 테이블에서 category='structural_narrative' 전건 조회 (날짜 오름차순)
 * 3. 각 thesis에 대해 recordNarrativeChain 순차 호출 (체인 매칭 순서 보존)
 *
 * Usage:
 *   npx tsx scripts/backfill-narrative-chains.ts            # 실행
 *   npx tsx scripts/backfill-narrative-chains.ts --dry-run   # 처리 대상만 출력
 */
import "dotenv/config";
import { pool } from "../src/db/client.js";
import { db } from "../src/db/client.js";
import { narrativeChains, theses } from "../src/db/schema/analyst.js";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { recordNarrativeChain } from "../src/debate/narrativeChainService.js";
import type { Thesis } from "../src/types/debate.js";

const TAG = "BACKFILL_NARRATIVE_CHAINS";

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

async function fetchAllStructuralTheses(): Promise<ThesisRow[]> {
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
    .where(eq(theses.category, "structural_narrative"))
    .orderBy(theses.debateDate);

  return rows;
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
    // theses 테이블에 beneficiaryTickers/beneficiarySectors 컬럼이 없으므로 빈 배열
    // narrativeChain 필드도 없음 → buildChainFields legacy fallback 사용
    beneficiaryTickers: [],
    beneficiarySectors: [],
    narrativeChain: null,
  };
}

async function main() {
  const isDryRun = process.argv.includes("--dry-run");

  console.log(`[${TAG}] #608 서사체인 전면 재백필`);
  if (isDryRun) {
    console.log(`[${TAG}] --dry-run 모드 — DB 수정 없이 처리 대상만 출력`);
  }

  const targetTheses = await fetchAllStructuralTheses();
  console.log(`[${TAG}] structural_narrative thesis 전건: ${targetTheses.length}건`);

  if (targetTheses.length === 0) {
    console.log(`[${TAG}] 처리할 thesis 없음. 종료.`);
    return;
  }

  console.log(`\n처리 대상 목록:`);
  for (const row of targetTheses) {
    console.log(`  #${row.id} (${row.debateDate}) ${row.thesis.slice(0, 80)}...`);
  }

  if (isDryRun) {
    console.log(`\n[${TAG}] Dry run 완료 — 변경 사항 없음.`);
    return;
  }

  // Step 1: 백업 테이블 생성 (TRUNCATE 롤백 안전망)
  console.log(`\n[${TAG}] 백업 테이블 생성...`);
  await db.execute(sql`DROP TABLE IF EXISTS narrative_chains_backup_608`);
  await db.execute(sql`CREATE TABLE narrative_chains_backup_608 AS SELECT * FROM narrative_chains`);
  console.log(`[${TAG}] 백업 완료 → narrative_chains_backup_608`);
  console.log(`[${TAG}] (복원 필요 시: INSERT INTO narrative_chains SELECT * FROM narrative_chains_backup_608)`);

  // Step 2: TRUNCATE narrative_chains (오염 데이터 전체 삭제)
  console.log(`\n[${TAG}] narrative_chains TRUNCATE 시작...`);
  await db.execute(sql`TRUNCATE TABLE narrative_chains RESTART IDENTITY`);
  console.log(`[${TAG}] narrative_chains TRUNCATE 완료`);

  // Step 3: 날짜 오름차순으로 순차 재백필
  let successCount = 0;
  let failCount = 0;

  for (const row of targetTheses) {
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

  // Step 4: 결과 요약
  const finalCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(narrativeChains);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`[${TAG}] 재백필 완료`);
  console.log(`  thesis 처리: ${successCount}건 성공, ${failCount}건 실패`);
  console.log(`  최종 narrative_chains 레코드 수: ${finalCount[0]?.count ?? 0}건`);
  console.log(`  (재백필 전 33건 → 중복 제거로 감소 예상)`);
  console.log(`\n  백업 테이블: narrative_chains_backup_608`);
  console.log(`  검증 후 삭제: DROP TABLE narrative_chains_backup_608;`);
  console.log(`${"=".repeat(60)}`);
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

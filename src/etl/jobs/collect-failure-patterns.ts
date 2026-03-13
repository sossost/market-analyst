import "dotenv/config";
import { db, pool } from "@/db/client";
import { signalLog, failurePatterns } from "@/db/schema/analyst";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { binomialTest } from "@/lib/statisticalTests";
import { eq, sql } from "drizzle-orm";
import type { FailureConditions } from "@/types/failure";
import { logger } from "@/agent/logger";

const TAG = "COLLECT_FAILURE_PATTERNS";

/**
 * failureConditions JSON 문자열을 파싱하고 필수 필드를 검증한다.
 * 유효하지 않은 JSON이거나 object가 아니면 null을 반환한다.
 */
export function parseFailureConditions(json: string): FailureConditions | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed == null || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    return {
      marketBreadthDirection: (obj.marketBreadthDirection as FailureConditions["marketBreadthDirection"]) ?? null,
      sectorRsIsolated: (obj.sectorRsIsolated as boolean) ?? null,
      volumeConfirmed: (obj.volumeConfirmed as boolean) ?? null,
      sepaGrade: (obj.sepaGrade as FailureConditions["sepaGrade"]) ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * 실패 패턴 수집 ETL.
 *
 * signal_log에서 Phase 2 회귀/성공 레코드를 로드하고,
 * failureConditions의 조건 조합별 실패율을 산출하여
 * failure_patterns 테이블에 upsert한다.
 *
 * 흐름:
 * 1. signal_log에서 phase2Reverted가 판정된 레코드 로드
 * 2. failureConditions JSON 파싱
 * 3. 조건 조합 키 생성 (개별 + 2개 조합)
 * 4. 조합별 실패율 산출
 * 5. binomialTest로 통계 유의성 검증
 * 6. 유의한 패턴 → failure_patterns upsert
 * 7. 비활성화 대상 → isActive = false
 */

const FAILURE_RATE_THRESHOLD = 0.70;

// ─── Pure logic (exported for testing) ──────────────────────────────

/**
 * FailureConditions에서 개별 조건 키를 추출한다.
 * null 값은 건너뛴다.
 */
export function extractConditionKeys(
  conditions: FailureConditions,
): string[] {
  const keys: string[] = [];

  if (conditions.marketBreadthDirection != null) {
    keys.push(`breadth:${conditions.marketBreadthDirection}`);
  }
  if (conditions.sectorRsIsolated != null) {
    keys.push(`sector_isolated:${conditions.sectorRsIsolated}`);
  }
  if (conditions.volumeConfirmed != null) {
    keys.push(`volume:${conditions.volumeConfirmed}`);
  }
  if (conditions.sepaGrade != null) {
    // C, F 등급을 그룹화
    const gradeKey =
      conditions.sepaGrade === "C" || conditions.sepaGrade === "F"
        ? "C-F"
        : conditions.sepaGrade;
    keys.push(`sepa:${gradeKey}`);
  }

  return keys;
}

/**
 * 개별 조건 키에서 2개 이하 조합을 생성한다.
 * 개별 키 + 2개 조합까지만 (폭발 방지).
 * 조합 키는 알파벳순으로 정렬하여 일관성을 보장한다.
 */
export function generateConditionCombinations(keys: string[]): string[] {
  const combinations: string[] = [];

  // 개별 키
  for (const key of keys) {
    combinations.push(key);
  }

  // 2개 조합
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const pair = [keys[i], keys[j]].sort();
      combinations.push(pair.join("|"));
    }
  }

  return combinations;
}

/**
 * 조건 조합 키를 사람이 읽을 수 있는 패턴 이름으로 변환한다.
 */
export function conditionKeyToName(key: string): string {
  const parts = key.split("|");
  const names = parts.map((part) => {
    const [type, value] = part.split(":");
    switch (type) {
      case "breadth":
        return value === "declining"
          ? "브레드스 악화"
          : value === "improving"
            ? "브레드스 개선"
            : "브레드스 보합";
      case "sector_isolated":
        return value === "true" ? "섹터 고립 상승" : "섹터 동반 상승";
      case "volume":
        return value === "true" ? "거래량 확인" : "거래량 미확인";
      case "sepa":
        return value === "C-F"
          ? "펀더멘탈 부실"
          : `펀더멘탈 ${value}등급`;
      default:
        return part;
    }
  });

  return names.join(" + ");
}

interface SignalRecord {
  isFailure: boolean;
  conditionCombinations: string[];
}

/**
 * 시그널 레코드 목록에서 조건 조합별 실패율을 집계한다.
 */
export function aggregateFailureRates(
  records: SignalRecord[],
): Map<string, { failureCount: number; totalCount: number }> {
  const stats = new Map<string, { failureCount: number; totalCount: number }>();

  for (const record of records) {
    for (const combo of record.conditionCombinations) {
      const existing = stats.get(combo) ?? { failureCount: 0, totalCount: 0 };
      existing.totalCount++;
      if (record.isFailure) {
        existing.failureCount++;
      }
      stats.set(combo, existing);
    }
  }

  return stats;
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  assertValidEnvironment();

  const today = new Date().toISOString().slice(0, 10);
  logger.info(TAG, `Collect failure patterns — date: ${today}`);

  // 1. phase2Reverted가 판정된 레코드 로드
  const allSignals = await db
    .select({
      id: signalLog.id,
      symbol: signalLog.symbol,
      phase2Reverted: signalLog.phase2Reverted,
      failureConditions: signalLog.failureConditions,
    })
    .from(signalLog)
    .where(sql`${signalLog.phase2Reverted} IS NOT NULL`);

  if (allSignals.length === 0) {
    logger.info(TAG, "No signals with phase2_reverted data. Skipping.");
    await pool.end();
    return;
  }

  // 2. failureConditions 파싱 및 조건 조합 생성
  const records: SignalRecord[] = [];

  for (const signal of allSignals) {
    if (signal.failureConditions == null) {
      // 회귀 판정은 됐지만 조건 데이터가 없는 경우 (성공 종료 등)
      continue;
    }

    const conditions = parseFailureConditions(signal.failureConditions);
    if (conditions == null) {
      logger.warn(TAG, `  SKIP: invalid failureConditions for signal ${signal.id}`);
      continue;
    }

    const keys = extractConditionKeys(conditions);
    if (keys.length === 0) continue;

    const combinations = generateConditionCombinations(keys);

    records.push({
      isFailure: signal.phase2Reverted === true,
      conditionCombinations: combinations,
    });
  }

  logger.info(TAG, `Parsed records: ${records.length} (from ${allSignals.length} signals)`);

  if (records.length === 0) {
    logger.info(TAG, "No parseable records. Skipping.");
    await pool.end();
    return;
  }

  // 3. 조합별 실패율 집계
  const stats = aggregateFailureRates(records);

  // 4. 기존 패턴 로드 (name → id 매핑)
  const existingPatterns = await db
    .select()
    .from(failurePatterns);

  const existingByName = new Map(
    existingPatterns.map((p) => [p.patternName, p]),
  );

  // 5. 통계 검증 + upsert (동시성 제한 병렬 처리)
  let activatedCount = 0;

  const processedNames = new Set<string>();

  const CONCURRENCY_LIMIT = 5;
  const upsertEntries = Array.from(stats.entries());

  for (let i = 0; i < upsertEntries.length; i += CONCURRENCY_LIMIT) {
    const batch = upsertEntries.slice(i, i + CONCURRENCY_LIMIT);

    await Promise.all(
      batch.map(async ([comboKey, { failureCount, totalCount }]) => {
        const failureRate = totalCount > 0 ? failureCount / totalCount : 0;
        const test = binomialTest(failureCount, totalCount);
        const patternName = conditionKeyToName(comboKey);
        const shouldBeActive =
          failureRate >= FAILURE_RATE_THRESHOLD && test.isSignificant;

        processedNames.add(patternName);

        const values = {
          patternName,
          conditions: comboKey,
          failureCount,
          totalCount,
          failureRate: String(failureRate.toFixed(4)),
          significance: String(test.pValue.toFixed(6)),
          cohenH: String(test.cohenH.toFixed(4)),
          isActive: shouldBeActive,
          lastUpdated: today,
        };

        const existing = existingByName.get(patternName);

        if (existing != null) {
          await db
            .update(failurePatterns)
            .set(values)
            .where(eq(failurePatterns.id, existing.id));
        } else {
          await db.insert(failurePatterns).values(values);
        }

        if (shouldBeActive) {
          activatedCount++;
          logger.info(
            TAG,
            `  ACTIVE: ${patternName} — ${(failureRate * 100).toFixed(0)}% (${failureCount}/${totalCount}), p=${test.pValue.toFixed(4)}`,
          );
        }
      }),
    );
  }

  // 6. 이전에 활성이었지만 이번 집계에 포함되지 않은 패턴 → 비활성화
  const toDeactivate = existingPatterns.filter(
    (p) => p.isActive === true && !processedNames.has(p.patternName),
  );

  for (let i = 0; i < toDeactivate.length; i += CONCURRENCY_LIMIT) {
    const batch = toDeactivate.slice(i, i + CONCURRENCY_LIMIT);
    await Promise.all(
      batch.map(async (pattern) => {
        await db
          .update(failurePatterns)
          .set({ isActive: false, lastUpdated: today })
          .where(eq(failurePatterns.id, pattern.id));
        logger.info(TAG, `  DEACTIVATED: ${pattern.patternName}`);
      }),
    );
  }

  const deactivatedCount = toDeactivate.length;

  logger.info(
    TAG,
    `Results: ${activatedCount} active patterns, ${deactivatedCount} deactivated`,
  );
  await pool.end();
}

main().catch(async (err) => {
  logger.error(TAG, `collect-failure-patterns failed: ${err instanceof Error ? err.message : String(err)}`);
  await pool.end();
  process.exit(1);
});

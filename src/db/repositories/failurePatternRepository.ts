import { db } from "@/db/client";
import { failurePatterns } from "@/db/schema/analyst";
import { eq } from "drizzle-orm";

export interface ActiveFailurePatternRow {
  patternName: string;
  conditions: string;
  failureRate: string | null;
  failureCount: number;
  totalCount: number;
}

/**
 * isActive=true인 실패 패턴을 조회한다.
 * collect-failure-patterns에서 failureRate >= 0.70 AND 이항검정 유의한 패턴만 isActive=true로 설정하므로
 * 추가 필터 없이 isActive만 확인하면 된다.
 */
export async function findActiveFailurePatterns(): Promise<ActiveFailurePatternRow[]> {
  const rows = await db
    .select({
      patternName: failurePatterns.patternName,
      conditions: failurePatterns.conditions,
      failureRate: failurePatterns.failureRate,
      failureCount: failurePatterns.failureCount,
      totalCount: failurePatterns.totalCount,
    })
    .from(failurePatterns)
    .where(eq(failurePatterns.isActive, true));

  return rows;
}

/**
 * portfolio_positions 테이블 조회/갱신 Repository.
 * 모델 포트폴리오 편입/청산 이력을 관리한다.
 * 재시도 로직은 호출부가 담당한다.
 */

import { db } from "@/db/client";
import { portfolioPositions } from "@/db/schema/analyst";
import { and, desc, eq } from "drizzle-orm";

// ─── 타입 정의 ────────────────────────────────────────────────────────────────

export type PortfolioStatus = "ACTIVE" | "EXITED";
export type PortfolioTier = "standard" | "featured";

export type PortfolioPositionRow = typeof portfolioPositions.$inferSelect;

export interface InsertPortfolioPositionInput {
  symbol: string;
  sector?: string;
  industry?: string;
  entryDate: string;
  entryPrice?: number;
  entryPhase?: number;
  entryRsScore?: number;
  entrySepaGrade?: string;
  thesisId?: number;
  tier?: PortfolioTier;
}

export interface UpdatePortfolioExitInput {
  exitDate: string;
  exitPrice?: number;
  exitReason?: string;
}

// ─── 에러 클래스 ─────────────────────────────────────────────────────────────

export class PortfolioPositionNotFoundError extends Error {
  constructor(symbol: string, entryDate: string) {
    super(
      `ACTIVE portfolio position not found: symbol=${symbol}, entryDate=${entryDate}`,
    );
    this.name = "PortfolioPositionNotFoundError";
  }
}

// ─── 삽입 함수 ────────────────────────────────────────────────────────────────

/**
 * 포트폴리오 포지션을 신규 등록한다.
 * UNIQUE(symbol, entry_date) 충돌 시 아무 작업도 하지 않는다.
 * 삽입된 경우 id를 반환하고, 충돌(중복)이면 null을 반환한다.
 */
export async function insertPortfolioPosition(
  input: InsertPortfolioPositionInput,
): Promise<number | null> {
  const inserted = await db
    .insert(portfolioPositions)
    .values({
      symbol: input.symbol,
      sector: input.sector ?? null,
      industry: input.industry ?? null,
      entryDate: input.entryDate,
      entryPrice: input.entryPrice != null ? String(input.entryPrice) : null,
      entryPhase: input.entryPhase ?? null,
      entryRsScore:
        input.entryRsScore != null ? String(input.entryRsScore) : null,
      entrySepaGrade: input.entrySepaGrade ?? null,
      thesisId: input.thesisId ?? null,
      tier: input.tier ?? "standard",
      status: "ACTIVE",
    })
    .onConflictDoNothing()
    .returning({ id: portfolioPositions.id });

  return inserted[0]?.id ?? null;
}

// ─── 조회 함수 ────────────────────────────────────────────────────────────────

/**
 * ACTIVE 상태인 포트폴리오 포지션 전체를 조회한다.
 * entry_date DESC 정렬.
 */
export async function getActivePortfolioPositions(): Promise<
  PortfolioPositionRow[]
> {
  return db
    .select()
    .from(portfolioPositions)
    .where(eq(portfolioPositions.status, "ACTIVE"))
    .orderBy(desc(portfolioPositions.entryDate));
}

/**
 * 지정 symbol의 가장 최신 ACTIVE 포지션을 1개 조회한다.
 * 해당 symbol의 ACTIVE 포지션이 없으면 null을 반환한다.
 */
export async function getPortfolioPositionBySymbol(
  symbol: string,
): Promise<PortfolioPositionRow | null> {
  const rows = await db
    .select()
    .from(portfolioPositions)
    .where(
      and(
        eq(portfolioPositions.symbol, symbol),
        eq(portfolioPositions.status, "ACTIVE"),
      ),
    )
    .orderBy(desc(portfolioPositions.entryDate))
    .limit(1);

  return rows[0] ?? null;
}

// ─── 갱신 함수 ────────────────────────────────────────────────────────────────

/**
 * 포트폴리오 포지션을 EXITED 상태로 전환한다.
 * symbol + entry_date 조합으로 대상 포지션을 특정한다.
 * ACTIVE 포지션이 존재하지 않으면 PortfolioPositionNotFoundError를 던진다.
 */
export async function updatePortfolioExit(
  symbol: string,
  entryDate: string,
  exit: UpdatePortfolioExitInput,
): Promise<PortfolioPositionRow> {
  const updated = await db
    .update(portfolioPositions)
    .set({
      status: "EXITED",
      exitDate: exit.exitDate,
      exitPrice: exit.exitPrice != null ? String(exit.exitPrice) : null,
      exitReason: exit.exitReason ?? null,
    })
    .where(
      and(
        eq(portfolioPositions.symbol, symbol),
        eq(portfolioPositions.entryDate, entryDate),
        eq(portfolioPositions.status, "ACTIVE"),
      ),
    )
    .returning();

  if (updated.length === 0) {
    throw new PortfolioPositionNotFoundError(symbol, entryDate);
  }

  return updated[0];
}

/**
 * 포트폴리오 포지션 전체를 조회한다 (상태 무관).
 * entry_date DESC 정렬. 기본 limit 100.
 */
export async function getAllPortfolioPositions(
  limit: number = 100,
): Promise<PortfolioPositionRow[]> {
  return db
    .select()
    .from(portfolioPositions)
    .orderBy(desc(portfolioPositions.entryDate))
    .limit(limit);
}

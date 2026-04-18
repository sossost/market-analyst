/**
 * portfolio_positions 테이블 조회/갱신 Repository.
 * 모델 포트폴리오 편입/청산 이력을 관리한다.
 * 재시도 로직은 호출부가 담당한다.
 */

import { db } from "@/db/client";
import { portfolioPositions, stockPhases } from "@/db/schema/analyst";
import { dailyPrices } from "@/db/schema/market";
import { and, desc, eq, lte } from "drizzle-orm";

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

/**
 * ACTIVE 포지션에 현재 시장 데이터(종가, Phase, RS)를 결합한 뷰.
 * 섹션 5 포트폴리오 테이블 렌더링에 사용한다.
 */
export interface PortfolioPositionWithCurrentData extends PortfolioPositionRow {
  currentPrice: number | null;
  currentPhase: number | null;
  currentRsScore: number | null;
  pnlPercent: number | null;
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

// ─── 내부 헬퍼 ───────────────────────────────────────────────────────────────

/**
 * 지정 symbol의 date 이전(또는 당일) 가장 최근 종가를 조회한다.
 * 데이터 없거나 비정상 값이면 null을 반환한다.
 */
async function fetchLatestPrice(
  symbol: string,
  date: string,
): Promise<number | null> {
  const rows = await db
    .select({ close: dailyPrices.close })
    .from(dailyPrices)
    .where(and(eq(dailyPrices.symbol, symbol), lte(dailyPrices.date, date)))
    .orderBy(desc(dailyPrices.date))
    .limit(1);

  const row = rows[0];
  if (row == null) return null;

  const val = Number(row.close);
  return Number.isFinite(val) ? val : null;
}

// ─── 삽입 함수 ────────────────────────────────────────────────────────────────

/**
 * 포트폴리오 포지션을 신규 등록한다.
 * UNIQUE(symbol, entry_date) 충돌 시 아무 작업도 하지 않는다.
 * 삽입된 경우 id를 반환하고, 충돌(중복)이면 null을 반환한다.
 *
 * entryPrice가 없으면 daily_prices에서 최신 종가를 자동 조회한다.
 * 종가 조회 실패 시 null로 INSERT를 계속 진행한다.
 */
export async function insertPortfolioPosition(
  input: InsertPortfolioPositionInput,
): Promise<number | null> {
  const resolvedEntryPrice = input.entryPrice != null
    ? input.entryPrice
    : await fetchLatestPrice(input.symbol, input.entryDate);

  const inserted = await db
    .insert(portfolioPositions)
    .values({
      symbol: input.symbol,
      sector: input.sector ?? null,
      industry: input.industry ?? null,
      entryDate: input.entryDate,
      entryPrice: resolvedEntryPrice != null ? String(resolvedEntryPrice) : null,
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

/**
 * ACTIVE 포지션에 현재 시장 데이터를 결합하여 반환한다.
 * daily_prices (최신 종가) + stock_phases (Phase, RS) LEFT JOIN.
 * pnlPercent = (currentPrice - entryPrice) / entryPrice * 100
 *
 * @param date - 기준일 (YYYY-MM-DD). 해당 날짜 이하 최신 데이터를 조회한다.
 */
export async function getActivePortfolioPositionsWithCurrentData(
  date: string,
): Promise<PortfolioPositionWithCurrentData[]> {
  const activePositions = await getActivePortfolioPositions();

  if (activePositions.length === 0) return [];

  const enriched = await Promise.all(
    activePositions.map(async (pos) => {
      const [priceRows, phaseRows] = await Promise.all([
        db
          .select({ close: dailyPrices.close })
          .from(dailyPrices)
          .where(and(eq(dailyPrices.symbol, pos.symbol), lte(dailyPrices.date, date)))
          .orderBy(desc(dailyPrices.date))
          .limit(1),
        db
          .select({ phase: stockPhases.phase, rsScore: stockPhases.rsScore })
          .from(stockPhases)
          .where(and(eq(stockPhases.symbol, pos.symbol), lte(stockPhases.date, date)))
          .orderBy(desc(stockPhases.date))
          .limit(1),
      ]);
      const priceRow = priceRows[0];
      const phaseRow = phaseRows[0];

      const currentPrice = priceRow?.close != null
        ? (() => {
            const val = Number(priceRow.close);
            return Number.isFinite(val) ? val : null;
          })()
        : null;

      const currentPhase = phaseRow?.phase ?? null;
      const currentRsScore = phaseRow?.rsScore ?? null;

      const entryPriceNum = pos.entryPrice != null
        ? (() => {
            const val = Number(pos.entryPrice);
            return Number.isFinite(val) && val !== 0 ? val : null;
          })()
        : null;

      const pnlPercent =
        currentPrice != null && entryPriceNum != null
          ? ((currentPrice - entryPriceNum) / entryPriceNum) * 100
          : null;

      return {
        ...pos,
        currentPrice,
        currentPhase,
        currentRsScore,
        pnlPercent,
      } satisfies PortfolioPositionWithCurrentData;
    }),
  );

  return enriched;
}

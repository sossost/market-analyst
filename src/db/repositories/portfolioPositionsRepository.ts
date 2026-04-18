/**
 * portfolio_positions 테이블 조회/갱신 Repository.
 * 모델 포트폴리오 편입/청산 이력을 관리한다.
 * 재시도 로직은 호출부가 담당한다.
 */

import { pool } from "@/db/client";

// ─── 타입 정의 ────────────────────────────────────────────────────────────────

export type PortfolioStatus = "ACTIVE" | "EXITED";
export type PortfolioTier = "standard" | "featured";

export interface PortfolioPositionRow {
  id: number;
  symbol: string;
  sector: string | null;
  industry: string | null;
  entry_date: string;
  entry_price: string | null;
  entry_phase: number | null;
  entry_rs_score: string | null;
  entry_sepa_grade: string | null;
  thesis_id: number | null;
  exit_date: string | null;
  exit_price: string | null;
  exit_reason: string | null;
  status: PortfolioStatus;
  tier: PortfolioTier;
  created_at: string;
}

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

// ─── 공통 SELECT 컬럼 ─────────────────────────────────────────────────────────

const SELECT_COLUMNS = `
  id, symbol, sector, industry,
  entry_date::text, entry_price::text,
  entry_phase, entry_rs_score::text, entry_sepa_grade,
  thesis_id,
  exit_date::text, exit_price::text, exit_reason,
  status, tier,
  created_at::text
`;

// ─── 삽입 함수 ────────────────────────────────────────────────────────────────

/**
 * 포트폴리오 포지션을 신규 등록한다.
 * UNIQUE(symbol, entry_date) 충돌 시 아무 작업도 하지 않는다.
 * 삽입된 경우 id를 반환하고, 충돌(중복)이면 null을 반환한다.
 */
export async function insertPortfolioPosition(
  input: InsertPortfolioPositionInput,
): Promise<number | null> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO portfolio_positions (
       symbol, sector, industry,
       entry_date, entry_price,
       entry_phase, entry_rs_score, entry_sepa_grade,
       thesis_id, tier, status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ACTIVE')
     ON CONFLICT (symbol, entry_date) DO NOTHING
     RETURNING id`,
    [
      input.symbol,
      input.sector ?? null,
      input.industry ?? null,
      input.entryDate,
      input.entryPrice ?? null,
      input.entryPhase ?? null,
      input.entryRsScore ?? null,
      input.entrySepaGrade ?? null,
      input.thesisId ?? null,
      input.tier ?? "standard",
    ],
  );

  return rows[0]?.id ?? null;
}

// ─── 조회 함수 ────────────────────────────────────────────────────────────────

/**
 * ACTIVE 상태인 포트폴리오 포지션 전체를 조회한다.
 * entry_date DESC 정렬.
 */
export async function getActivePortfolioPositions(): Promise<PortfolioPositionRow[]> {
  const { rows } = await pool.query<PortfolioPositionRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM portfolio_positions
     WHERE status = 'ACTIVE'
     ORDER BY entry_date DESC`,
  );

  return rows;
}

/**
 * 지정 symbol의 가장 최신 ACTIVE 포지션을 1개 조회한다.
 * 해당 symbol의 ACTIVE 포지션이 없으면 null을 반환한다.
 */
export async function getPortfolioPositionBySymbol(
  symbol: string,
): Promise<PortfolioPositionRow | null> {
  const { rows } = await pool.query<PortfolioPositionRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM portfolio_positions
     WHERE symbol = $1 AND status = 'ACTIVE'
     ORDER BY entry_date DESC
     LIMIT 1`,
    [symbol],
  );

  return rows[0] ?? null;
}

/**
 * 포트폴리오 포지션을 EXITED 상태로 전환한다.
 * symbol + entry_date 조합으로 대상 포지션을 특정한다.
 */
export async function updatePortfolioExit(
  symbol: string,
  entryDate: string,
  exit: UpdatePortfolioExitInput,
): Promise<void> {
  await pool.query(
    `UPDATE portfolio_positions
     SET status = 'EXITED',
         exit_date = $1,
         exit_price = $2,
         exit_reason = $3
     WHERE symbol = $4 AND entry_date = $5 AND status = 'ACTIVE'`,
    [
      exit.exitDate,
      exit.exitPrice ?? null,
      exit.exitReason ?? null,
      symbol,
      entryDate,
    ],
  );
}

/**
 * 포트폴리오 포지션 전체를 조회한다 (상태 무관).
 * entry_date DESC 정렬. 기본 limit 100.
 */
export async function getAllPortfolioPositions(
  limit: number = 100,
): Promise<PortfolioPositionRow[]> {
  const { rows } = await pool.query<PortfolioPositionRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM portfolio_positions
     ORDER BY entry_date DESC
     LIMIT $1`,
    [limit],
  );

  return rows;
}

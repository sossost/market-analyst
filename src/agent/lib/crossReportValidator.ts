// ---------------------------------------------------------------------------
// crossReportValidator.ts — 일간 리포트 ↔ 토론 thesis 교차 검증
//
// daily_reports.reported_symbols와 theses.beneficiary_tickers를 비교하여
// 불일치 종목을 감지한다. 블로킹 없음 — warn-only.
//
// 설계 의도:
//   - 일간 에이전트는 당일 ETL 기반, 토론은 전날 ETL 기반 → 구조적 날짜 지연 존재
//   - 따라서 불일치는 의도된 지연일 수 있으므로 차단이 아닌 모니터링
// ---------------------------------------------------------------------------

import { pool } from "@/db/client";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CrossValidationSeverity = "ok" | "warn";

export interface CrossValidationResult {
  hasMismatch: boolean;
  dailyOnly: string[];
  debateOnly: string[];
  severity: CrossValidationSeverity;
  dailyDate: string;
  debateDate: string;
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// DB Queries
// ---------------------------------------------------------------------------

interface DailyReportRow {
  reported_symbols: unknown;
}

interface ThesisRow {
  debate_date: string;
  beneficiary_tickers: string | null;
}

/**
 * 지정 날짜의 일간 리포트에서 reported_symbols를 조회한다.
 * 없으면 빈 배열 반환.
 */
async function fetchDailyReportedSymbols(date: string): Promise<string[]> {
  const result = await pool.query<DailyReportRow>(
    `SELECT reported_symbols
     FROM daily_reports
     WHERE report_date = $1
       AND type = 'daily'
     LIMIT 1`,
    [date],
  );

  const row = result.rows[0];
  if (row == null) {
    return [];
  }

  const raw = row.reported_symbols;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item: unknown) => {
      if (item != null && typeof item === "object" && "symbol" in item) {
        return String((item as { symbol: unknown }).symbol);
      }
      if (typeof item === "string") {
        return item;
      }
      return null;
    })
    .filter((s): s is string => s != null && s.length > 0);
}

/**
 * 지정 날짜 기준 가장 최근 토론 thesis에서 beneficiaryTickers를 조회한다.
 * dailyDate와 동일 날짜 또는 전날(-1 영업일) thesis를 대상으로 한다.
 * thesis는 JSON text 컬럼이 아닌 theses 테이블에서 직접 조회.
 */
async function fetchDebateBeneficiaryTickers(date: string): Promise<string[]> {
  // debate_date = dailyDate 또는 바로 이전 날짜 (최근 2개 날짜 내)
  const result = await pool.query<ThesisRow>(
    `SELECT debate_date, beneficiary_tickers
     FROM theses
     WHERE debate_date >= ($1::date - INTERVAL '2 days')::text
       AND debate_date <= $1
       AND status = 'ACTIVE'
     ORDER BY debate_date DESC`,
    [date],
  );

  if (result.rows.length === 0) {
    return [];
  }

  const tickers = new Set<string>();

  for (const row of result.rows) {
    if (row.beneficiary_tickers == null || row.beneficiary_tickers === "") {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.beneficiary_tickers);
    } catch {
      continue;
    }

    if (!Array.isArray(parsed)) {
      continue;
    }

    for (const ticker of parsed) {
      if (typeof ticker === "string" && ticker.length > 0) {
        tickers.add(ticker.toUpperCase());
      }
    }
  }

  return Array.from(tickers);
}

// ---------------------------------------------------------------------------
// Core validation
// ---------------------------------------------------------------------------

/**
 * 일간 리포트와 토론 thesis의 종목 교차 검증을 실행한다.
 *
 * - 양쪽 모두 비어 있으면 ok (데이터 없음)
 * - 어느 한쪽만 있으면 warn
 * - 교집합 0 + 양쪽 비어있지 않으면 warn
 * - DB 조회 실패 시 graceful — ok 반환 (발송을 막지 않음)
 */
export async function validateCrossReport(
  dailyDate: string,
): Promise<CrossValidationResult> {
  const checkedAt = new Date().toISOString();

  const emptyResult: CrossValidationResult = {
    hasMismatch: false,
    dailyOnly: [],
    debateOnly: [],
    severity: "ok",
    dailyDate,
    debateDate: dailyDate,
    checkedAt,
  };

  let dailySymbols: string[];
  let debateTickers: string[];

  try {
    [dailySymbols, debateTickers] = await Promise.all([
      fetchDailyReportedSymbols(dailyDate),
      fetchDebateBeneficiaryTickers(dailyDate),
    ]);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("CrossReportValidator", `DB 조회 실패 (검증 스킵): ${reason}`);
    return emptyResult;
  }

  // 양쪽 모두 빈 배열이면 검증 불가 — ok 반환
  if (dailySymbols.length === 0 && debateTickers.length === 0) {
    logger.info("CrossReportValidator", `${dailyDate}: 양쪽 모두 데이터 없음 — 교차 검증 스킵`);
    return emptyResult;
  }

  const dailySet = new Set(dailySymbols.map((s) => s.toUpperCase()));
  const debateSet = new Set(debateTickers);

  const dailyOnly = Array.from(dailySet).filter((s) => !debateSet.has(s));
  const debateOnly = Array.from(debateSet).filter((s) => !dailySet.has(s));

  const hasMismatch = dailyOnly.length > 0 || debateOnly.length > 0;

  if (hasMismatch) {
    logger.warn(
      "CrossReportValidator",
      `${dailyDate}: 교차 불일치 — 일간만: [${dailyOnly.join(", ")}], 토론만: [${debateOnly.join(", ")}]`,
    );
  } else {
    logger.info("CrossReportValidator", `${dailyDate}: 교차 검증 통과 (${dailySymbols.length}개 일치)`);
  }

  return {
    hasMismatch,
    dailyOnly,
    debateOnly,
    severity: hasMismatch ? "warn" : "ok",
    dailyDate,
    debateDate: dailyDate,
    checkedAt,
  };
}

/**
 * saveWatchlist — 관심종목 등록/해제 도구.
 *
 * 에이전트가 관심종목을 등록하거나 해제할 때 사용한다.
 * 등록 시 5중 교집합 게이트(watchlistGate)를 통과해야 한다.
 * 중복 등록(동일 symbol의 ACTIVE 항목)은 차단한다.
 */

import { db } from "@/db/client";
import { watchlistStocks } from "@/db/schema/analyst";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import { eq, and } from "drizzle-orm";
import type { AgentTool } from "./types";
import { validateDate, validateSymbol } from "./validation";
import { evaluateWatchlistGate, type WatchlistGateInput } from "@/lib/watchlistGate.js";
import {
  findActiveWatchlistBySymbols,
  exitWatchlistItem,
} from "@/db/repositories/watchlistRepository.js";
import { calculateTrackingEndDate } from "@/lib/watchlistTracker.js";
import { logger } from "@/lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WatchlistRegisterInput {
  symbol: string;
  date: string;
  phase: number;
  rs_score: number;
  sector_rs: number;
  sepa_grade: string;
  thesis_id: number | null;
  sector: string;
  industry: string;
  reason: string;
  price_at_entry?: number;
  entry_rs_score?: number;
}

interface WatchlistExitInput {
  symbol: string;
  exit_date: string;
  exit_reason: string;
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

/**
 * 에이전트가 관심종목을 등록하거나 해제하는 도구.
 * action: 'register' — 5중 교집합 게이트 통과 후 등록
 * action: 'exit' — ACTIVE 항목을 EXITED로 전환
 */
export const saveWatchlist: AgentTool = {
  definition: {
    name: "save_watchlist",
    description:
      "관심종목을 등록(register) 하거나 해제(exit)합니다. 등록 시 5중 교집합 게이트(Phase 2 + 섹터RS + 개별RS + thesis 근거 + SEPA S/A)를 모두 통과해야 합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["register", "exit"],
          description: "수행할 동작: 'register'(등록) 또는 'exit'(해제)",
        },
        register: {
          type: "object",
          description: "action이 'register'일 때 사용",
          properties: {
            symbol: { type: "string", description: "종목 심볼 (예: AAPL)" },
            date: { type: "string", description: "등록일 (YYYY-MM-DD)" },
            phase: { type: "number", description: "현재 Phase (1~4)" },
            rs_score: { type: "number", description: "개별 RS 점수 (0~100)" },
            sector_rs: { type: "number", description: "섹터 RS 평균 (avg_rs)" },
            sepa_grade: {
              type: "string",
              enum: ["S", "A", "B", "C", "F"],
              description: "SEPA 펀더멘탈 등급",
            },
            thesis_id: {
              type: "number",
              description: "연결된 thesis ID (구조적 서사 근거. 없으면 null)",
            },
            sector: { type: "string", description: "섹터 이름" },
            industry: { type: "string", description: "업종 이름" },
            reason: {
              type: "string",
              description: "등록 근거 (서사적 판단 근거를 자유 텍스트로 기술)",
            },
            price_at_entry: {
              type: "number",
              description: "진입 시점 종가 (달러, 선택 사항)",
            },
          },
          required: [
            "symbol", "date", "phase", "rs_score", "sector_rs",
            "sepa_grade", "thesis_id", "sector", "industry", "reason",
          ],
        },
        exit: {
          type: "object",
          description: "action이 'exit'일 때 사용",
          properties: {
            symbol: { type: "string", description: "해제할 종목 심볼" },
            exit_date: { type: "string", description: "해제일 (YYYY-MM-DD)" },
            exit_reason: {
              type: "string",
              description: "해제 사유 (예: Phase 3 진입, 서사 소멸, 수동 제거)",
            },
          },
          required: ["symbol", "exit_date", "exit_reason"],
        },
      },
      required: ["action"],
    },
  },

  async execute(input) {
    const action = input.action as string | undefined;

    if (action === "register") {
      return executeRegister(input.register as Record<string, unknown> | undefined);
    }

    if (action === "exit") {
      return executeExit(input.exit as Record<string, unknown> | undefined);
    }

    return JSON.stringify({ error: `알 수 없는 action: ${action}. 'register' 또는 'exit'을 사용하세요.` });
  },
};

// ─── Register ─────────────────────────────────────────────────────────────────

async function executeRegister(
  data: Record<string, unknown> | undefined,
): Promise<string> {
  if (data == null) {
    return JSON.stringify({ error: "register 데이터가 없습니다." });
  }

  const rawInput = data as Partial<WatchlistRegisterInput>;

  // 입력 검증
  const symbol = validateSymbol(rawInput.symbol);
  if (symbol == null) {
    return JSON.stringify({ error: `유효하지 않은 symbol: ${rawInput.symbol}` });
  }

  const date = validateDate(rawInput.date);
  if (date == null) {
    return JSON.stringify({ error: `유효하지 않은 date: ${rawInput.date}` });
  }

  const phase = typeof rawInput.phase === "number" ? rawInput.phase : null;
  if (phase == null) {
    return JSON.stringify({ error: "phase가 없습니다." });
  }

  const rsScore = typeof rawInput.rs_score === "number" ? rawInput.rs_score : null;
  const sectorRs = typeof rawInput.sector_rs === "number" ? rawInput.sector_rs : null;
  const sepaGrade = typeof rawInput.sepa_grade === "string" ? rawInput.sepa_grade : null;
  const thesisId = typeof rawInput.thesis_id === "number" ? rawInput.thesis_id : null;
  const sector = typeof rawInput.sector === "string" ? rawInput.sector : null;
  const industry = typeof rawInput.industry === "string" ? rawInput.industry : null;
  const reason = typeof rawInput.reason === "string" ? rawInput.reason : null;
  const priceAtEntry = typeof rawInput.price_at_entry === "number" ? rawInput.price_at_entry : null;

  // 5중 교집합 게이트 평가
  const gateInput: WatchlistGateInput = {
    symbol,
    phase,
    rsScore,
    sectorRs,
    sepaGrade,
    thesisId,
  };

  const gateResult = evaluateWatchlistGate(gateInput);

  if (!gateResult.passed) {
    const failureDetails = gateResult.failures.map((f) => f.reason).join("; ");
    logger.warn(
      "SaveWatchlist",
      `${symbol}: 5중 게이트 미통과 — ${failureDetails}`,
    );
    return JSON.stringify({
      success: false,
      blocked: true,
      symbol,
      gateFailures: gateResult.failures,
      message: `등록 거부: ${failureDetails}`,
    });
  }

  // 중복 등록 방지 — ACTIVE 상태인 동일 symbol 존재 시 차단
  const activeRows = await retryDatabaseOperation(() =>
    findActiveWatchlistBySymbols([symbol]),
  );

  if (activeRows.length > 0) {
    logger.warn(
      "SaveWatchlist",
      `${symbol}: 이미 ACTIVE 관심종목 존재 (등록일: ${activeRows[0].entry_date}), 스킵`,
    );
    return JSON.stringify({
      success: false,
      blocked: true,
      symbol,
      message: `이미 ACTIVE 관심종목으로 등록되어 있습니다 (등록일: ${activeRows[0].entry_date})`,
    });
  }

  // tracking_end_date 계산
  const trackingEndDate = calculateTrackingEndDate(date);

  // DB 저장
  await retryDatabaseOperation(() =>
    db
      .insert(watchlistStocks)
      .values({
        symbol,
        status: "ACTIVE",
        entryDate: date,
        entryPhase: phase,
        entryRsScore: rsScore,
        entrySectorRs: sectorRs != null ? String(sectorRs) : null,
        entrySepaGrade: sepaGrade,
        entryThesisId: thesisId,
        entrySector: sector,
        entryIndustry: industry,
        entryReason: reason,
        trackingEndDate,
        currentPhase: phase,
        currentRsScore: rsScore,
        phaseTrajectory: [{ date, phase, rsScore }],
        priceAtEntry: priceAtEntry != null ? String(priceAtEntry) : null,
        currentPrice: priceAtEntry != null ? String(priceAtEntry) : null,
        pnlPercent: "0",
        maxPnlPercent: "0",
        daysTracked: 0,
        lastUpdated: date,
      })
      .onConflictDoNothing({
        target: [watchlistStocks.symbol, watchlistStocks.entryDate],
      }),
  );

  logger.info(
    "SaveWatchlist",
    `${symbol}: 관심종목 등록 완료 (SEPA: ${sepaGrade ?? "N/A"}, Phase: ${phase}, RS: ${rsScore ?? "N/A"}, thesis: ${thesisId ?? "없음"})`,
  );

  return JSON.stringify({
    success: true,
    symbol,
    entryDate: date,
    trackingEndDate,
    gatePassedAt: new Date().toISOString(),
    message: `${symbol} 관심종목 등록 완료 (트래킹 종료: ${trackingEndDate})`,
  });
}

// ─── Exit ─────────────────────────────────────────────────────────────────────

async function executeExit(
  data: Record<string, unknown> | undefined,
): Promise<string> {
  if (data == null) {
    return JSON.stringify({ error: "exit 데이터가 없습니다." });
  }

  const rawInput = data as Partial<WatchlistExitInput>;

  const symbol = validateSymbol(rawInput.symbol);
  if (symbol == null) {
    return JSON.stringify({ error: `유효하지 않은 symbol: ${rawInput.symbol}` });
  }

  const exitDate = validateDate(rawInput.exit_date);
  if (exitDate == null) {
    return JSON.stringify({ error: `유효하지 않은 exit_date: ${rawInput.exit_date}` });
  }

  const exitReason = typeof rawInput.exit_reason === "string" && rawInput.exit_reason.length > 0
    ? rawInput.exit_reason
    : null;
  if (exitReason == null) {
    return JSON.stringify({ error: "exit_reason이 없습니다." });
  }

  // ACTIVE 항목 조회
  const activeRows = await retryDatabaseOperation(() =>
    findActiveWatchlistBySymbols([symbol]),
  );

  if (activeRows.length === 0) {
    return JSON.stringify({
      success: false,
      symbol,
      message: `${symbol}의 ACTIVE 관심종목을 찾을 수 없습니다.`,
    });
  }

  const targetRow = activeRows[0];

  await retryDatabaseOperation(() =>
    exitWatchlistItem(targetRow.id, exitDate, exitReason),
  );

  logger.info(
    "SaveWatchlist",
    `${symbol}: 관심종목 해제 완료 (사유: ${exitReason})`,
  );

  return JSON.stringify({
    success: true,
    symbol,
    exitDate,
    exitReason,
    entryDate: targetRow.entry_date,
    message: `${symbol} 관심종목 해제 완료 (사유: ${exitReason})`,
  });
}

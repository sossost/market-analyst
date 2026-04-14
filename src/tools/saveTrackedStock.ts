/**
 * saveTrackedStock — 트래킹 종목 등록/해제/조회 도구.
 *
 * saveWatchlist(등록/해제) + saveRecommendations(ETL 자동 종목 조회)를 통합한다.
 *
 * action: 'register' — source='agent'로 종목 등록 (최소 게이트: Phase 2 + 이유 명시)
 * action: 'exit'     — ACTIVE 종목을 EXITED로 전환
 * action: 'query'    — 오늘 ETL이 등록한 종목 조회 (source='etl_auto' 필터)
 */

import { pool } from "@/db/client";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import type { AgentTool } from "./types";
import { validateDate, validateSymbol } from "./validation";
import {
  findActiveTrackedStocksBySymbols,
  exitTrackedStock,
  insertTrackedStock,
  type TrackedStockTier,
} from "@/db/repositories/trackedStocksRepository.js";
import { calculateTrackingEndDate } from "@/lib/watchlistTracker.js";
import { logger } from "@/lib/logger";
import { runCorporateAnalyst } from "@/corporate-analyst/runCorporateAnalyst.js";

// ─── Types ────────────────────────────────────────────────────────────────────

const VALID_TIERS = new Set<string>(["standard", "featured"]);

const MIN_AGENT_PHASE = 2;

interface AgentRegisterInput {
  symbol: string;
  date: string;
  phase: number;
  rs_score?: number | null;
  thesis_id?: number | null;
  sector?: string | null;
  industry?: string | null;
  reason: string;
  price_at_entry?: number | null;
  tier?: string | null;
  sepa_grade?: string | null;
}

interface AgentExitInput {
  symbol: string;
  exit_date: string;
  exit_reason: string;
}

interface TodayTrackedRow {
  symbol: string;
  entry_date: string;
  entry_price: string;
  entry_rs_score: number | null;
  entry_phase: number;
  entry_sector: string | null;
  entry_industry: string | null;
  entry_reason: string | null;
  status: string;
  market_regime: string | null;
  source: string;
  tier: string;
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

/**
 * 트래킹 종목을 등록(register), 해제(exit), 또는 조회(query)하는 도구.
 * register: source='agent'로 등록. 5중 게이트 제거 — Phase 2 + 이유 명시만 요구.
 * exit: ACTIVE 종목을 EXITED로 전환.
 * query: 오늘 ETL이 자동 등록한 종목 조회 (source='etl_auto').
 */
export const saveTrackedStock: AgentTool = {
  definition: {
    name: "save_tracked_stock",
    description:
      "트래킹 종목을 등록(register), 해제(exit), 또는 조회(query)합니다. register: Phase 2 + 이유 명시로 에이전트가 종목을 등록합니다. exit: ACTIVE 종목을 해제합니다. query: 오늘 ETL이 자동 등록한 종목을 조회합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["register", "exit", "query"],
          description: "수행할 동작: 'register'(등록), 'exit'(해제), 'query'(ETL 자동 종목 조회)",
        },
        register: {
          type: "object",
          description: "action이 'register'일 때 사용",
          properties: {
            symbol: { type: "string", description: "종목 심볼 (예: AAPL)" },
            date: { type: "string", description: "등록일 (YYYY-MM-DD)" },
            phase: { type: "number", description: "현재 Phase (2 이상 필수)" },
            rs_score: { type: "number", description: "개별 RS 점수 (0~100, 선택)" },
            thesis_id: {
              type: "number",
              description: "연결된 thesis ID (선택 — 서사 근거가 있으면 명시)",
            },
            sector: { type: "string", description: "섹터 이름 (선택)" },
            industry: { type: "string", description: "업종 이름 (선택)" },
            reason: {
              type: "string",
              description: "등록 근거 (필수 — 에이전트의 판단 근거를 자유 텍스트로 기술)",
            },
            price_at_entry: {
              type: "number",
              description: "진입 시점 종가 (달러, 선택)",
            },
            tier: {
              type: "string",
              enum: ["standard", "featured"],
              description: "티어 (선택, 기본: standard). featured는 Corporate Analyst 리포트 대상.",
            },
            sepa_grade: {
              type: "string",
              enum: ["S", "A", "B", "C", "F"],
              description: "SEPA 펀더멘탈 등급 (선택)",
            },
          },
          required: ["symbol", "date", "phase", "reason"],
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
        query: {
          type: "object",
          description: "action이 'query'일 때 사용",
          properties: {
            date: { type: "string", description: "조회 기준일 (YYYY-MM-DD)" },
            symbols: {
              type: "array",
              items: { type: "string" },
              description: "조회할 종목 심볼 목록. 비어 있으면 오늘 저장된 전체 ETL 종목을 반환한다.",
            },
          },
          required: ["date"],
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

    if (action === "query") {
      return executeQuery(input.query as Record<string, unknown> | undefined);
    }

    return JSON.stringify({
      error: `알 수 없는 action: ${action}. 'register', 'exit', 'query' 중 하나를 사용하세요.`,
    });
  },
};

// ─── Register ─────────────────────────────────────────────────────────────────

async function executeRegister(
  data: Record<string, unknown> | undefined,
): Promise<string> {
  if (data == null) {
    return JSON.stringify({ error: "register 데이터가 없습니다." });
  }

  const rawInput = data as Partial<AgentRegisterInput>;

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

  // 최소 게이트: Phase 2 이상
  if (phase < MIN_AGENT_PHASE) {
    return JSON.stringify({
      success: false,
      blocked: true,
      symbol,
      message: `등록 거부: Phase ${phase}는 최소 기준(Phase ${MIN_AGENT_PHASE}) 미달입니다.`,
    });
  }

  const reason = typeof rawInput.reason === "string" && rawInput.reason.length > 0
    ? rawInput.reason
    : null;

  // 최소 게이트: 이유 명시 필수
  if (reason == null) {
    return JSON.stringify({
      success: false,
      blocked: true,
      symbol,
      message: "등록 거부: 등록 근거(reason)가 없습니다.",
    });
  }

  const rsScore = typeof rawInput.rs_score === "number" ? rawInput.rs_score : null;
  const thesisId = typeof rawInput.thesis_id === "number" ? rawInput.thesis_id : null;
  const sector = typeof rawInput.sector === "string" ? rawInput.sector : null;
  const industry = typeof rawInput.industry === "string" ? rawInput.industry : null;
  const priceAtEntry = typeof rawInput.price_at_entry === "number" ? rawInput.price_at_entry : null;
  const sepaGrade = typeof rawInput.sepa_grade === "string" ? rawInput.sepa_grade.toUpperCase() : null;

  const rawTier = typeof rawInput.tier === "string" ? rawInput.tier : null;
  const tier: TrackedStockTier =
    rawTier != null && VALID_TIERS.has(rawTier)
      ? (rawTier as TrackedStockTier)
      : "standard";

  // 중복 등록 방지 — ACTIVE 상태인 동일 symbol 존재 시 차단
  const activeRows = await retryDatabaseOperation(() =>
    findActiveTrackedStocksBySymbols([symbol]),
  );

  if (activeRows.length > 0) {
    logger.warn(
      "SaveTrackedStock",
      `${symbol}: 이미 ACTIVE 트래킹 종목 존재 (등록일: ${activeRows[0].entry_date}), 스킵`,
    );
    return JSON.stringify({
      success: false,
      blocked: true,
      symbol,
      message: `이미 ACTIVE 트래킹 종목으로 등록되어 있습니다 (등록일: ${activeRows[0].entry_date})`,
    });
  }

  const trackingEndDate = calculateTrackingEndDate(date);

  const insertedId = await retryDatabaseOperation(() =>
    insertTrackedStock({
      symbol,
      source: "agent",
      tier,
      entryDate: date,
      entryPrice: priceAtEntry ?? 0,
      entryPhase: phase,
      entryPrevPhase: null,
      entryRsScore: rsScore,
      entrySepaGrade: sepaGrade,
      entryThesisId: thesisId,
      entrySector: sector,
      entryIndustry: industry,
      entryReason: reason,
      marketRegime: null,
      trackingEndDate,
    }),
  );

  // ON CONFLICT DO NOTHING 발동 시 null 반환 → 동시 요청에 의한 중복
  if (insertedId == null) {
    logger.warn(
      "SaveTrackedStock",
      `${symbol}: 동시 요청에 의한 중복 등록 감지 — 실제 삽입 없음`,
    );
    return JSON.stringify({
      success: false,
      blocked: true,
      symbol,
      message: `${symbol} 등록이 동시 요청으로 인해 스킵되었습니다.`,
    });
  }

  logger.info(
    "SaveTrackedStock",
    `${symbol}: 트래킹 종목 등록 완료 (source=agent, tier=${tier}, Phase: ${phase}, RS: ${rsScore ?? "N/A"}, thesis: ${thesisId ?? "없음"})`,
  );

  // 종목 심층 리포트 생성 (fire-and-forget)
  runCorporateAnalyst(symbol, date, pool)
    .then((result) => {
      if (result.success === false) {
        logger.warn(
          "CorporateAnalyst",
          `${symbol} 트래킹 등록 후 심층 리포트 생성 실패: ${result.error}`,
        );
      }
    })
    .catch((err) =>
      logger.error(
        "CorporateAnalyst",
        `${symbol} 트래킹 등록 후 예상치 못한 에러: ${String(err)}`,
      ),
    );

  return JSON.stringify({
    success: true,
    symbol,
    source: "agent",
    tier,
    entryDate: date,
    trackingEndDate,
    message: `${symbol} 트래킹 종목 등록 완료 (트래킹 종료: ${trackingEndDate})`,
  });
}

// ─── Exit ─────────────────────────────────────────────────────────────────────

async function executeExit(
  data: Record<string, unknown> | undefined,
): Promise<string> {
  if (data == null) {
    return JSON.stringify({ error: "exit 데이터가 없습니다." });
  }

  const rawInput = data as Partial<AgentExitInput>;

  const symbol = validateSymbol(rawInput.symbol);
  if (symbol == null) {
    return JSON.stringify({ error: `유효하지 않은 symbol: ${rawInput.symbol}` });
  }

  const exitDate = validateDate(rawInput.exit_date);
  if (exitDate == null) {
    return JSON.stringify({ error: `유효하지 않은 exit_date: ${rawInput.exit_date}` });
  }

  const exitReason =
    typeof rawInput.exit_reason === "string" && rawInput.exit_reason.length > 0
      ? rawInput.exit_reason
      : null;

  if (exitReason == null) {
    return JSON.stringify({ error: "exit_reason이 없습니다." });
  }

  const activeRows = await retryDatabaseOperation(() =>
    findActiveTrackedStocksBySymbols([symbol]),
  );

  if (activeRows.length === 0) {
    return JSON.stringify({
      success: false,
      symbol,
      message: `${symbol}의 ACTIVE 트래킹 종목을 찾을 수 없습니다.`,
    });
  }

  const targetRow = activeRows[0];

  await retryDatabaseOperation(() =>
    exitTrackedStock(targetRow.id, exitDate, exitReason),
  );

  logger.info(
    "SaveTrackedStock",
    `${symbol}: 트래킹 종목 해제 완료 (사유: ${exitReason})`,
  );

  return JSON.stringify({
    success: true,
    symbol,
    exitDate,
    exitReason,
    entryDate: targetRow.entry_date,
    message: `${symbol} 트래킹 종목 해제 완료 (사유: ${exitReason})`,
  });
}

// ─── Query ─────────────────────────────────────────────────────────────────────

async function executeQuery(
  data: Record<string, unknown> | undefined,
): Promise<string> {
  if (data == null) {
    return JSON.stringify({ error: "query 데이터가 없습니다." });
  }

  const date = validateDate(data.date);
  if (date == null) {
    return JSON.stringify({ error: `유효하지 않은 date: ${data.date}` });
  }

  const rawSymbols = data.symbols as unknown[] | undefined;
  const symbols: string[] = Array.isArray(rawSymbols)
    ? rawSymbols
        .map((s) => validateSymbol(s))
        .filter((s): s is string => s != null)
    : [];

  let rows: TodayTrackedRow[];

  if (symbols.length > 0) {
    const result = await retryDatabaseOperation(() =>
      pool.query<TodayTrackedRow>(
        `SELECT symbol, entry_date, entry_price::text,
                entry_rs_score, entry_phase, entry_sector, entry_industry,
                entry_reason, status, market_regime, source, tier
         FROM tracked_stocks
         WHERE entry_date = $1
           AND source = 'etl_auto'
           AND symbol = ANY($2)
         ORDER BY entry_rs_score DESC NULLS LAST`,
        [date, symbols],
      ),
    );
    rows = result.rows;
  } else {
    const result = await retryDatabaseOperation(() =>
      pool.query<TodayTrackedRow>(
        `SELECT symbol, entry_date, entry_price::text,
                entry_rs_score, entry_phase, entry_sector, entry_industry,
                entry_reason, status, market_regime, source, tier
         FROM tracked_stocks
         WHERE entry_date = $1
           AND source = 'etl_auto'
         ORDER BY entry_rs_score DESC NULLS LAST`,
        [date],
      ),
    );
    rows = result.rows;
  }

  const found = rows.map((r) => ({
    symbol: r.symbol,
    date: r.entry_date,
    entryPrice: r.entry_price,
    rsScore: r.entry_rs_score,
    phase: r.entry_phase,
    sector: r.entry_sector,
    industry: r.entry_industry,
    reason: r.entry_reason,
    status: r.status,
    marketRegime: r.market_regime,
    source: r.source,
    tier: r.tier,
  }));

  logger.info(
    "SaveTrackedStock",
    `${date} ETL 자동 종목 조회: ${found.length}건 (요청 symbols: ${symbols.length > 0 ? symbols.join(", ") : "전체"})`,
  );

  return JSON.stringify({
    success: true,
    date,
    count: found.length,
    trackedStocks: found,
    message: `${date} 기준 ETL 자동 등록 종목 ${found.length}건`,
  });
}

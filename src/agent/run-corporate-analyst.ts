/**
 * 기업 애널리스트 에이전트 배치 실행 CLI.
 *
 * 사용법:
 *   yarn agent:corporate-analyst                 # 배치 모드: 리포트 없는 ACTIVE 종목만
 *   yarn agent:corporate-analyst --all           # 배치 모드: 전체 ACTIVE 종목 재생성
 *   yarn agent:corporate-analyst --symbol NVDA   # 단일 모드: 지정 종목만
 */
import "dotenv/config";
import pLimit from "p-limit";
import { pool } from "@/db/client";
import { logger } from "@/lib/logger";
import { sendDiscordMessage, sendDiscordError } from "@/lib/discord";
import { runCorporateAnalyst } from "@/corporate-analyst/runCorporateAnalyst";
import {
  findActiveTrackedStockBySymbol,
  findExistingAnalysisReports,
} from "@/db/repositories/index.js";
import { getActivePortfolioPositions } from "@/db/repositories/portfolioPositionsRepository.js";

// ------- 상수 -------
const CONCURRENCY_LIMIT = 2;

// ------- 타입 -------
interface ParsedArgs {
  symbol: string | undefined;
  all: boolean;
}

interface ActiveTrackedStock {
  symbol: string;
  entry_date: string;
}

interface BatchResult {
  successCount: number;
  failureCount: number;
  failedSymbols: string[];
}

// ------- CLI 인자 파싱 -------
export function parseArgs(argv: string[] = process.argv.slice(2)): ParsedArgs {
  let symbol: string | undefined;
  let all = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--symbol" && argv[i + 1] != null) {
      symbol = argv[i + 1].toUpperCase();
      i++;
    }
    if (argv[i] === "--all") {
      all = true;
    }
  }

  return { symbol, all };
}

// ------- 환경변수 검증 -------
function validateEnvironment(): void {
  const required = ["DATABASE_URL"];
  const missing = required.filter(
    (key) => process.env[key] == null || process.env[key] === "",
  );

  if (missing.length > 0) {
    throw new Error(
      `필수 환경변수 누락: ${missing.join(", ")}`,
    );
  }
}

// ------- DB 쿼리: ACTIVE 포트폴리오 포지션 조회 -------
async function fetchActiveRecommendations(): Promise<ActiveTrackedStock[]> {
  const positions = await getActivePortfolioPositions();
  return positions.map((p) => ({
    symbol: p.symbol,
    entry_date: p.entryDate,
  }));
}

// ------- DB 쿼리: 이미 리포트가 있는 (symbol, date) 집합 조회 -------
async function fetchSymbolsWithReports(
  candidates: ActiveTrackedStock[],
): Promise<Set<string>> {
  if (candidates.length === 0) {
    return new Set();
  }

  const rows = await findExistingAnalysisReports(
    candidates.map((c) => ({ symbol: c.symbol, recommendation_date: c.entry_date })),
    pool,
  );

  return new Set(rows.map((r) => `${r.symbol}::${r.recommendation_date}`));
}

// ------- 배치 모드 실행 -------
async function runBatchMode(all: boolean): Promise<BatchResult> {
  logger.step("[1/3] ACTIVE 추천 종목 조회 중...");
  const activeRecommendations = await fetchActiveRecommendations();

  if (activeRecommendations.length === 0) {
    logger.info("Batch", "ACTIVE 추천 종목 없음. 종료.");
    return { successCount: 0, failureCount: 0, failedSymbols: [] };
  }

  logger.info("Batch", `ACTIVE 종목 ${activeRecommendations.length}개 발견`);

  // --all 없으면 기존 리포트 있는 종목 필터링
  let targets = activeRecommendations;
  if (all === false) {
    logger.step("[2/3] 기존 리포트 보유 종목 확인 중...");
    const symbolsWithReports = await fetchSymbolsWithReports(activeRecommendations);
    targets = activeRecommendations.filter(
      (rec) => symbolsWithReports.has(`${rec.symbol}::${rec.entry_date}`) === false,
    );
    const skippedCount = activeRecommendations.length - targets.length;
    if (skippedCount > 0) {
      logger.info("Batch", `리포트 이미 존재 ${skippedCount}개 스킵`);
    }
  } else {
    logger.step("[2/3] --all 플래그: 기존 리포트 보유 종목도 재생성");
  }

  if (targets.length === 0) {
    logger.info("Batch", "생성할 리포트 없음. 모두 최신 상태.");
    return { successCount: 0, failureCount: 0, failedSymbols: [] };
  }

  logger.step(`[3/3] ${targets.length}개 종목 리포트 생성 시작 (동시 ${CONCURRENCY_LIMIT}개)...`);

  const limit = pLimit(CONCURRENCY_LIMIT);
  const results = await Promise.all(
    targets.map((rec) =>
      limit(() => runCorporateAnalyst(rec.symbol, rec.entry_date, pool)),
    ),
  );

  const successCount = results.filter((r) => r.success).length;
  const failedResults = results.filter((r) => r.success === false);
  const failedSymbols = failedResults.map((r) => r.symbol);

  return {
    successCount,
    failureCount: failedResults.length,
    failedSymbols,
  };
}

// ------- 단일 모드 실행 -------
async function runSingleMode(symbol: string): Promise<BatchResult> {
  logger.step(`[1/2] ${symbol} ACTIVE 추천 조회 중...`);

  const rows = await findActiveTrackedStockBySymbol(symbol, pool);

  if (rows.length === 0) {
    logger.warn("Single", `${symbol}: ACTIVE 추천 없음`);
    return { successCount: 0, failureCount: 1, failedSymbols: [symbol] };
  }

  const rec = rows[0];
  logger.info("Single", `${symbol} (${rec.entry_date}) 리포트 생성 시작`);

  logger.step("[2/2] runCorporateAnalyst 실행 중...");
  const analystResult = await runCorporateAnalyst(symbol, rec.entry_date, pool);

  if (analystResult.success) {
    return { successCount: 1, failureCount: 0, failedSymbols: [] };
  }

  return { successCount: 0, failureCount: 1, failedSymbols: [symbol] };
}

// ------- Discord 배치 완료 알림 -------
async function notifyBatchComplete(
  mode: string,
  result: BatchResult,
): Promise<void> {
  const { successCount, failureCount, failedSymbols } = result;
  const total = successCount + failureCount;

  if (total === 0) {
    return;
  }

  const statusIcon = failureCount === 0 ? "✅" : "⚠️";
  const lines = [
    `${statusIcon} **기업 애널리스트 배치 완료** (${mode})`,
    ``,
    `- 성공: ${successCount}개`,
    `- 실패: ${failureCount}개`,
  ];

  if (failedSymbols.length > 0) {
    lines.push(`- 실패 종목: ${failedSymbols.join(", ")}`);
  }

  try {
    await sendDiscordMessage(lines.join("\n"));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("Discord", `알림 전송 실패 (무시): ${reason}`);
  }
}

// ------- 메인 -------
async function main() {
  logger.step("=== 기업 애널리스트 에이전트 ===\n");

  validateEnvironment();
  logger.step("환경변수 검증 완료");

  const args = parseArgs();
  const mode = args.symbol != null ? `단일:${args.symbol}` : (args.all ? "배치(전체)" : "배치(신규)");
  logger.info("Args", `모드: ${mode}`);

  let result: BatchResult;
  if (args.symbol != null) {
    result = await runSingleMode(args.symbol);
  } else {
    result = await runBatchMode(args.all);
  }

  logger.step(
    `\n완료 — 성공 ${result.successCount}개 / 실패 ${result.failureCount}개`,
  );

  await notifyBatchComplete(mode, result);

  if (result.failureCount > 0) {
    await sendDiscordError(
      `기업 애널리스트 배치: ${result.failureCount}개 종목 실패 (${result.failedSymbols.join(", ")})`,
    );
  }

  await pool.end();
  logger.step("Done.");
}

main().catch(async (err) => {
  const errorMsg = err instanceof Error ? err.message : String(err);
  logger.error("CorporateAnalyst", `Fatal: ${errorMsg}`);
  await sendDiscordError(errorMsg);
  await pool.end();
  process.exit(1);
});

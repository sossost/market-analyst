import "dotenv/config";
import { db, pool } from "@/db/client";
import { theses, signalLog, signalParams } from "@/db/schema/analyst";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { gte } from "drizzle-orm";
import { calculateAgentPerformance } from "@/lib/agent-performance";
import { calculateSignalStats } from "@/lib/signal-performance-stats";
import { buildCeoWeeklyReport } from "@/agent/ceo-weekly-report";
import { sendDiscordMessage } from "@/agent/discord";
import type { ParamChangeRow } from "@/agent/ceo-weekly-report";
import { logger } from "@/lib/logger";

const TAG = "GENERATE_CEO_REPORT";

/**
 * CEO 주간 시스템 리포트 생성 스크립트.
 *
 * 흐름:
 * 1. DB에서 theses (최근 90일) 조회
 * 2. DB에서 signal_log 전체 조회
 * 3. DB에서 signal_params 최근 7일 변경 조회
 * 4. 위 데이터로 CEO 리포트 생성
 * 5. 콘솔 출력
 */
async function main() {
  assertValidEnvironment();

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  // 주간 범위 계산 (최근 7일)
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekStartStr = weekAgo.toISOString().slice(0, 10);

  // 90일 전 기준 (thesis 조회 범위)
  const THESIS_LOOKBACK_DAYS = 90;
  const thesisStartDate = new Date(today);
  thesisStartDate.setDate(thesisStartDate.getDate() - THESIS_LOOKBACK_DAYS);
  const thesisStartStr = thesisStartDate.toISOString().slice(0, 10);

  logger.info(TAG, `CEO 주간 리포트 생성 — ${weekStartStr} ~ ${todayStr}`);

  // 1. Theses 조회 (최근 90일)
  const thesisRows = await db
    .select({
      agentPersona: theses.agentPersona,
      confidence: theses.confidence,
      consensusLevel: theses.consensusLevel,
      status: theses.status,
    })
    .from(theses)
    .where(gte(theses.debateDate, thesisStartStr));

  logger.info(TAG, `  Theses (최근 ${THESIS_LOOKBACK_DAYS}일): ${thesisRows.length}건`);

  // 2. Signal log 전체 조회
  const signalRows = await db
    .select({
      status: signalLog.status,
      return5d: signalLog.return5d,
      return10d: signalLog.return10d,
      return20d: signalLog.return20d,
      return60d: signalLog.return60d,
      maxReturn: signalLog.maxReturn,
      phaseExitReturn: signalLog.phaseExitReturn,
      phaseExitDate: signalLog.phaseExitDate,
    })
    .from(signalLog);

  logger.info(TAG, `  Signal log: ${signalRows.length}건`);

  // 3. Signal params 변경 (최근 7일)
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const paramChangeRows = await db
    .select({
      paramName: signalParams.paramName,
      currentValue: signalParams.currentValue,
      previousValue: signalParams.previousValue,
      changeReason: signalParams.changeReason,
      changedAt: signalParams.changedAt,
    })
    .from(signalParams)
    .where(gte(signalParams.changedAt, sevenDaysAgo));

  logger.info(TAG, `  Param changes (7일): ${paramChangeRows.length}건`);

  // 4. 리포트 생성
  const agentStats = calculateAgentPerformance(thesisRows);
  const signalStats = calculateSignalStats(signalRows);

  const paramChanges: ParamChangeRow[] = paramChangeRows.map((r) => ({
    paramName: r.paramName,
    currentValue: r.currentValue,
    previousValue: r.previousValue,
    changeReason: r.changeReason,
    changedAt: r.changedAt,
  }));

  const report = buildCeoWeeklyReport({
    agentStats,
    signalStats,
    paramChanges,
    weekStart: weekStartStr,
    weekEnd: todayStr,
  });

  // 5. Discord 발송 (CEO 채널)
  const ceoWebhookUrl = process.env.DISCORD_SYSTEM_REPORT_WEBHOOK_URL;
  if (ceoWebhookUrl != null && ceoWebhookUrl !== "") {
    await sendDiscordMessage(report, "DISCORD_SYSTEM_REPORT_WEBHOOK_URL");
    logger.info(TAG, "Discord CEO 채널에 발송 완료.");
  } else {
    logger.info(TAG, "DISCORD_SYSTEM_REPORT_WEBHOOK_URL 미설정 — 콘솔 출력만 진행.");
  }

  logger.info(TAG, "=".repeat(60));
  logger.info(TAG, report);
  logger.info(TAG, "=".repeat(60));

  await pool.end();
}

main().catch(async (err) => {
  logger.error(TAG, `CEO report generation failed: ${err instanceof Error ? err.message : String(err)}`);
  await pool.end();
  process.exit(1);
});

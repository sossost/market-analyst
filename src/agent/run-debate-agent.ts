import "dotenv/config";
import { pool } from "@/db/client";
import { runDebate } from "./debate/debateEngine";
import { buildMemoryContext } from "./debate/memoryLoader";
import { saveTheses } from "./debate/thesisStore";
import { sendDiscordMessage, sendDiscordError, sendDiscordFile } from "./discord";
import { createGist } from "./gist";
import { logger } from "./logger";

const DEBATE_QUESTION = `오늘 미국 주식시장에서 가장 주목할 변화와 시사점은 무엇인가?

최신 뉴스와 데이터를 반드시 검색한 후 분석해 주세요.

다음 관점에서 분석해 주세요:
1. 오늘/최근 시장을 움직인 핵심 이벤트와 그 구조적 의미
2. 향후 1~3개월 내 돈이 몰릴 섹터/산업 변화
3. 현재 시장이 과소평가하거나 과대평가하는 테마
4. 주요 리스크 팩터와 그 발생 확률
5. 구체적이고 검증 가능한 예측 (thesis)`;

function validateEnvironment(): void {
  const required = ["DATABASE_URL", "ANTHROPIC_API_KEY"];
  const missing = required.filter(
    (key) => process.env[key] == null || process.env[key] === "",
  );
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function getDebateDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  logger.step("=== Debate Agent: Daily Cabinet Discussion ===\n");

  // 1. 환경변수 검증
  validateEnvironment();
  logger.step("[1/5] Environment validated");

  // 2. 장기 기억 로드
  logger.step("[2/5] Loading memory context...");
  const memoryContext = await buildMemoryContext();
  if (memoryContext.length > 0) {
    logger.info("Memory", `Loaded ${memoryContext.length} chars of memory context`);
  } else {
    logger.info("Memory", "No prior learnings — starting fresh");
  }

  // 3. 토론 실행
  const debateDate = getDebateDate();
  logger.step(`[3/5] Running debate for ${debateDate}...`);

  const result = await runDebate({
    question: DEBATE_QUESTION,
    debateDate,
    memoryContext,
  });

  logger.info("Debate", `Round 1: ${result.round1.outputs.length}/4 agents`);
  logger.info("Debate", `Round 2: ${result.round2.outputs.length} crossfire responses`);
  logger.info("Debate", `Round 3: ${result.round3.theses.length} theses extracted`);
  logger.info("Debate", `Tokens: ${result.metadata.totalTokens.input} in / ${result.metadata.totalTokens.output} out`);
  logger.info("Debate", `Duration: ${(result.metadata.totalDurationMs / 1000).toFixed(1)}s`);

  if (result.metadata.agentErrors.length > 0) {
    for (const err of result.metadata.agentErrors) {
      logger.warn("Debate", `Agent error: ${err.persona} (round ${err.round}): ${err.error}`);
    }
  }

  // 4. Thesis 저장
  logger.step("[4/5] Saving theses...");
  const savedCount = await saveTheses(debateDate, result.round3.theses);
  logger.info("Thesis", `${savedCount} theses saved to DB`);

  // 5. Discord 발송
  logger.step("[5/5] Sending report to Discord...");
  const report = result.round3.report;

  const summary = [
    `🏛️ **내각 토론 리포트** (${debateDate})`,
    "",
    `참여: ${result.round1.outputs.length}/4명`,
    `Thesis: ${result.round3.theses.length}개`,
    `토큰: ${(result.metadata.totalTokens.input + result.metadata.totalTokens.output).toLocaleString()}`,
    `소요: ${(result.metadata.totalDurationMs / 1000).toFixed(0)}초`,
  ].join("\n");

  const webhookVar = "DISCORD_DEBATE_WEBHOOK_URL";
  const webhookFallback = process.env[webhookVar] ?? process.env.DISCORD_WEBHOOK_URL;

  if (webhookFallback != null && webhookFallback !== "") {
    // Gist에 전체 리포트 저장
    try {
      const gistUrl = await createGist(
        `debate-${debateDate}.md`,
        report,
        `내각 토론 리포트 ${debateDate}`,
      );
      await sendDiscordMessage(
        `${summary}\n\n📄 전체 리포트: ${gistUrl}`,
        webhookVar,
      );
    } catch {
      // Gist 실패 시 파일 첨부로 발송
      await sendDiscordFile(
        webhookFallback,
        summary,
        `debate-${debateDate}.md`,
        report,
      );
    }
  } else {
    logger.warn("Discord", "No webhook URL configured, skipping send");
  }

  await pool.end();
  logger.step("\nDone.");
}

main().catch(async (err) => {
  const errorMsg = err instanceof Error ? err.message : String(err);
  logger.error("Debate", `Fatal: ${errorMsg}`);
  await sendDiscordError(errorMsg);
  await pool.end();
  process.exit(1);
});

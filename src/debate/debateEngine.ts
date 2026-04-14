import { createProvider } from "./llm/index.js";
import type { LLMProvider } from "./llm/index.js";
import { loadExpertPersonas, loadModeratorPersona } from "./personas.js";
import { runRound1 } from "./round1-independent.js";
import { runRound2 } from "./round2-crossfire.js";
import { runRound3 } from "./round3-synthesis.js";
import { logger } from "@/lib/logger";
import type { AgentPersona, DebateResult } from "@/types/debate";

interface NewsContext {
  [persona: string]: string;
}

interface DebateConfig {
  question: string;
  debateDate: string;
  memoryContext?: string;
  marketDataContext?: string;
  /** Per-persona news context from pre-collection */
  newsContext?: NewsContext;
  /** SEPA 기반 펀더멘탈 스코어 (XML 태그 래핑 텍스트) */
  fundamentalContext?: string;
  /** Per-persona confidence 캘리브레이션 컨텍스트 */
  calibrationContext?: Record<string, string>;
  /** 에이전트별 적중률 — 모더레이터 합의 가중치 조정용 */
  agentPerformanceContext?: string;
  /** 조기포착 도구 결과 (Phase1Late, RisingRS, 펀더멘탈가속) — pre-Phase 2 후보 */
  earlyDetectionContext?: string;
  /** 촉매 데이터 (종목 뉴스, 실적 서프라이즈 비트율, 임박 실적 발표) */
  catalystContext?: string;
  /** 서사 체인 + 국면 컨텍스트 (#735) */
  narrativeChainContext?: string;
  /** LLM 뉴스 테마 분석 — HIGH severity 인과 테마 (#751) */
  themeContext?: string;
  /** 기존 ACTIVE/CONFIRMED thesis — 모더레이터 중복 생성 방지 (#764) */
  existingThesesContext?: string;
  /** 뉴스 사각지대 분석 — Gap Analyzer가 식별한 미수집 테마 (#750) */
  gapContext?: string;
}

/**
 * Run a full 3-round debate.
 *
 * Round 1: Independent analysis (4 experts in parallel)
 * Round 2: Crossfire (4 experts read others' analysis, parallel)
 * Round 3: Moderator synthesis (single call)
 *
 * Individual agent failures are tolerated — debate continues with remaining agents.
 * Each expert uses the LLMProvider resolved from their persona.model field.
 */
export async function runDebate(config: DebateConfig): Promise<DebateResult> {
  const {
    question,
    debateDate,
    memoryContext = "",
    marketDataContext = "",
    newsContext = {},
    fundamentalContext,
    calibrationContext = {},
    agentPerformanceContext,
    earlyDetectionContext,
    catalystContext,
    narrativeChainContext,
    themeContext,
    existingThesesContext,
    gapContext,
  } = config;
  const startTime = Date.now();

  const experts = loadExpertPersonas();
  const moderator = loadModeratorPersona();
  const agentErrors: DebateResult["metadata"]["agentErrors"] = [];

  // provider factory: persona.model → LLMProvider (캐싱하지 않음, 모델별 인스턴스는 경량)
  const getProvider = (model: string): LLMProvider => createProvider(model);

  // 모더레이터는 Claude 고정 — JSON 구조화 안정성 이슈로 변경 보류
  const moderatorProvider = getProvider(moderator.model);

  // Combine question with market data context + theme context
  let fullQuestion = question;
  if (marketDataContext.length > 0) {
    fullQuestion += `\n\n---\n\n${marketDataContext}`;
  }
  if (themeContext != null && themeContext.length > 0) {
    fullQuestion += `\n\n---\n\n${themeContext}`;
  }
  // gapContext는 themeContext와 동일하게 Round 1에만 주입.
  // Round 2는 Round 1 산출물 기반 교차검증이므로 원시 데이터 재주입 불필요.
  if (gapContext != null && gapContext.length > 0) {
    fullQuestion += `\n\n---\n\n${gapContext}`;
  }

  logger.info("Debate", `Starting debate for ${debateDate}`);
  logger.info("Debate", `Question: ${question.slice(0, 100)}...`);
  if (marketDataContext.length > 0) {
    logger.info("Debate", `Market data context: ${marketDataContext.length} chars`);
  }

  // Round 1 — Independent Analysis
  logger.info("Debate", "=== Round 1: Independent Analysis ===");
  const round1Result = await runRound1({
    getProvider,
    experts,
    question: fullQuestion,
    memoryContext,
    newsContext,
    calibrationContext,
    fundamentalContext,
    earlyDetectionContext,
    catalystContext,
  });

  const failedInRound1 = experts
    .map((e) => e.name as AgentPersona)
    .filter((name) => !round1Result.round.outputs.some((o) => o.persona === name));
  for (const persona of failedInRound1) {
    agentErrors.push({ persona, round: 1, error: "Failed to produce output" });
  }

  // Round 2 — Crossfire (market data already in Round 1 outputs, no need to repeat)
  logger.info("Debate", "=== Round 2: Crossfire ===");
  const round2Result = await runRound2({
    getProvider,
    experts,
    round1Outputs: round1Result.round.outputs,
    question,
    fundamentalContext,
    earlyDetectionContext,
    catalystContext,
  });

  const activeInRound1 = round1Result.round.outputs.map((o) => o.persona);
  const failedInRound2 = activeInRound1.filter(
    (name) => !round2Result.round.outputs.some((o) => o.persona === name),
  );
  for (const persona of failedInRound2) {
    agentErrors.push({ persona, round: 2, error: "Failed to produce output" });
  }

  // Round 3 — Moderator Synthesis (market data already in Round 1 outputs)
  logger.info("Debate", "=== Round 3: Moderator Synthesis ===");
  const round3Result = await runRound3({
    provider: moderatorProvider,
    moderator,
    round1Outputs: round1Result.round.outputs,
    round2Outputs: round2Result.round.outputs,
    question,
    marketDataContext,
    fundamentalContext,
    agentPerformanceContext,
    earlyDetectionContext,
    catalystContext,
    narrativeChainContext,
    existingThesesContext,
  });

  const totalDurationMs = Date.now() - startTime;
  const totalTokens = {
    input:
      round1Result.tokensUsed.input +
      round2Result.tokensUsed.input +
      round3Result.tokensUsed.input,
    output:
      round1Result.tokensUsed.output +
      round2Result.tokensUsed.output +
      round3Result.tokensUsed.output,
  };

  logger.info("Debate", `Debate complete in ${(totalDurationMs / 1000).toFixed(1)}s`);
  logger.info("Debate", `Tokens: ${totalTokens.input} in / ${totalTokens.output} out`);
  logger.info("Debate", `Theses extracted: ${round3Result.synthesis.theses.length}`);

  return {
    debateDate,
    round1: round1Result.round,
    round2: round2Result.round,
    round3: round3Result.synthesis,
    marketRegime: round3Result.marketRegime,
    metadata: {
      totalTokens,
      totalDurationMs,
      agentErrors,
    },
  };
}

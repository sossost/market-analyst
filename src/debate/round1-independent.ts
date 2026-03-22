import type { LLMProvider } from "./llm/index.js";
import { logger } from "@/lib/logger";
import type { AgentPersona, RoundOutput, DebateRound } from "@/types/debate";
import type { PersonaDefinition } from "@/types/debate";

interface Round1Input {
  /** persona.model에서 provider를 생성하는 팩토리 함수 */
  getProvider: (model: string) => LLMProvider;
  experts: PersonaDefinition[];
  question: string;
  memoryContext: string;
  /** Per-persona news context, keyed by persona name */
  newsContext?: Record<string, string>;
  /** Per-persona confidence 캘리브레이션 컨텍스트 */
  calibrationContext?: Record<string, string>;
}

interface Round1Result {
  round: DebateRound;
  tokensUsed: { input: number; output: number };
}

/**
 * Round 1 — Independent Analysis.
 * 4 experts answer the same question in parallel, unaware of each other's responses.
 * Each expert uses the LLMProvider resolved from their persona.model.
 */
export async function runRound1(input: Round1Input): Promise<Round1Result> {
  const { getProvider, experts, question, memoryContext, newsContext = {}, calibrationContext = {} } = input;

  let totalInput = 0;
  let totalOutput = 0;
  const outputs: RoundOutput[] = [];

  // Rate limit 회피: 2명씩 배치, 배치 간 딜레이
  const BATCH_SIZE = 2;
  const BATCH_DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 10_000;
  for (let i = 0; i < experts.length; i += BATCH_SIZE) {
    if (i > 0 && BATCH_DELAY_MS > 0) {
      logger.info("Round1", `Batch delay ${BATCH_DELAY_MS / 1000}s (rate limit mitigation)`);
      await new Promise<void>((r) => setTimeout(r, BATCH_DELAY_MS));
    }
    const batch = experts.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (expert) => {
        let systemPrompt = expert.systemPrompt;
        if (memoryContext.length > 0) {
          systemPrompt += `\n\n## 장기 기억 (검증된 원칙)\n${memoryContext}`;
        }

        // Per-agent confidence 캘리브레이션 주입
        const personaCalibration = calibrationContext[expert.name] ?? "";
        if (personaCalibration.length > 0) {
          systemPrompt += `\n\n## 당신의 Thesis Confidence 캘리브레이션 (개인 성적)\n${personaCalibration}`;
        }

        // 애널리스트별 뉴스 컨텍스트를 질문에 추가
        const personaNews = newsContext[expert.name] ?? "";
        const fullQuestion =
          personaNews.length > 0 ? `${question}\n\n---\n\n${personaNews}` : question;

        const provider = getProvider(expert.model);
        const result = await provider.call({
          systemPrompt,
          userMessage: fullQuestion,
        });
        return { persona: expert.name as AgentPersona, result };
      }),
    );

    for (let index = 0; index < results.length; index++) {
      const settled = results[index];
      if (settled.status === "fulfilled") {
        const { persona, result } = settled.value;
        outputs.push({ persona, content: result.content });
        totalInput += result.tokensUsed.input;
        totalOutput += result.tokensUsed.output;
        logger.info(
          "Round1",
          `${persona} completed (${result.tokensUsed.output} output tokens)`,
        );
      } else {
        const errorMsg =
          settled.reason instanceof Error
            ? settled.reason.message
            : String(settled.reason);
        logger.error("Round1", `${batch[index].name} failed: ${errorMsg}`);
      }
    }
  }

  if (outputs.length === 0) {
    throw new Error("Round 1 failed: no agents produced output");
  }

  return {
    round: { round: 1, outputs },
    tokensUsed: { input: totalInput, output: totalOutput },
  };
}

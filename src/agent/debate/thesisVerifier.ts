import Anthropic from "@anthropic-ai/sdk";
import { loadActiveTheses, resolveThesis, saveCausalAnalysis } from "./thesisStore.js";
import { analyzeCauses } from "./causalAnalyzer.js";
import { callWithRetry } from "./callAgent.js";
import { tryQuantitativeVerification } from "./quantitativeVerifier.js";
import { logger } from "../logger.js";
import type { MarketSnapshot } from "./marketDataLoader.js";
import type { Thesis } from "../../types/debate.js";

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4096;

interface VerificationJudgment {
  thesisId: number;
  verdict: "CONFIRMED" | "INVALIDATED" | "HOLD";
  reason: string;
}

interface VerificationResult {
  confirmed: number;
  invalidated: number;
  held: number;
  quantitative: number;
  llm: number;
  tokensUsed: { input: number; output: number };
}

/**
 * LLM 기반 thesis 자동 검증.
 * 시장 데이터 컨텍스트를 보고 ACTIVE theses가 맞았는지 판정.
 *
 * - CONFIRMED: targetCondition 충족
 * - INVALIDATED: invalidationCondition 충족 또는 명백히 틀림
 * - HOLD: 아직 판단 불가 (유지)
 */
export async function verifyTheses(
  marketDataContext: string,
  debateDate: string,
  snapshot?: MarketSnapshot,
): Promise<VerificationResult> {
  const activeTheses = await loadActiveTheses();

  if (activeTheses.length === 0) {
    logger.info("ThesisVerifier", "No active theses to verify");
    return { confirmed: 0, invalidated: 0, held: 0, quantitative: 0, llm: 0, tokensUsed: { input: 0, output: 0 } };
  }

  logger.info("ThesisVerifier", `Verifying ${activeTheses.length} active theses`);

  // Split: quantitative vs LLM
  const quantitativeResults: Array<{ thesisId: number; verdict: "CONFIRMED" | "INVALIDATED"; reason: string }> = [];
  const llmTheses: typeof activeTheses = [];

  if (snapshot != null) {
    for (const t of activeTheses) {
      const qResult = tryQuantitativeVerification(t as unknown as Thesis, snapshot);
      if (qResult != null) {
        quantitativeResults.push({ thesisId: t.id, verdict: qResult.verdict, reason: qResult.reason });
        logger.info("ThesisVerifier", `[QUANTITATIVE] Thesis #${t.id}: ${qResult.verdict} — ${qResult.reason}`);
      } else {
        llmTheses.push(t);
      }
    }
  } else {
    llmTheses.push(...activeTheses);
  }

  // Resolve quantitative results
  await Promise.all(
    quantitativeResults.map((j) =>
      resolveThesis(j.thesisId, {
        status: j.verdict,
        verificationDate: debateDate,
        verificationResult: j.reason,
        closeReason: j.verdict === "CONFIRMED" ? "condition_met" : "condition_failed",
        verificationMethod: "quantitative",
      }),
    ),
  );

  // LLM verification for remaining (only if llmTheses.length > 0)
  let llmJudgments: VerificationJudgment[] = [];
  let tokensUsed = { input: 0, output: 0 };

  if (llmTheses.length > 0) {
    const thesesText = llmTheses
      .map((t) => {
        const lines = [
          `[ID: ${t.id}] (${t.agentPersona}, ${t.debateDate})`,
          `  전망: ${t.thesis}`,
          `  검증지표: ${t.verificationMetric}`,
          `  달성조건: ${t.targetCondition}`,
        ];
        if (t.invalidationCondition != null) {
          lines.push(`  무효조건: ${t.invalidationCondition}`);
        }
        lines.push(`  기한: ${t.timeframeDays}일 (만료: ~${calcExpiry(t.debateDate, t.timeframeDays)})`);
        return lines.join("\n");
      })
      .join("\n\n");

    const systemPrompt = `당신은 시장 분석 전문가입니다.
아래 시장 데이터를 기반으로 각 thesis의 검증 상태를 판정합니다.

## 판정 기준

- **CONFIRMED**: targetCondition이 현재 시장 데이터에서 충족됨. 명확한 근거 필요.
- **INVALIDATED**: invalidationCondition 충족, 또는 시장이 전망과 반대 방향으로 명확히 움직임.
- **HOLD**: 아직 판단하기 이름. 데이터가 부족하거나 방향이 불명확.

## 규칙

- 확실한 경우에만 CONFIRMED/INVALIDATED 판정. 애매하면 HOLD.
- 각 판정에 1~2줄의 구체적 근거를 포함.
- 시장 데이터에서 확인할 수 없는 조건은 반드시 HOLD.
- 반드시 JSON 배열로만 응답. 다른 텍스트 없이.

## 응답 포맷

\`\`\`json
[
  { "thesisId": 1, "verdict": "CONFIRMED", "reason": "S&P 500이 5,800 돌파하며 조건 충족" },
  { "thesisId": 2, "verdict": "HOLD", "reason": "아직 데이터 부족" }
]
\`\`\``;

    const userMessage = `오늘 날짜: ${debateDate}

## 현재 시장 데이터
${marketDataContext}

## 검증 대상 Theses
${thesesText}

각 thesis를 검증하고 JSON 배열로 응답하세요.`;

    const client = new Anthropic();

    const response = await callWithRetry(() =>
      client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    );

    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === "text",
    );
    const rawText = textBlocks.map((b) => b.text).join("\n");

    llmJudgments = parseJudgments(rawText, llmTheses.map((t) => t.id));

    // Apply LLM judgments — resolve in DB
    type ResolvedJudgment = VerificationJudgment & { verdict: "CONFIRMED" | "INVALIDATED" };
    const llmResolved = llmJudgments.filter(
      (j): j is ResolvedJudgment => j.verdict !== "HOLD",
    );

    await Promise.all(
      llmResolved.map((j) =>
        resolveThesis(j.thesisId, {
          status: j.verdict,
          verificationDate: debateDate,
          verificationResult: j.reason,
          closeReason: j.verdict === "CONFIRMED" ? "condition_met" : "condition_failed",
          verificationMethod: "llm",
        }),
      ),
    );

    tokensUsed = {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    };
  }

  // Combine all resolved for stats and causal analysis
  const quantitativeConfirmed = quantitativeResults.filter((j) => j.verdict === "CONFIRMED").length;
  const quantitativeInvalidated = quantitativeResults.filter((j) => j.verdict === "INVALIDATED").length;
  const llmConfirmed = llmJudgments.filter((j) => j.verdict === "CONFIRMED").length;
  const llmInvalidated = llmJudgments.filter((j) => j.verdict === "INVALIDATED").length;
  const held = llmJudgments.filter((j) => j.verdict === "HOLD").length;

  const confirmed = quantitativeConfirmed + llmConfirmed;
  const invalidated = quantitativeInvalidated + llmInvalidated;

  logger.info(
    "ThesisVerifier",
    `Results: ${confirmed} confirmed, ${invalidated} invalidated, ${held} held (quantitative: ${quantitativeResults.length}, llm: ${llmTheses.length})`,
  );

  // Causal analysis — all resolved theses (both quantitative and LLM)
  const allResolved = [
    ...quantitativeResults.map((j) => ({ thesisId: j.thesisId, verdict: j.verdict, reason: j.reason })),
    ...llmJudgments
      .filter((j): j is VerificationJudgment & { verdict: "CONFIRMED" | "INVALIDATED" } => j.verdict !== "HOLD")
      .map((j) => ({ thesisId: j.thesisId, verdict: j.verdict, reason: j.reason })),
  ];

  if (allResolved.length > 0) {
    try {
      const thesisMap = new Map(activeTheses.map((t) => [t.id, t]));
      const resolvedTheses = allResolved
        .map((j) => {
          const t = thesisMap.get(j.thesisId);
          if (t == null) return null;
          return {
            id: t.id,
            agentPersona: t.agentPersona,
            thesis: t.thesis,
            debateDate: t.debateDate,
            verificationMetric: t.verificationMetric,
            targetCondition: t.targetCondition,
            invalidationCondition: t.invalidationCondition,
            status: j.verdict,
            verificationResult: j.reason,
          };
        })
        .filter((t) => t != null);

      const causalResults = await analyzeCauses({
        resolvedTheses,
        marketDataContext,
        debateDate,
      });

      await Promise.all(
        causalResults.map((r) => saveCausalAnalysis(r.thesisId, {
          causalChain: r.causalChain,
          keyFactors: r.keyFactors,
          reusablePattern: r.reusablePattern,
          lessonsLearned: r.lessonsLearned,
        })),
      );

      logger.info("ThesisVerifier", `Causal analysis completed for ${causalResults.length} theses`);
    } catch (err) {
      logger.warn("ThesisVerifier", `Causal analysis failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    confirmed,
    invalidated,
    held,
    quantitative: quantitativeResults.length,
    llm: llmTheses.length,
    tokensUsed,
  };
}

function calcExpiry(debateDate: string, timeframeDays: number): string {
  const d = new Date(debateDate);
  d.setDate(d.getDate() + timeframeDays);
  return d.toISOString().slice(0, 10);
}

/**
 * LLM 응답에서 판정 JSON 배열 파싱.
 * 유효한 thesis ID만 필터.
 */
export function parseJudgments(
  rawText: string,
  validIds: number[],
): VerificationJudgment[] {
  // Strip code fences
  let cleaned = rawText
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();

  // Find JSON array boundaries
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    logger.warn("ThesisVerifier", "Failed to find JSON array in response");
    return [];
  }

  cleaned = cleaned.slice(start, end + 1);

  let parsed: unknown[];
  try {
    parsed = JSON.parse(cleaned) as unknown[];
  } catch {
    logger.warn("ThesisVerifier", `JSON parse failed: ${cleaned.slice(0, 100)}`);
    return [];
  }

  const VALID_VERDICTS = new Set(["CONFIRMED", "INVALIDATED", "HOLD"]);
  const validIdSet = new Set(validIds);

  return parsed
    .filter((item): item is Record<string, unknown> => {
      if (typeof item !== "object" || item == null) return false;
      const obj = item as Record<string, unknown>;
      return (
        typeof obj.thesisId === "number" &&
        typeof obj.verdict === "string" &&
        VALID_VERDICTS.has(obj.verdict) &&
        typeof obj.reason === "string" &&
        validIdSet.has(obj.thesisId)
      );
    })
    .map((obj) => ({
      thesisId: obj.thesisId as number,
      verdict: obj.verdict as VerificationJudgment["verdict"],
      reason: obj.reason as string,
    }));
}

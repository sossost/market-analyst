import { loadActiveTheses, resolveThesis, saveCausalAnalysis } from "./thesisStore.js";
import { analyzeCauses } from "./causalAnalyzer.js";
import { tryQuantitativeVerification } from "./quantitativeVerifier.js";
import { logger } from "../logger.js";
import { ClaudeCliProvider } from "./llm/claudeCliProvider.js";
import { AnthropicProvider } from "./llm/anthropicProvider.js";
import { FallbackProvider } from "./llm/fallbackProvider.js";
import type { LLMProvider } from "./llm/types.js";
import type { MarketSnapshot } from "./marketDataLoader.js";
import type { Thesis } from "../../types/debate.js";

import { CLAUDE_SONNET } from "@/lib/models.js";

const FALLBACK_MODEL = CLAUDE_SONNET;
const MAX_TOKENS = 4096;
const MS_PER_DAY = 86_400_000;

function createVerifierProvider(): LLMProvider {
  const cli = new ClaudeCliProvider();
  const hasApiKey = process.env.ANTHROPIC_API_KEY != null && process.env.ANTHROPIC_API_KEY !== "";
  if (!hasApiKey) return cli;
  return new FallbackProvider(cli, new AnthropicProvider(FALLBACK_MODEL), "ClaudeCLI");
}

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
  quantitativeRate: number;
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
    return { confirmed: 0, invalidated: 0, held: 0, quantitative: 0, llm: 0, quantitativeRate: 0, tokensUsed: { input: 0, output: 0 } };
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
    const sanitize = (s: string) => s.replace(/<\/thesis>/gi, "");
    const thesesText = llmTheses
      .map((t) => {
        const elapsedDays = calcElapsedDays(t.debateDate, debateDate);
        const progressPct = t.timeframeDays > 0
          ? Math.min(100, Math.round((elapsedDays / t.timeframeDays) * 100))
          : 0;
        const lines = [
          `[ID: ${t.id}] (${t.agentPersona}, ${t.debateDate})`,
          `  전망: ${sanitize(t.thesis)}`,
          `  검증지표: ${sanitize(t.verificationMetric)}`,
          `  달성조건: ${sanitize(t.targetCondition)}`,
        ];
        if (t.invalidationCondition != null) {
          lines.push(`  무효조건: ${sanitize(t.invalidationCondition)}`);
        }
        lines.push(
          `  기한: ${t.timeframeDays}일 (경과: ${elapsedDays}일 / 전체: ${t.timeframeDays}일, 진행률: ${progressPct}%, 만료: ~${calcExpiry(t.debateDate, t.timeframeDays)})`,
        );
        return `<thesis>\n${lines.join("\n")}\n</thesis>`;
      })
      .join("\n\n");

    const systemPrompt = `당신은 시장 분석 전문가입니다.
아래 시장 데이터를 기반으로 각 thesis의 검증 상태를 판정합니다.

## 판정 기준

- **CONFIRMED**: targetCondition이 현재 시장 데이터에서 충족됨. 명확한 근거 필요.
- **INVALIDATED**: invalidationCondition 충족, 또는 시장이 전망과 반대 방향으로 명확히 움직임.
- **HOLD**: **timeframe이 아직 충분히 남아 있어 판단이 시기상조**인 경우로 한정. 단순히 데이터가 불명확하다는 이유만으로는 HOLD 사용 불가.

## INVALIDATED 적극 판정 가이드

다음 두 조건이 동시에 충족되면 INVALIDATED를 강하게 권장:
1. **진행률 50% 이상** (thesis 포맷의 "진행률" 참조)
2. **시장이 targetCondition과 반대 방향으로 명확히 이동**

정성적 신호 예시 (수치 없이도 판단 가능):
- 섹터 분위기 악화: "AI/반도체 관련 뉴스 흐름이 부정적으로 전환", "빅테크 실망 실적 연속"
- 명확한 추세 반전: "기술주 전반의 매도 압력 지속", "섹터 로테이션이 방어주 방향으로 진행 중"
- 구조적 변화: "금리 인상 재개로 성장주 밸류에이션 압박 재현"

## 규칙

- HOLD는 timeframe이 남아 있어 판단이 **시기상조**인 경우로만 사용.
- 진행률이 높고 시장 방향이 전망과 다르면 HOLD가 아닌 INVALIDATED로 판정.
- 각 판정에 1~2줄의 구체적 근거를 포함.
- 반드시 JSON 배열로만 응답. 다른 텍스트 없이.

## 응답 포맷

\`\`\`json
[
  { "thesisId": 1, "verdict": "CONFIRMED", "reason": "S&P 500이 5,800 돌파하며 조건 충족" },
  { "thesisId": 2, "verdict": "INVALIDATED", "reason": "진행률 70%, AI 반도체 섹터 뉴스 흐름이 부정적으로 전환되어 상승 전망 무효" },
  { "thesisId": 3, "verdict": "HOLD", "reason": "진행률 20%, timeframe이 충분히 남아 있어 판단 시기상조" }
]
\`\`\``;

    const userMessage = `오늘 날짜: ${debateDate}

## 현재 시장 데이터
${marketDataContext}

## 검증 대상 Theses
${thesesText}

각 thesis를 검증하고 JSON 배열로 응답하세요.`;

    const provider = createVerifierProvider();

    const llmResult = await provider.call({
      systemPrompt,
      userMessage,
      maxTokens: MAX_TOKENS,
    });

    llmJudgments = parseJudgments(llmResult.content, llmTheses.map((t) => t.id));

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

    tokensUsed = llmResult.tokensUsed;
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

  const totalVerified = quantitativeResults.length + llmTheses.length;
  const quantitativeRate = totalVerified > 0 ? quantitativeResults.length / totalVerified : 0;

  if (quantitativeRate < 0.3) {
    logger.warn("ThesisVerifier", `정량 커버리지 경고: ${(quantitativeRate * 100).toFixed(0)}% (임계값 30%)`);
  }

  logger.info("ThesisVerifier", `정량 커버리지: ${(quantitativeRate * 100).toFixed(0)}% (${quantitativeResults.length}/${totalVerified})`);

  return {
    confirmed,
    invalidated,
    held,
    quantitative: quantitativeResults.length,
    llm: llmTheses.length,
    quantitativeRate,
    tokensUsed,
  };
}

function calcExpiry(debateDate: string, timeframeDays: number): string {
  const d = new Date(debateDate);
  d.setDate(d.getDate() + timeframeDays);
  return d.toISOString().slice(0, 10);
}

export function calcElapsedDays(debateDate: string, currentDate: string): number {
  const start = new Date(debateDate).getTime();
  const now = new Date(currentDate).getTime();
  return Math.max(0, Math.floor((now - start) / MS_PER_DAY));
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

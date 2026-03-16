/**
 * QualityFilter — 인사이트 품질 검증
 *
 * Claude API로 각 인사이트를 4개 기준으로 평가.
 * 총점 12점 미달 시 폐기. 통과한 인사이트만 이슈 생성 파이프라인으로 전달.
 *
 * 평가 기준:
 * 1. 구체성 (1-5): 파일명/함수명/조건값 포함 여부
 * 2. 골 연결성 (1-5): Phase 2 초입 포착에 직접 영향 여부
 * 3. 실행 가능성 (1-5): 다음 스프린트에 처리 가능 여부
 * 4. 근거 충분성 (1-5): 코드/데이터 증거 포함 여부
 */

import type { LLMProvider } from "../agent/debate/llm/types.js";
import type { Insight, QualityScore, QualityFilterResult } from "./types.js";
import { createStrategicReviewProvider } from "./providerFactory.js";

const QUALITY_THRESHOLD = 12;
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `당신은 시장 분석 시스템의 전략 인사이트 품질 평가자입니다.
인사이트를 받아 4개 기준으로 각각 1~5점을 부여하고, 반드시 JSON 형식으로만 응답하십시오.

평가 기준:
1. specificity (구체성): 파일명, 함수명, 조건값, 임계값 등 구체적 정보가 포함되는가?
   - 5: 파일명 + 함수명 + 구체적 수치 모두 포함
   - 3: 파일명이나 함수명 중 하나만 포함
   - 1: 추상적인 설명만 있음
2. goalAlignment (골 연결성): Phase 2 초입 포착(남들보다 먼저 주도주 발굴)에 직접 영향하는가?
   - 5: 포착 정확도/속도에 직접적 영향
   - 3: 간접적으로 영향
   - 1: 거의 관련 없음
3. actionability (실행 가능성): 개발자가 다음 스프린트(1~2주)에 처리할 수 있는가?
   - 5: 즉시 구현 가능한 명확한 작업
   - 3: 추가 분석 후 구현 가능
   - 1: 장기 연구 필요 또는 불가능
4. evidenceSufficiency (근거 충분성): 코드 분석, DB 데이터, 수치 등 근거가 있는가?
   - 5: 코드/데이터/수치 모두 포함한 강한 근거
   - 3: 일부 근거 존재
   - 1: 추측성 주장만

JSON 형식으로만 응답:
{"specificity": N, "goalAlignment": N, "actionability": N, "evidenceSufficiency": N}`;

/**
 * 단일 인사이트 품질 평가
 */
async function evaluateInsight(
  insight: Insight,
  provider: LLMProvider,
): Promise<QualityScore> {
  const userMessage = `다음 인사이트를 평가하십시오:

제목: ${insight.title}

내용:
${insight.body}`;

  const result = await provider.call({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxTokens: MAX_TOKENS,
  });

  return parseQualityScore(result.content);
}

/**
 * LLM 응답에서 품질 점수 파싱
 */
export function parseQualityScore(content: string): QualityScore {
  const jsonMatch = content.match(/\{[^}]+\}/);
  if (jsonMatch == null) {
    return buildFallbackScore();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return buildFallbackScore();
  }

  if (parsed == null || typeof parsed !== "object") {
    return buildFallbackScore();
  }

  const obj = parsed as Record<string, unknown>;
  const specificity = clampScore(obj["specificity"]);
  const goalAlignment = clampScore(obj["goalAlignment"]);
  const actionability = clampScore(obj["actionability"]);
  const evidenceSufficiency = clampScore(obj["evidenceSufficiency"]);
  const total = specificity + goalAlignment + actionability + evidenceSufficiency;

  return { specificity, goalAlignment, actionability, evidenceSufficiency, total };
}

export function clampScore(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1;
  return Math.max(1, Math.min(5, Math.round(num)));
}

/**
 * LLM 파싱 실패 시 최소 점수 반환 (폐기 처리됨)
 */
function buildFallbackScore(): QualityScore {
  return {
    specificity: 1,
    goalAlignment: 1,
    actionability: 1,
    evidenceSufficiency: 1,
    total: 4,
  };
}

/**
 * 인사이트 목록을 품질 필터링
 *
 * 각 인사이트를 Claude로 평가, 총점 12점 이상만 통과.
 */
export async function filterInsightsByQuality(
  insights: Insight[],
): Promise<{
  passed: Insight[];
  results: QualityFilterResult[];
}> {
  if (insights.length === 0) {
    return { passed: [], results: [] };
  }

  const provider = createStrategicReviewProvider();

  const results: QualityFilterResult[] = await Promise.all(
    insights.map(async (insight) => {
      const score = await evaluateInsight(insight, provider);
      return {
        insight,
        score,
        passed: score.total >= QUALITY_THRESHOLD,
      };
    }),
  );

  const passed = results
    .filter((r) => r.passed)
    .map((r) => r.insight);

  return { passed, results };
}

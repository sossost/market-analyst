/**
 * CaptureLogicAuditor — 포착 로직 감사
 *
 * 질문: Phase 2 초입 포착 도구들이 정확하게 작동하는가?
 *
 * 분석 대상:
 * - src/lib/phase-detection.ts — Phase 판정 로직, 임계값
 * - src/agent/tools/getPhase1LateStocks.ts — MA150 기울기 양전환 조건
 * - src/agent/tools/getRisingRS.ts — RS 30~60 범위 조건
 * - src/agent/tools/getFundamentalAcceleration.ts — EPS 가속 조건
 * - src/lib/fundamental-scorer.ts — SEPA 스코어링
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Insight } from "../types.js";
import { createStrategicReviewProvider } from "../providerFactory.js";

const MAX_TOKENS = 4096;

/** 분석 대상 파일 경로 (프로젝트 루트 기준) */
const TARGET_FILES = [
  "src/lib/phase-detection.ts",
  "src/agent/tools/getPhase1LateStocks.ts",
  "src/agent/tools/getRisingRS.ts",
  "src/agent/tools/getFundamentalAcceleration.ts",
  "src/lib/fundamental-scorer.ts",
];

const SYSTEM_PROMPT = `당신은 주식 시장 분석 시스템의 포착 로직 감사 전문가입니다.
프로젝트 골: Phase 2 초입 주도주를 남들보다 먼저 포착하는 것.

다음 코드 파일들을 분석하여 포착 로직의 구조적 문제와 개선 기회를 찾으십시오.

중요 규칙:
- 실제 코드에 있는 구체적인 파일명, 함수명, 조건값, 임계값을 반드시 인용하십시오
- Phase 2 초입 포착 정확도에 직접 영향하는 문제만 보고하십시오
- 코드 품질/스타일 지적은 하지 마십시오
- 추측이 아닌 코드에 근거한 분석만 하십시오
- 1~3개의 핵심 인사이트만 생성하십시오

각 인사이트는 다음 JSON 배열 형식으로 반환하십시오:
[
  {
    "title": "한 줄 제목 (구체적 파일명/함수명/조건값 포함)",
    "body": "## 문제\n구체적 설명\n\n## 코드 근거\n\`파일명.ts\`의 어떤 부분\n\n## 개선안\n구체적 제안",
    "priority": "P1 또는 P2 또는 P3"
  }
]`;

/**
 * 대상 코드 파일을 읽어 하나의 컨텍스트 문자열로 병합
 *
 * 개별 파일 읽기 실패 시 해당 파일을 [읽기 실패]로 표시하고 나머지는 계속 진행.
 */
async function loadCodeContext(projectRoot: string): Promise<string> {
  const parts: string[] = [];

  for (const filePath of TARGET_FILES) {
    const absolutePath = join(projectRoot, filePath);
    let content: string;
    try {
      content = await readFile(absolutePath, "utf-8");
    } catch {
      content = "[읽기 실패 — 파일이 존재하지 않거나 접근 권한 없음]";
    }
    parts.push(`\n\n### 파일: ${filePath}\n\`\`\`typescript\n${content}\n\`\`\``);
  }

  return parts.join("");
}

interface RawInsight {
  title: string;
  body: string;
  priority: string;
}

export function parseInsights(content: string): RawInsight[] {
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (jsonMatch == null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.filter(
    (item): item is RawInsight =>
      item != null &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>)["title"] === "string" &&
      typeof (item as Record<string, unknown>)["body"] === "string",
  );
}

export function normalizePriority(raw: string): "P1" | "P2" | "P3" {
  const upper = raw.toUpperCase();
  if (upper === "P1") return "P1";
  if (upper === "P2") return "P2";
  return "P3";
}

/**
 * 포착 로직 감사 실행
 */
export async function runCaptureLogicAudit(
  projectRoot: string,
): Promise<Insight[]> {
  const codeContext = await loadCodeContext(projectRoot);
  const provider = createStrategicReviewProvider();

  const userMessage = `다음 포착 로직 코드들을 감사하십시오. Phase 2 초입 포착 정확도를 개선할 수 있는 구체적인 문제와 기회를 찾으십시오:

${codeContext}`;

  const result = await provider.call({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxTokens: MAX_TOKENS,
  });

  const rawInsights = parseInsights(result.content);

  return rawInsights.map((raw) => ({
    title: raw.title,
    body: raw.body,
    focus: "capture-logic" as const,
    priority: normalizePriority(raw.priority),
    reviewerName: "captureLogicAuditor",
  }));
}

/**
 * LearningLoopAuditor — 학습 루프 감사
 *
 * 질문: 시스템이 올바르게 학습하고 있는가?
 *
 * 분석 대상:
 * - agent_learnings 테이블: 최근 항목의 근거 충분성 (hit_count, hit_rate)
 * - theses 테이블: ACTIVE thesis 중 30일+ HOLD 항목
 * - 자기참조 루프 징후: LLM이 생성+검증하는 패턴 탐지
 */

import { db } from "../../db/client.js";
import { createStrategicReviewProvider } from "../providerFactory.js";
import { agentLearnings, theses } from "../../db/schema/analyst.js";
import { eq, lte, and, sql } from "drizzle-orm";
import type { Insight } from "../types.js";

const MAX_TOKENS = 4096;
const RECENT_LEARNINGS_LIMIT = 30;
const HOLD_DAYS_THRESHOLD = 30;

const SYSTEM_PROMPT = `당신은 주식 시장 분석 시스템의 학습 루프 감사 전문가입니다.
프로젝트 골: Phase 2 초입 주도주를 남들보다 먼저 포착하는 것.

제공되는 DB 데이터를 분석하여 학습 루프의 구조적 문제와 건강도를 평가하십시오.

분석 포인트:
1. agentLearnings: 낮은 hit_count/hit_rate 항목 — 근거 불충분으로 학습 오염 위험
2. theses: HOLD 기간이 과도하게 긴 항목 — invalidation 기준 부재 징후
3. 자기참조 루프: LLM이 생성한 thesis를 동일 LLM이 검증하는 패턴의 위험성

중요 규칙:
- 실제 데이터에서 발견한 구체적 수치(ID, 일수, hit_count, hit_rate)를 인용하십시오
- Phase 2 포착 정확도에 영향하는 학습 오염 위험만 보고하십시오
- 1~3개의 핵심 인사이트만 생성하십시오

각 인사이트는 다음 JSON 배열 형식으로 반환하십시오:
[
  {
    "title": "한 줄 제목 (구체적 수치 포함)",
    "body": "## 문제\n구체적 설명\n\n## DB 근거\n조회된 데이터 수치\n\n## 개선안\n구체적 제안",
    "priority": "P1 또는 P2 또는 P3"
  }
]`;

interface LearningRow {
  id: number;
  principle: string;
  category: string;
  hitCount: number | null;
  missCount: number | null;
  hitRate: string | null;
  firstConfirmed: string | null;
  lastVerified: string | null;
  verificationPath: string | null;
}

interface ThesisRow {
  id: number;
  debateDate: string;
  agentPersona: string;
  thesis: string;
  status: string;
  createdAt: Date;
  verificationMethod: string | null;
}

/**
 * agent_learnings 최근 30개 조회
 */
async function fetchRecentLearnings(): Promise<LearningRow[]> {
  const rows = await db
    .select({
      id: agentLearnings.id,
      principle: agentLearnings.principle,
      category: agentLearnings.category,
      hitCount: agentLearnings.hitCount,
      missCount: agentLearnings.missCount,
      hitRate: agentLearnings.hitRate,
      firstConfirmed: agentLearnings.firstConfirmed,
      lastVerified: agentLearnings.lastVerified,
      verificationPath: agentLearnings.verificationPath,
    })
    .from(agentLearnings)
    .where(eq(agentLearnings.isActive, true))
    .orderBy(sql`${agentLearnings.createdAt} DESC`)
    .limit(RECENT_LEARNINGS_LIMIT);

  return rows.map((r) => ({
    id: r.id,
    principle: r.principle,
    category: r.category,
    hitCount: r.hitCount,
    missCount: r.missCount,
    hitRate: r.hitRate,
    firstConfirmed: r.firstConfirmed,
    lastVerified: r.lastVerified,
    verificationPath: r.verificationPath,
  }));
}

/**
 * ACTIVE thesis 중 30일+ HOLD 항목 조회
 */
async function fetchLongHoldTheses(): Promise<ThesisRow[]> {
  const thresholdDate = new Date();
  thresholdDate.setDate(thresholdDate.getDate() - HOLD_DAYS_THRESHOLD);
  const thresholdStr = thresholdDate.toISOString().split("T")[0];

  const rows = await db
    .select({
      id: theses.id,
      debateDate: theses.debateDate,
      agentPersona: theses.agentPersona,
      thesis: theses.thesis,
      status: theses.status,
      createdAt: theses.createdAt,
      verificationMethod: theses.verificationMethod,
    })
    .from(theses)
    .where(
      and(
        eq(theses.status, "ACTIVE"),
        lte(theses.debateDate, thresholdStr),
      ),
    )
    .orderBy(sql`${theses.debateDate} ASC`)
    .limit(20);

  return rows;
}

/**
 * 학습 데이터를 분석용 컨텍스트 문자열로 포맷
 */
function buildAnalysisContext(
  learnings: LearningRow[],
  longHoldTheses: ThesisRow[],
): string {
  const today = new Date().toISOString().split("T")[0];

  const learningsSummary = learnings.map((l) => {
    const hitCount = l.hitCount ?? 0;
    const missCount = l.missCount ?? 0;
    const hitRate = l.hitRate != null ? `${(parseFloat(l.hitRate) * 100).toFixed(0)}%` : "N/A";
    return `  - ID ${l.id}: [${l.category}] hit=${hitCount}, miss=${missCount}, rate=${hitRate}, path=${l.verificationPath ?? "null"}\n    "${l.principle.slice(0, 80)}..."`;
  });

  const thesesSummary = longHoldTheses.map((t) => {
    const createdDate = t.debateDate;
    const daysSince = Math.floor(
      (new Date(today).getTime() - new Date(createdDate).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    return `  - ID ${t.id}: [${t.agentPersona}] HOLD ${daysSince}일, method=${t.verificationMethod ?? "null"}\n    "${t.thesis.slice(0, 80)}..."`;
  });

  return `## 오늘 날짜: ${today}

## agent_learnings 최근 ${learnings.length}개 (ACTIVE)
${learningsSummary.join("\n")}

## ACTIVE thesis 중 ${HOLD_DAYS_THRESHOLD}일+ HOLD (총 ${longHoldTheses.length}개)
${thesesSummary.length > 0 ? thesesSummary.join("\n") : "  없음"}`;
}

interface RawInsight {
  title: string;
  body: string;
  priority: string;
}

function parseInsights(content: string): RawInsight[] {
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

function normalizePriority(raw: string): "P1" | "P2" | "P3" {
  const upper = raw.toUpperCase();
  if (upper === "P1") return "P1";
  if (upper === "P2") return "P2";
  return "P3";
}

/**
 * 학습 루프 감사 실행
 */
export async function runLearningLoopAudit(): Promise<Insight[]> {
  const [learnings, longHoldTheses] = await Promise.all([
    fetchRecentLearnings(),
    fetchLongHoldTheses(),
  ]);

  const analysisContext = buildAnalysisContext(learnings, longHoldTheses);
  const provider = createStrategicReviewProvider();

  const userMessage = `다음 학습 루프 데이터를 감사하십시오. 학습 오염, 근거 불충분, HOLD 기간 과다 등의 문제를 찾으십시오:

${analysisContext}`;

  const result = await provider.call({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    maxTokens: MAX_TOKENS,
  });

  const rawInsights = parseInsights(result.content);

  return rawInsights.map((raw) => ({
    title: raw.title,
    body: raw.body,
    focus: "learning-loop" as const,
    priority: normalizePriority(raw.priority),
    reviewerName: "learningLoopAuditor",
  }));
}

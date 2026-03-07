import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { pool } from "@/db/client";
import { sendDiscordMessage, sendDiscordError } from "./discord";
import { createGist } from "./gist";
import { logger } from "./logger";

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 4096;

// --- 데이터 수집 ---

interface ThesisWeeklyRow {
  persona: string;
  status: string;
  cnt: number;
}

interface ThesisOverallRow {
  persona: string;
  confirmed: number;
  invalidated: number;
  expired: number;
  active: number;
  total: number;
}

interface RecommendationRow {
  status: string;
  cnt: number;
  avg_return: number | null;
}

interface LearningRow {
  category: string;
  cnt: number;
}

interface ReportLogRow {
  date: string;
  report_type: string;
}

interface CollectedData {
  thesisWeekly: ThesisWeeklyRow[] | null;
  thesisOverall: ThesisOverallRow[] | null;
  recommendations: RecommendationRow[] | null;
  learnings: LearningRow[] | null;
  recentReports: ReportLogRow[] | null;
}

async function queryOrNull<T>(label: string, sql: string): Promise<T[] | null> {
  try {
    const result = await pool.query(sql);
    return result.rows as T[];
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("QA-Data", `${label} 쿼리 실패: ${reason}`);
    return null;
  }
}

async function collectData(): Promise<CollectedData> {
  const [thesisWeekly, thesisOverall, recommendations, learnings, recentReports] =
    await Promise.all([
      queryOrNull<ThesisWeeklyRow>(
        "thesis_weekly",
        `SELECT persona, status, COUNT(*)::int as cnt
         FROM theses
         WHERE created_at > NOW() - INTERVAL '7 days'
         GROUP BY persona, status
         ORDER BY persona, status`,
      ),
      queryOrNull<ThesisOverallRow>(
        "thesis_overall",
        `SELECT persona,
           COUNT(*) FILTER (WHERE status = 'CONFIRMED')::int as confirmed,
           COUNT(*) FILTER (WHERE status = 'INVALIDATED')::int as invalidated,
           COUNT(*) FILTER (WHERE status = 'EXPIRED')::int as expired,
           COUNT(*) FILTER (WHERE status = 'ACTIVE')::int as active,
           COUNT(*)::int as total
         FROM theses
         GROUP BY persona
         ORDER BY persona`,
      ),
      queryOrNull<RecommendationRow>(
        "recommendations",
        `SELECT status,
           COUNT(*)::int as cnt,
           ROUND(AVG(current_return_pct)::numeric, 2)::float as avg_return
         FROM recommendations
         GROUP BY status
         ORDER BY status`,
      ),
      queryOrNull<LearningRow>(
        "learnings",
        `SELECT category, COUNT(*)::int as cnt
         FROM agent_learnings
         WHERE status = 'active'
         GROUP BY category
         ORDER BY category`,
      ),
      queryOrNull<ReportLogRow>(
        "recent_reports",
        `SELECT date::text, report_type
         FROM report_logs
         WHERE date > NOW() - INTERVAL '7 days'
         ORDER BY date DESC`,
      ),
    ]);

  return { thesisWeekly, thesisOverall, recommendations, learnings, recentReports };
}

// --- 프롬프트 구성 ---

function formatDataSection<T>(label: string, data: T[] | null): string {
  if (data == null) {
    return `### ${label}\n데이터 수집 실패\n`;
  }
  if (data.length === 0) {
    return `### ${label}\n데이터 없음\n`;
  }
  return `### ${label}\n${JSON.stringify(data, null, 2)}\n`;
}

function buildUserPrompt(data: CollectedData, today: string): string {
  const sections = [
    `오늘 날짜: ${today}`,
    "",
    "아래 데이터를 기반으로 주간 QA + 전략 점검 리포트를 작성하세요.",
    "",
    formatDataSection("1. Thesis 성과 (최근 7일)", data.thesisWeekly),
    formatDataSection("2. Thesis 전체 적중률 (장관별)", data.thesisOverall),
    formatDataSection("3. 추천 성과", data.recommendations),
    formatDataSection("4. 학습 원칙 현황", data.learnings),
    formatDataSection("5. 최근 리포트 로그", data.recentReports),
  ];
  return sections.join("\n");
}

const SYSTEM_PROMPT = `당신은 두 역할을 겸합니다:

## 역할 1: QA 분석가
헤지펀드 리스크 매니저 출신. 시스템 아웃풋의 품질을 냉정하게 측정하고 근본 원인을 처방합니다.
- 측정 없이 개선 없다 — 감이 아니라 숫자로 판단
- 증상이 아니라 원인을 본다
- 반복 패턴을 잡는다 — 세 번은 시스템 문제
- 처방은 구체적으로 — 파일명, 라인, 변경 내용

## 역할 2: 전략 보좌관
프로젝트 골과 현실의 거리를 측정합니다.
프로젝트 골: Phase 2(상승 초입) 주도섹터/주도주를 남들보다 먼저 포착하여 알파를 형성하는 것.
- "초입" = Phase 1→2 전환 직전/초기 (RS 30~60, 52주저+20~40%)
- "남들보다 먼저" = 시장이 아직 주목하지 않는 단계에서 포착

## 출력 형식

반드시 아래 형식으로 출력하세요. 데이터가 없는 섹션은 "데이터 부족으로 판단 보류"로 표시하세요.

\`\`\`
# 주간 QA & 전략 점검 (YYYY-MM-DD)

## 종합 점수: X/10

## 1. 장관 성과
- 장관별 적중률 테이블 (confirmed / invalidated / expired / active / total)
- 최우수: X (Y%)
- 최저: X (Y%)
- 이번 주 신규 thesis: N건
- 처방: [필요시]

## 2. 추천 성과
- 활성 추천: N건, 평균 수익률 X%
- 종료 추천: N건, 승률 X%
- 추세: [개선/악화/유지]

## 3. 시스템 건강도
- 학습 원칙: N개 활성 (카테고리별)
- 데이터 파이프라인: [정상/이상] (최근 리포트 빈도 기반)

## 4. 골 달성 진척도
- 이번 주 리포트에 Phase 1 후기 종목이 포함되었는가?
- RS 30~60 범위 종목이 추천에 포함되었는가?
- 초입 포착이라는 골에 얼마나 부합하는가?

## 5. 낭비 감지 & 권고
- API 비용 대비 가치 평가
- 다음 주 가장 시급한 1가지 권고

## CEO 보고 요약
- 핵심 1줄: "..."
- 의사결정 필요: [있으면 구체적으로 / 없으면 "없음"]
\`\`\`

## 규칙
- 데이터가 부족하면 "데이터 부족으로 판단 보류"라고 명시
- 추측하지 않는다 — 숫자가 말하게 한다
- 처방은 항상 구체적이어야 한다
- 한국어로 작성`;

// --- 메인 ---

function validateEnvironment(): void {
  const required = ["DATABASE_URL", "ANTHROPIC_API_KEY"];
  const missing = required.filter(
    (key) => process.env[key] == null || process.env[key] === "",
  );
  if (missing.length > 0) {
    throw new Error(`필수 환경변수 누락: ${missing.join(", ")}`);
  }
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function sanitizeErrorForDiscord(msg: string): string {
  const MAX_LENGTH = 500;
  const sanitized = msg
    .replace(/postgres(ql)?:\/\/[^\s]+/gi, "[DB_URL]")
    .replace(/https?:\/\/[^\s]*token[^\s]*/gi, "[REDACTED_URL]")
    .replace(/key[=:]\s*\S+/gi, "key=[REDACTED]");
  return sanitized.length > MAX_LENGTH
    ? `${sanitized.slice(0, MAX_LENGTH)}...`
    : sanitized;
}

/**
 * Discord 멘션 sanitize — LLM 생성 텍스트에서 @everyone, @here 등 제거.
 */
function sanitizeDiscordMentions(text: string): string {
  return text
    .replace(/@everyone/gi, "@\u200Beveryone")
    .replace(/@here/gi, "@\u200Bhere")
    .replace(/<@[!&]?\d+>/g, "[mention]");
}

/**
 * 리포트에서 "CEO 보고 요약" 섹션 추출.
 * 못 찾으면 첫 300자 사용.
 */
function extractCeoSummary(report: string): string {
  const match = report.match(
    /##\s*CEO 보고 요약[^\n]*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/,
  );
  if (match != null) {
    return match[1].trim();
  }
  const fallback = report.slice(0, 300).trim();
  return fallback.endsWith(".") ? fallback : `${fallback}...`;
}

/**
 * 리포트에서 "종합 점수" 추출.
 */
function extractScore(report: string): string | null {
  const match = report.match(/종합 점수:\s*(\d+\/\d+)/);
  return match != null ? match[1] : null;
}

async function main() {
  logger.step("=== 주간 QA 점검 시작 ===\n");

  // 1. 환경변수 검증
  validateEnvironment();
  logger.step("[1/4] 환경변수 검증 완료");

  // 2. 데이터 수집
  logger.step("[2/4] 데이터 수집 중...");
  const today = getToday();
  const data = await collectData();

  const successCount = Object.values(data).filter((v) => v != null).length;
  const totalCount = Object.keys(data).length;
  logger.info("QA-Data", `${successCount}/${totalCount} 쿼리 성공`);

  // 3. Claude API 호출
  logger.step("[3/4] Claude API 분석 요청...");
  const client = new Anthropic();
  const userPrompt = buildUserPrompt(data, today);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  const report = textBlocks.map((b) => b.text).join("\n");

  logger.info(
    "QA-LLM",
    `토큰: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`,
  );

  // 4. Discord 발송
  logger.step("[4/4] Discord 발송...");

  const score = extractScore(report);
  const ceoSummary = extractCeoSummary(report);
  const scoreLabel = score != null ? ` (${score})` : "";

  const discordSummary = [
    `🔍 **주간 QA & 전략 점검**${scoreLabel} — ${today}`,
    "",
    ceoSummary,
  ].join("\n");

  const webhookVar =
    process.env.DISCORD_DEBATE_WEBHOOK_URL
      ? "DISCORD_DEBATE_WEBHOOK_URL"
      : "DISCORD_WEBHOOK_URL";
  const webhookUrl = process.env[webhookVar];

  if (webhookUrl != null && webhookUrl !== "") {
    try {
      const gist = await createGist(
        `qa-weekly-${today}.md`,
        report,
        `주간 QA 점검 ${today}`,
      );
      const reportLink =
        gist != null ? `\n\n전체 리포트: ${gist.url}` : "";
      await sendDiscordMessage(
        sanitizeDiscordMentions(`${discordSummary}${reportLink}`),
        webhookVar,
      );
    } catch (err) {
      // Gist 링크 포함 메시지 발송 실패 시 요약만 재시도
      logger.warn("Discord", `Gist 포함 발송 실패: ${err instanceof Error ? err.message : String(err)}`);
      await sendDiscordMessage(
        sanitizeDiscordMentions(discordSummary),
        webhookVar,
      );
    }
  } else {
    logger.warn("Discord", "웹훅 미설정 — 로컬 로그만 기록");
  }

  logger.step("\n=== 주간 QA 점검 완료 ===");
}

main()
  .catch(async (err) => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("QA", `Fatal: ${errorMsg}`);
    await sendDiscordError(sanitizeErrorForDiscord(errorMsg));
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });

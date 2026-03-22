import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pool } from "@/db/client";
import { sendDiscordError } from "@/lib/discord";
import { logger } from "@/lib/logger";
import { ClaudeCliProvider } from "@/debate/llm/claudeCliProvider.js";
import { AnthropicProvider } from "@/debate/llm/anthropicProvider.js";
import { FallbackProvider } from "@/debate/llm/fallbackProvider.js";
import {
  queryWeeklyQaThesisWeekly,
  queryWeeklyQaThesisOverall,
  queryWeeklyQaRecommendations,
  queryWeeklyQaLearnings,
  queryWeeklyQaRecentReports,
  queryWeeklyQaVerificationMethods,
  queryWeeklyQaBiasMetrics,
  upsertWeeklyQaReport,
  type WeeklyQaThesisWeeklyRow,
  type WeeklyQaThesisOverallRow,
  type WeeklyQaRecommendationRow,
  type WeeklyQaLearningRow,
  type WeeklyQaReportLogRow,
  type WeeklyQaVerificationMethodRow,
  type WeeklyQaBiasMetricsRow,
} from "@/db/repositories/index.js";

import { CLAUDE_SONNET } from "@/lib/models.js";

const FALLBACK_MODEL = CLAUDE_SONNET;
const MAX_TOKENS = 4096;
const SCORE_THRESHOLD_FOR_ISSUE = 6;

// --- 데이터 수집 ---

interface CollectedData {
  thesisWeekly: WeeklyQaThesisWeeklyRow[] | null;
  thesisOverall: WeeklyQaThesisOverallRow[] | null;
  recommendations: WeeklyQaRecommendationRow[] | null;
  learnings: WeeklyQaLearningRow[] | null;
  recentReports: WeeklyQaReportLogRow[] | null;
  verificationMethods: WeeklyQaVerificationMethodRow[] | null;
  biasMetrics: WeeklyQaBiasMetricsRow[] | null;
}

async function queryOrNullFn<T>(
  label: string,
  fn: () => Promise<T[]>,
): Promise<T[] | null> {
  try {
    return await fn();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("QA-Data", `${label} 쿼리 실패: ${reason}`);
    return null;
  }
}

async function collectData(): Promise<CollectedData> {
  const [thesisWeekly, thesisOverall, recommendations, learnings, recentReports, verificationMethods, biasMetrics] =
    await Promise.all([
      queryOrNullFn("thesis_weekly", () => queryWeeklyQaThesisWeekly(pool)),
      queryOrNullFn("thesis_overall", () => queryWeeklyQaThesisOverall(pool)),
      queryOrNullFn("recommendations", () => queryWeeklyQaRecommendations(pool)),
      queryOrNullFn("learnings", () => queryWeeklyQaLearnings(pool)),
      queryOrNullFn("recent_reports", () => queryWeeklyQaRecentReports(pool)),
      queryOrNullFn("verification_methods", () => queryWeeklyQaVerificationMethods(pool)),
      queryOrNullFn("bias_metrics", () => queryWeeklyQaBiasMetrics(pool)),
    ]);

  return { thesisWeekly, thesisOverall, recommendations, learnings, recentReports, verificationMethods, biasMetrics };
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
    formatDataSection("2. Thesis 전체 적중률 (애널리스트별)", data.thesisOverall),
    formatDataSection("3. 추천 성과", data.recommendations),
    formatDataSection("4. 학습 원칙 현황", data.learnings),
    formatDataSection("5. 최근 리포트 로그", data.recentReports),
    formatDataSection("6. 검증 방식별 통계 (정량/LLM)", data.verificationMethods),
    formatDataSection("7. 학습 검증 경로 분포 (정량/LLM/혼합)", data.biasMetrics),
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

## 채점 기준 (10점 만점)

아래 항목별 배점에 따라 종합 점수를 산출하세요. 각 항목의 점수를 먼저 계산한 뒤 합산합니다.

| 항목 | 배점 | 기준 |
|------|------|------|
| 애널리스트 적중률 | 2점 | 전체 confirmed/(confirmed+invalidated) ≥ 50%: 2점, ≥ 30%: 1점, < 30%: 0점 |
| 추천 성과 | 2점 | 종료 추천 승률 ≥ 60%: 2점, ≥ 40%: 1점, < 40%: 0점 |
| 데이터 파이프라인 | 2점 | 7일 중 리포트 발행일 ≥ 5일: 2점, ≥ 3일: 1점, < 3일: 0점 |
| 골 달성도 (초입 포착) | 2점 | Phase 1 후기 또는 RS 30~60 종목이 추천에 포함: 2점, 언급만: 1점, 없음: 0점 |
| 편향 모니터링 | 2점 | bull-bias 미감지 + 정량 검증 비율 ≥ 50%: 2점, 하나만 충족: 1점, 둘 다 미충족: 0점 |

**감점 규칙** (위 합산 점수에서 차감):
- 학습 원칙 0개 활성: -1점
- 검증 방식 중 LLM 전용 비율 > 70%: -1점
- 추천 종목 중 Phase 이탈 2건 이상: -1점

최종 점수 = max(0, 합산 - 감점)

## 출력 형식

반드시 아래 형식으로 출력하세요. 데이터가 없는 섹션은 "데이터 부족으로 판단 보류"로 표시하세요.

\`\`\`
# 주간 QA & 전략 점검 (YYYY-MM-DD)

## 종합 점수: X/10 (항목별: 적중률 X + 추천 X + 파이프라인 X + 골달성 X + 편향 X - 감점 X)

## 1. 애널리스트 성과
- 애널리스트별 적중률 테이블 (confirmed / invalidated / expired / active / total)
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
- 검증 방식: 정량 자동 판정 N건 vs LLM 판정 N건 (일치율: 추후 추가)
- 학습 검증 경로: quantitative N개, llm N개, mixed N개 (정량 비율: X%)
- bull-bias 경고: 학습 원칙 중 상승 방향 편중 여부 체크

## 4. 골 달성 진척도
- 이번 주 리포트에 Phase 1 후기 종목이 포함되었는가?
- RS 30~60 범위 종목이 추천에 포함되었는가?
- 초입 포착이라는 골에 얼마나 부합하는가?
- **정량 기준** (이슈 #58 검증 결과):
  - Phase 1 후기 → Phase 2 전환율 기준: 41.9%
  - RS 상승 초기 전환율 기준: 20.3% (섹터 동반 상승 시 24.2%)
  - 펀더멘탈+Phase1 교집합 전환율 기준: 30.6%
  - **핵심 필터**: 섹터 RS 동반 상승이 가장 유의미한 필터
- **편향 모니터링**: 학습 원칙의 검증 경로(quantitative vs llm) 비율, bull-bias 여부

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
  const required = ["DATABASE_URL"];
  const missing = required.filter(
    (key) => process.env[key] == null || process.env[key] === "",
  );
  if (missing.length > 0) {
    throw new Error(`필수 환경변수 누락: ${missing.join(", ")}`);
  }
  // ANTHROPIC_API_KEY는 CLI 폴백 시에만 필요 — 미설정 시 경고만 출력
  if (process.env.ANTHROPIC_API_KEY == null || process.env.ANTHROPIC_API_KEY === "") {
    logger.warn("QA-Env", "ANTHROPIC_API_KEY 미설정 — Claude CLI 폴백 불가");
  }
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
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
 * 파싱 실패 시 null 반환.
 */
function extractScore(report: string): number | null {
  const match = report.match(/종합 점수:\s*(\d+)\/\d+/);
  if (match == null) {
    return null;
  }
  const parsed = parseInt(match[1], 10);
  if (isNaN(parsed) || parsed < 0 || parsed > 10) {
    return null;
  }
  return parsed;
}

/**
 * 의사결정 필요 여부 판단.
 * "의사결정 필요:" 항목이 "없음"이 아닌 내용을 포함하면 true.
 */
function extractNeedsDecision(report: string): boolean {
  const match = report.match(/의사결정 필요:\s*([^\n]+)/);
  if (match == null) {
    return false;
  }
  return match[1].trim().replace(/[.。]+$/, "") !== "없음";
}

/**
 * 주간 QA 결과를 weekly_qa_reports 테이블에 upsert.
 */
async function saveToDb(
  qaDate: string,
  report: string,
  tokensInput: number,
  tokensOutput: number,
): Promise<void> {
  const score = extractScore(report);
  const ceoSummary = extractCeoSummary(report);
  const needsDecision = extractNeedsDecision(report);

  await upsertWeeklyQaReport(
    {
      qaDate,
      score,
      fullReport: report,
      ceoSummary,
      needsDecision,
      tokensInput,
      tokensOutput,
    },
    pool,
  );

  logger.info("QA-DB", `저장 완료: qaDate=${qaDate} score=${score ?? "파싱실패"} needsDecision=${needsDecision}`);

  maybeCreateGithubIssue(qaDate, score, ceoSummary, needsDecision);
}

/**
 * score < 6 또는 needsDecision === true 시 GitHub 이슈 자동 생성.
 * gh CLI 실패 시 warn 로그만 남기고 전체 실행을 막지 않음.
 */
function maybeCreateGithubIssue(
  qaDate: string,
  score: number | null,
  ceoSummary: string,
  needsDecision: boolean,
): void {
  const isLowScore = score != null && score < SCORE_THRESHOLD_FOR_ISSUE;
  const shouldCreateIssue = isLowScore || needsDecision;

  if (shouldCreateIssue === false) {
    return;
  }

  const reason = isLowScore
    ? `종합 점수 ${score}/10 (기준 ${SCORE_THRESHOLD_FOR_ISSUE} 미만)`
    : "의사결정 필요 항목 감지";

  const issueTitle = `[주간 QA] ${qaDate} — ${reason}`;
  const issueBody = [
    `## 주간 QA 이상 감지`,
    ``,
    `- **날짜**: ${qaDate}`,
    `- **점수**: ${score != null ? `${score}/10` : "파싱 실패"}`,
    `- **의사결정 필요**: ${needsDecision ? "예" : "아니오"}`,
    ``,
    `## CEO 보고 요약`,
    ``,
    ceoSummary,
  ].join("\n");

  try {
    const result = spawnSync(
      "gh",
      ["issue", "create", "--title", issueTitle, "--body", issueBody, "--label", "report-feedback", "--label", "P2: medium"],
      { encoding: "utf-8" },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr ?? "gh CLI 실패");
    }
    logger.info("QA-Issue", `GitHub 이슈 생성 완료: ${issueTitle}`);
  } catch (err) {
    logger.warn("QA-Issue", `GitHub 이슈 생성 실패 (계속 진행): ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  logger.step("=== 주간 QA 점검 시작 ===\n");

  // 1. 환경변수 검증
  validateEnvironment();
  logger.step("[1/5] 환경변수 검증 완료");

  // 2. 데이터 수집
  logger.step("[2/5] 데이터 수집 중...");
  const today = getToday();
  const data = await collectData();

  const successCount = Object.values(data).filter((v) => v != null).length;
  const totalCount = Object.keys(data).length;
  logger.info("QA-Data", `${successCount}/${totalCount} 쿼리 성공`);

  // 3. LLM 호출 (CLI → SDK 폴백)
  logger.step("[3/5] LLM 분석 요청...");
  const cli = new ClaudeCliProvider();
  const hasApiKey = process.env.ANTHROPIC_API_KEY != null && process.env.ANTHROPIC_API_KEY !== "";
  const provider = hasApiKey
    ? new FallbackProvider(cli, new AnthropicProvider(FALLBACK_MODEL), "ClaudeCLI")
    : cli;
  const userPrompt = buildUserPrompt(data, today);

  const llmResult = await provider.call({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: userPrompt,
    maxTokens: MAX_TOKENS,
  });
  const report = llmResult.content;

  logger.info(
    "QA-LLM",
    `토큰: ${llmResult.tokensUsed.input} in / ${llmResult.tokensUsed.output} out`,
  );

  // 4. 리포트 파일 저장 (실패해도 DB 적재는 계속)
  logger.step("[4/5] 리포트 파일 저장...");
  try {
    const reportDir = join(process.cwd(), "data", "qa-reports");
    mkdirSync(reportDir, { recursive: true });
    const reportPath = join(reportDir, `${today}.md`);
    writeFileSync(reportPath, report, "utf-8");
    logger.info("QA-File", `저장: ${reportPath}`);
  } catch (err) {
    logger.warn("QA-File", `저장 실패 (DB 적재는 계속): ${err instanceof Error ? err.message : String(err)}`);
  }

  // 5. DB 적재 + (조건부) GitHub 이슈 생성
  logger.step("[5/5] DB 적재...");
  try {
    await saveToDb(
      today,
      report,
      llmResult.tokensUsed.input,
      llmResult.tokensUsed.output,
    );
    logger.info("QA", "[5/5] DB 적재 완료");
  } catch (dbError) {
    logger.error("QA", `[5/5] DB 적재 실패 — 파일 저장은 완료됨: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
    await sendDiscordError(`주간 QA DB 적재 실패: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
  }

  logger.step("\n=== 주간 QA 점검 완료 ===");
}

main()
  .catch(async (err) => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error("QA", `Fatal: ${errorMsg}`);
    await sendDiscordError(errorMsg);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });

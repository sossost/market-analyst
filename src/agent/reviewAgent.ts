import { sendDiscordFile, sendDiscordMessage } from "@/lib/discord";
import { createProvider } from "@/debate/llm/providerFactory.js";
import type { LLMProvider } from "@/debate/llm/types.js";
import { createGist } from "@/lib/gist";
import { logger } from "@/lib/logger";
import { saveReviewFeedback, type ReviewVerdict, type FeedbackReportType } from "@/lib/reviewFeedback";
import { SEND_DISCORD_REPORT_SCHEMA } from "@/tools/sendDiscordReport";
import type { AgentTool } from "@/tools/types";
import { buildHtmlReport } from "@/lib/htmlReport";
import { uploadHtmlReport } from "@/lib/storageUpload";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReportDraft {
  message: string;
  markdownContent?: string;
  filename?: string;
}

interface ReviewResult {
  verdict: ReviewVerdict;
  feedback: string;
  issues: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

import { CLAUDE_SONNET } from "@/lib/models.js";

const REVIEW_MODEL = CLAUDE_SONNET;
const REVIEW_MAX_TOKENS = 2048;
const REFINE_MAX_TOKENS = 8192;
const RAW_PREVIEW_LENGTH = 300;

const VALID_VERDICTS: ReadonlySet<string> = new Set(["OK", "REVISE", "REJECT"]);

/** 에이전트 루프 → 리뷰 파이프라인 사이 rate limit 방지 쿨다운 (ms) */
export const REVIEW_COOLDOWN_MS = 60_000;

const REVIEWER_SYSTEM_PROMPT = `당신은 경력 15년차 미국 주식 전문 투자자입니다.
시장 분석 리포트를 받으면 다음 관점에서 냉정하게 평가합니다:

1. **데이터 근거**: 주장이 제시된 데이터로 뒷받침되는가?
2. **리스크 누락**: 빠진 위험 요인은 없는가? (섹터 과열, 밸류에이션, 매크로 리스크)
3. **실행 가능성**: 제시된 종목에 실제 매수 근거가 구체적인가?
4. **편향 체크**: 불필요하게 낙관적이거나 비관적이지 않은가?
   - 추천 종목이 3건 이상인데 리스크 또는 주의 사항이 전혀 없으면 bull-bias로 판단하여 REVISE.
   - 리스크 언급은 "약세 섹션", "⚠️ 주의", "리스크" 중 하나 이상 포함 여부로 판단.
5. **정보 밀도**: 불필요한 장황함 없이 핵심만 전달하는가?
6. **수치 기준 명시**: 퍼센트 수치에 기간/기준이 명시되어 있는가? \`SYMBOL(+XX%)\` 형태로 기준 없이 표기된 수치가 있으면 REVISE로 판정하세요. 허용 형태: \`+XX%(일간)\`, \`+XX%(5일)\`, \`+XX%(20일)\`, \`52주 저점 대비 +XX%\`.

판정:
- OK: 발행 가능
- REVISE: 수정 필요 (구체적 수정사항 제시)
- REJECT: 재작성 필요 (심각한 문제)

반드시 아래 JSON 형식으로만 응답하세요. 코드 펜스 없이 순수 JSON만 출력하세요:
{"verdict":"OK|REVISE|REJECT","feedback":"...","issues":["..."]}`;

const REFINE_SYSTEM_PROMPT = `당신은 미국 주식 시장 분석 리포트 전문 에디터입니다.
원본 리포트와 리뷰어의 피드백을 받아 리포트를 수정합니다.

규칙:
- 리뷰어의 지적사항을 모두 반영하되, 기존 분석의 핵심은 유지합니다.
- 데이터 근거가 부족한 주장은 삭제하거나 완화합니다.
- 누락된 리스크 요인을 추가합니다.
- Discord 메시지는 2000자 이내를 유지합니다.
- 마크다운 리포트가 있다면 같이 수정합니다.
- **중요**: 마크다운 테이블은 반드시 각 행이 별도 줄에 있어야 합니다. JSON 문자열 안에서 줄바꿈은 \\n으로 표현하세요.

출력 형식:
각 draft에 대해 JSON 배열로 응답합니다. 코드 펜스 없이 순수 JSON만 출력하세요:
[{"message":"수정된 메시지","markdownContent":"수정된 마크다운","filename":"파일명"}]

markdownContent와 filename이 원본에 없었으면 해당 필드는 생략합니다.
markdownContent 안의 마크다운 테이블 예시:
"| 헤더1 | 헤더2 |\\n|------|------|\\n| 값1 | 값2 |"`;

const DATA_ONLY_SYSTEM_PROMPT = `당신은 미국 주식 시장 분석 리포트 에디터입니다.
원본 리포트에서 **팩트/데이터 기반 섹션만** 추출하고, 주관적 분석/의견 섹션은 제거합니다.

유지할 것 (팩트/데이터):
- 지수 수익률, 섹터 RS 점수, 시장 breadth 지표
- 종목별 가격, 거래량, 기술적 지표 수치
- Phase 판별 결과, 조건 충족 여부
- 표(table) 형태의 데이터 요약

제거할 것 (주관적 분석):
- 투자 의견, 매수/매도 추천
- 시장 전망, 방향성 예측
- 근거 없는 주장, 낙관/비관적 논조

Discord 메시지는 2000자 이내를 유지합니다.
제거된 섹션이 있으면 메시지 끝에 "⚠️ 리뷰어 판정에 따라 분석 섹션이 제외되었습니다." 를 추가합니다.
**중요**: 마크다운 테이블은 반드시 각 행이 별도 줄에 있어야 합니다. JSON 문자열 안에서 줄바꿈은 \\n으로 표현하세요.

출력 형식:
JSON 배열로 응답합니다. 코드 펜스 없이 순수 JSON만 출력하세요:
[{"message":"수정된 메시지","markdownContent":"수정된 마크다운","filename":"파일명"}]

markdownContent와 filename이 원본에 없었으면 해당 필드는 생략합니다.`;

// ---------------------------------------------------------------------------
// Shared provider (lazy singleton — 동일 파이프라인 내 재사용)
// ---------------------------------------------------------------------------

let _provider: LLMProvider | null = null;

function getReviewProvider(): LLMProvider {
  if (_provider == null) {
    _provider = createProvider(REVIEW_MODEL);
  }
  return _provider;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 중첩 괄호를 고려하여 opener에 대응하는 closer 위치를 찾는다.
 * JSON 문자열 리터럴 내의 괄호는 무시한다.
 * 찾지 못하면 -1 반환.
 */
function findMatchingClose(
  text: string,
  startIndex: number,
  opener: string,
  closer: string,
): number {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

/**
 * LLM 응답에서 JSON을 안전하게 추출한다.
 * 1. 코드 펜스 제거
 * 2. 첫 번째 { 또는 [ 부터 마지막 } 또는 ] 까지 추출
 * 3. 제어문자(탭 제외) 제거
 */
function extractJson(text: string): string {
  // 코드 펜스 제거
  let cleaned = text
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();

  // JSON 시작/끝 위치 찾기
  const candidates = [cleaned.indexOf("{"), cleaned.indexOf("[")].filter((i) => i !== -1);
  const start = candidates.length > 0 ? Math.min(...candidates) : -1;

  if (start === -1) return cleaned;

  const opener = cleaned[start];
  const closer = opener === "[" ? "]" : "}";
  const matchEnd = findMatchingClose(cleaned, start, opener, closer);

  if (matchEnd > start) {
    cleaned = cleaned.slice(start, matchEnd + 1);
  }

  // JSON 문자열 값 내의 이스케이프 안 된 제어문자 제거 (탭/줄바꿈 제외)
  // eslint-disable-next-line no-control-regex
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

  return cleaned;
}

// ---------------------------------------------------------------------------
// Draft → Full Content
// ---------------------------------------------------------------------------

/**
 * Combine report drafts into a single full_content string for DB storage.
 * Uses markdownContent when available, falls back to message.
 */
export function draftsToFullContent(drafts: ReportDraft[]): string {
  return drafts
    .map((d) => d.markdownContent ?? d.message)
    .join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Draft Capture Tool
// ---------------------------------------------------------------------------

/**
 * send_discord_report와 동일한 schema이지만 실제 발송 대신 배열에 저장한다.
 * 에이전트는 발송했다고 인식하지만, 실제로는 draft가 캡처된다.
 */
export function createDraftCaptureTool(drafts: ReportDraft[]): AgentTool {
  return {
    definition: SEND_DISCORD_REPORT_SCHEMA,

    async execute(input) {
      const message =
        typeof input.message === "string" && input.message.length > 0
          ? input.message
          : null;

      if (message == null) {
        return JSON.stringify({
          error: "메시지가 비어있거나 유효하지 않습니다",
        });
      }

      const markdownContent =
        typeof input.markdownContent === "string" &&
        input.markdownContent.length > 0
          ? input.markdownContent
          : undefined;

      const filename =
        typeof input.filename === "string" && input.filename.length > 0
          ? input.filename
          : undefined;

      drafts.push({ message, markdownContent, filename });
      logger.info("DraftCapture", `Draft #${drafts.length} captured`);

      return JSON.stringify({
        success: true,
        status: "draft_captured",
        messageLength: message.length,
        fileAttached: markdownContent != null,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

function escapeXmlTags(text: string): string {
  return text.replace(/<\/?(draft|message|detail)[^>]*>/g, "");
}

function buildDraftText(drafts: ReportDraft[]): string {
  return drafts
    .map((d, i) => {
      const msg = escapeXmlTags(d.message);
      const parts = [
        `<draft index="${i + 1}">`,
        `<message>\n${msg}\n</message>`,
      ];
      if (d.markdownContent != null) {
        parts.push(`<detail>\n${escapeXmlTags(d.markdownContent)}\n</detail>`);
      }
      parts.push("</draft>");
      return parts.join("\n");
    })
    .join("\n\n");
}

/**
 * 리포트 초안을 리뷰하고 판정 결과를 반환한다.
 * ClaudeCliProvider 우선, 폴백 시 AnthropicProvider 사용.
 * 파싱 실패 시 보수적으로 REVISE를 반환한다 (미검증 리포트 발송 방지).
 */
export async function reviewReport(
  drafts: ReportDraft[],
): Promise<ReviewResult> {
  const draftText = buildDraftText(drafts);

  const provider = getReviewProvider();
  const result = await provider.call({
    systemPrompt: REVIEWER_SYSTEM_PROMPT,
    userMessage: `아래 시장 분석 리포트를 리뷰해주세요.\n\n${draftText}`,
    maxTokens: REVIEW_MAX_TOKENS,
  });
  const raw = result.content;

  try {
    const jsonText = extractJson(raw);
    const parsed = JSON.parse(jsonText) as ReviewResult;

    if (!VALID_VERDICTS.has(parsed.verdict)) {
      throw new Error(`Invalid verdict: ${parsed.verdict}`);
    }

    return {
      verdict: parsed.verdict,
      feedback: typeof parsed.feedback === "string" ? parsed.feedback : "",
      issues: Array.isArray(parsed.issues)
        ? parsed.issues.filter((i): i is string => typeof i === "string")
        : [],
    };
  } catch {
    const rawPreview = raw.slice(0, RAW_PREVIEW_LENGTH);
    logger.error(
      "Review",
      `Failed to parse review response. Raw: ${rawPreview}`,
    );
    return {
      verdict: "REVISE",
      feedback:
        "리뷰 응답 파싱 실패. 원본 리포트의 리스크 언급 보강 및 과도한 낙관 표현을 완화해주세요.",
      issues: ["review_parse_error"],
    };
  }
}

// ---------------------------------------------------------------------------
// Refine
// ---------------------------------------------------------------------------

/**
 * 단일 draft를 리뷰 피드백 기반으로 수정한다.
 * 파싱 실패 시 원본 draft를 반환한다.
 */
async function refineSingleDraft(
  draft: ReportDraft,
  feedback: string,
): Promise<ReportDraft> {
  const draftText = buildDraftText([draft]);

  const provider = getReviewProvider();
  const result = await provider.call({
    systemPrompt: REFINE_SYSTEM_PROMPT,
    userMessage: `아래 리포트를 리뷰어 피드백에 따라 수정해주세요.

[원본 리포트]
${draftText}

[리뷰어 피드백]
${feedback}`,
    maxTokens: REFINE_MAX_TOKENS,
  });
  const raw = result.content;

  const jsonText = extractJson(raw);

  let parsed: ReportDraft | ReportDraft[];
  try {
    parsed = JSON.parse(jsonText) as ReportDraft | ReportDraft[];
  } catch (parseErr) {
    logger.error("Refine", `JSON parse failed. Raw (${raw.length} chars): ${raw.slice(0, RAW_PREVIEW_LENGTH)}`);
    throw parseErr;
  }

  // Claude가 배열 또는 단일 객체로 응답할 수 있음
  const item = Array.isArray(parsed) ? parsed[0] : parsed;

  if (item == null || typeof item.message !== "string") {
    throw new Error("Invalid refined draft structure");
  }

  return {
    message: item.message,
    markdownContent:
      typeof item.markdownContent === "string" ? item.markdownContent : undefined,
    filename:
      typeof item.filename === "string" ? item.filename : undefined,
  };
}

/**
 * 리뷰 피드백을 반영하여 리포트를 수정한다.
 * 각 draft를 독립적으로 refine하여 한 draft의 실패가 다른 draft에 영향을 주지 않는다.
 * 파싱 실패한 draft는 원본을 그대로 유지한다.
 */
export async function refineReport(
  drafts: ReportDraft[],
  feedback: string,
): Promise<ReportDraft[]> {
  if (drafts.length === 1) {
    try {
      const refined = await refineSingleDraft(drafts[0], feedback);
      return [refined];
    } catch {
      logger.error("Refine", "Failed to refine single draft. Falling back to original.");
      return drafts;
    }
  }

  const results = await Promise.allSettled(
    drafts.map((d) => refineSingleDraft(d, feedback)),
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") {
      return r.value;
    }
    logger.error("Refine", `Draft #${i + 1} refine failed: ${r.reason}. Keeping original.`);
    return drafts[i];
  });
}

// ---------------------------------------------------------------------------
// Extract Data Only (REJECT 용)
// ---------------------------------------------------------------------------

/**
 * 단일 draft에서 팩트/데이터 섹션만 추출한다.
 */
async function extractSingleDraftData(
  draft: ReportDraft,
): Promise<ReportDraft> {
  const draftText = buildDraftText([draft]);

  const provider = getReviewProvider();
  const result = await provider.call({
    systemPrompt: DATA_ONLY_SYSTEM_PROMPT,
    userMessage: `아래 리포트에서 팩트/데이터 섹션만 추출해주세요.\n\n${draftText}`,
    maxTokens: REFINE_MAX_TOKENS,
  });
  const raw = result.content;

  const jsonText = extractJson(raw);

  let parsed: ReportDraft | ReportDraft[];
  try {
    parsed = JSON.parse(jsonText) as ReportDraft | ReportDraft[];
  } catch (parseErr) {
    logger.error("ExtractData", `JSON parse failed. Raw (${raw.length} chars): ${raw.slice(0, RAW_PREVIEW_LENGTH)}`);
    throw parseErr;
  }

  const item = Array.isArray(parsed) ? parsed[0] : parsed;

  if (item == null || typeof item.message !== "string") {
    throw new Error("Invalid data-only draft structure");
  }

  return {
    message: item.message,
    markdownContent:
      typeof item.markdownContent === "string" ? item.markdownContent : undefined,
    filename:
      typeof item.filename === "string" ? item.filename : undefined,
  };
}

/**
 * 리포트에서 주관적 분석/의견을 제거하고 팩트/데이터 섹션만 추출한다.
 * REJECT 판정 시 사용. 각 draft를 독립 처리하여 실패 시 원본 유지.
 */
export async function extractDataOnly(
  drafts: ReportDraft[],
): Promise<ReportDraft[]> {
  if (drafts.length === 1) {
    try {
      const extracted = await extractSingleDraftData(drafts[0]);
      return [extracted];
    } catch {
      logger.error("ExtractData", "Failed to extract single draft. Falling back to original.");
      return drafts;
    }
  }

  const results = await Promise.allSettled(
    drafts.map((d) => extractSingleDraftData(d)),
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") {
      return r.value;
    }
    logger.error("ExtractData", `Draft #${i + 1} extraction failed: ${r.reason}. Keeping original.`);
    return drafts[i];
  });
}

// ---------------------------------------------------------------------------
// Send Drafts
// ---------------------------------------------------------------------------

/**
 * 최종 확정된 draft를 Discord로 발송한다.
 * date가 주어지면 HTML 변환 → Supabase Storage 업로드를 우선 시도한다.
 * Storage 업로드 실패 시 Gist fallback, Gist도 실패 시 파일 첨부로 내려간다.
 */
export async function sendDrafts(
  drafts: ReportDraft[],
  webhookEnvVar: string,
  date?: string,
): Promise<void> {
  const webhookUrl = process.env[webhookEnvVar];
  if (webhookUrl == null || webhookUrl === "") {
    logger.warn("SendDrafts", `${webhookEnvVar} not set, skipping`);
    return;
  }

  for (const draft of drafts) {
    const filename = draft.filename ?? "report.md";

    if (draft.markdownContent != null) {
      // Storage 업로드 시도 (date가 있을 때만)
      if (date != null) {
        const storageUrl = await tryUploadToStorage(
          draft.markdownContent,
          draft.message,
          date,
        );

        if (storageUrl != null) {
          const messageWithLink = `${draft.message}\n\n📊 상세 리포트: ${storageUrl}`;
          await sendDiscordMessage(messageWithLink, webhookEnvVar);
          continue;
        }
      }

      // Storage 실패 또는 date 없음 → Gist fallback
      const gistDescription = draft.message.slice(0, 200);
      const gist = await createGist(
        filename,
        draft.markdownContent,
        gistDescription,
      );

      if (gist != null) {
        const messageWithLink = `${draft.message}\n\n📄 상세 리포트: ${gist.url}`;
        await sendDiscordMessage(messageWithLink, webhookEnvVar);
      } else {
        await sendDiscordFile(
          webhookUrl,
          draft.message,
          filename,
          draft.markdownContent,
        );
      }
    } else {
      await sendDiscordMessage(draft.message, webhookEnvVar);
    }
  }

  logger.info("SendDrafts", `${drafts.length} draft(s) sent to Discord`);
}

/**
 * 마크다운을 HTML로 변환하여 Storage에 업로드한다.
 * 에러가 발생하면 null을 반환한다 — 절대 throw하지 않는다.
 */
async function tryUploadToStorage(
  markdownContent: string,
  draftMessage: string,
  date: string,
): Promise<string | null> {
  try {
    const title = draftMessage.split("\n")[0].slice(0, 100);
    const html = buildHtmlReport(markdownContent, title, date);
    return await uploadHtmlReport(html, date);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("SendDrafts", `HTML 변환/업로드 실패 — Gist fallback: ${reason}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Review Pipeline (orchestrator)
// ---------------------------------------------------------------------------

/**
 * Draft 배열을 리뷰하고, 필요시 수정한 뒤, Discord로 발송한다.
 * 최대 1회 리뷰 → 수정. 수정본은 추가 리뷰 없이 발송.
 */
export async function runReviewPipeline(
  drafts: ReportDraft[],
  webhookEnvVar: string,
  options?: { skipCooldown?: boolean; reportType?: FeedbackReportType; date?: string },
): Promise<ReportDraft[]> {
  if (drafts.length === 0) {
    logger.warn("ReviewPipeline", "No report drafts captured");
    return [];
  }

  logger.step("\n--- Review Pipeline ---");

  if (options?.skipCooldown !== true) {
    logger.info(
      "ReviewPipeline",
      `Waiting ${REVIEW_COOLDOWN_MS / 1_000}s for rate limit cooldown...`,
    );
    await sleep(REVIEW_COOLDOWN_MS);
  }

  let finalDrafts: ReportDraft[];

  try {
    const review = await reviewReport(drafts);
    logger.step(`Review verdict: ${review.verdict}`);

    if (review.issues.length > 0) {
      for (const issue of review.issues) {
        logger.info("Review", `Issue: ${issue}`);
      }
    }

    try {
      saveReviewFeedback({
        date: new Date().toISOString().slice(0, 10),
        verdict: review.verdict,
        feedback: review.feedback,
        issues: review.issues,
        reportType: options?.reportType,
      });
      logger.info("ReviewPipeline", `Review feedback saved (${review.verdict})`);
    } catch (saveErr) {
      logger.warn("ReviewPipeline", `Failed to save feedback: ${saveErr}`);
    }

    switch (review.verdict) {
      case "OK":
        finalDrafts = drafts;
        break;

      case "REVISE":
        finalDrafts = await refineReport(drafts, review.feedback);
        logger.info("ReviewPipeline", "Report refined, sending revised version");
        break;

      case "REJECT":
        logger.error(
          "ReviewPipeline",
          "Report REJECTED — extracting data-only sections",
        );
        finalDrafts = await extractDataOnly(drafts);
        break;

      default: {
        const _exhaustive: never = review.verdict;
        throw new Error(`Unhandled verdict: ${_exhaustive}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("ReviewPipeline", `Review failed (${msg}), sending originals`);
    finalDrafts = drafts;
  }

  await sendDrafts(finalDrafts, webhookEnvVar, options?.date);
  logger.step("--- Review Pipeline Complete ---\n");

  return finalDrafts;
}

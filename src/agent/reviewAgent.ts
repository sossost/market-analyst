import Anthropic from "@anthropic-ai/sdk";
import { sendDiscordFile, sendDiscordMessage } from "./discord";
import { createGist } from "./gist";
import { logger } from "./logger";
import { SEND_DISCORD_REPORT_SCHEMA } from "./tools/sendDiscordReport";
import type { AgentTool } from "./tools/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReportDraft {
  message: string;
  markdownContent?: string;
  filename?: string;
}

type ReviewVerdict = "OK" | "REVISE" | "REJECT";

interface ReviewResult {
  verdict: ReviewVerdict;
  feedback: string;
  issues: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REVIEW_MODEL = "claude-sonnet-4-20250514";
const REVIEW_MAX_TOKENS = 2048;
const REFINE_MAX_TOKENS = 8192;
const RAW_PREVIEW_LENGTH = 300;

const VALID_VERDICTS: ReadonlySet<string> = new Set(["OK", "REVISE", "REJECT"]);

const REVIEWER_SYSTEM_PROMPT = `당신은 경력 15년차 미국 주식 전문 투자자입니다.
시장 분석 리포트를 받으면 다음 관점에서 냉정하게 평가합니다:

1. **데이터 근거**: 주장이 제시된 데이터로 뒷받침되는가?
2. **리스크 누락**: 빠진 위험 요인은 없는가? (섹터 과열, 밸류에이션, 매크로 리스크)
3. **실행 가능성**: 제시된 종목에 실제 매수 근거가 구체적인가?
4. **편향 체크**: 불필요하게 낙관적이거나 비관적이지 않은가?
5. **정보 밀도**: 불필요한 장황함 없이 핵심만 전달하는가?

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

출력 형식:
각 draft에 대해 JSON 배열로 응답합니다. 코드 펜스 없이 순수 JSON만 출력하세요:
[{"message":"...","markdownContent":"...","filename":"..."}]

markdownContent와 filename이 원본에 없었으면 해당 필드는 생략합니다.`;

// ---------------------------------------------------------------------------
// Shared Anthropic client (module-level singleton)
// ---------------------------------------------------------------------------

const client = new Anthropic();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Claude가 markdown 코드 펜스로 감싼 JSON을 반환할 경우 벗겨낸다.
 */
function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
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

function buildDraftText(drafts: ReportDraft[]): string {
  return drafts
    .map((d, i) => {
      const parts = [
        `<draft index="${i + 1}">`,
        `<message>\n${d.message}\n</message>`,
      ];
      if (d.markdownContent != null) {
        parts.push(`<detail>\n${d.markdownContent}\n</detail>`);
      }
      parts.push("</draft>");
      return parts.join("\n");
    })
    .join("\n\n");
}

/**
 * 리포트 초안을 리뷰하고 판정 결과를 반환한다.
 * 단일 Claude API 호출 (Sonnet).
 * 파싱 실패 시 보수적으로 REVISE를 반환한다 (미검증 리포트 발송 방지).
 */
export async function reviewReport(
  drafts: ReportDraft[],
): Promise<ReviewResult> {
  const draftText = buildDraftText(drafts);

  const response = await client.messages.create({
    model: REVIEW_MODEL,
    max_tokens: REVIEW_MAX_TOKENS,
    system: REVIEWER_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `아래 시장 분석 리포트를 리뷰해주세요.\n\n${draftText}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock?.type === "text" ? textBlock.text : "";

  try {
    const jsonText = stripCodeFence(raw);
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
 * 리뷰 피드백을 반영하여 리포트를 수정한다.
 * 단일 Claude API 호출 (Sonnet).
 * 파싱 실패 시 원본을 그대로 반환한다 (로그에 raw 응답 기록).
 */
export async function refineReport(
  drafts: ReportDraft[],
  feedback: string,
): Promise<ReportDraft[]> {
  const draftText = buildDraftText(drafts);

  const response = await client.messages.create({
    model: REVIEW_MODEL,
    max_tokens: REFINE_MAX_TOKENS,
    system: REFINE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `아래 리포트를 리뷰어 피드백에 따라 수정해주세요.

[원본 리포트]
${draftText}

[리뷰어 피드백]
${feedback}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock?.type === "text" ? textBlock.text : "";

  try {
    const jsonText = stripCodeFence(raw);
    const parsed = JSON.parse(jsonText) as ReportDraft[];

    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("Empty or invalid response");
    }

    return parsed.map((d) => ({
      message: typeof d.message === "string" ? d.message : "",
      markdownContent:
        typeof d.markdownContent === "string" ? d.markdownContent : undefined,
      filename: typeof d.filename === "string" ? d.filename : undefined,
    }));
  } catch {
    const rawPreview = raw.slice(0, RAW_PREVIEW_LENGTH);
    logger.error(
      "Refine",
      `Failed to parse refined report. Raw: ${rawPreview}. Falling back to originals.`,
    );
    return drafts;
  }
}

// ---------------------------------------------------------------------------
// Send Drafts
// ---------------------------------------------------------------------------

/**
 * 최종 확정된 draft를 Discord로 발송한다.
 * 기존 discord.ts / gist.ts 를 재사용한다.
 */
export async function sendDrafts(
  drafts: ReportDraft[],
  webhookEnvVar: string,
): Promise<void> {
  const webhookUrl = process.env[webhookEnvVar];
  if (webhookUrl == null || webhookUrl === "") {
    logger.warn("SendDrafts", `${webhookEnvVar} not set, skipping`);
    return;
  }

  for (const draft of drafts) {
    const filename = draft.filename ?? "report.md";

    if (draft.markdownContent != null) {
      const gist = await createGist(
        filename,
        draft.markdownContent,
        filename,
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
): Promise<void> {
  if (drafts.length === 0) {
    logger.warn("ReviewPipeline", "No report drafts captured");
    return;
  }

  logger.step("\n--- Review Pipeline ---");

  const review = await reviewReport(drafts);
  logger.step(`Review verdict: ${review.verdict}`);

  if (review.issues.length > 0) {
    for (const issue of review.issues) {
      logger.info("Review", `Issue: ${issue}`);
    }
  }

  if (review.verdict === "REJECT") {
    logger.error(
      "ReviewPipeline",
      "Report REJECTED — attempting one refinement pass before send",
    );
  }

  const finalDrafts =
    review.verdict === "OK"
      ? drafts
      : await refineReport(drafts, review.feedback);

  if (review.verdict !== "OK") {
    logger.info(
      "ReviewPipeline",
      `Report refined (${review.verdict}), sending revised version`,
    );
  }

  await sendDrafts(finalDrafts, webhookEnvVar);
  logger.step("--- Review Pipeline Complete ---\n");
}

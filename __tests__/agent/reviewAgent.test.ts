import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReportDraft } from "@/agent/reviewAgent";

// ---------------------------------------------------------------------------
// Mock setup — must happen before any imports from the module under test
// ---------------------------------------------------------------------------

const mockCall = vi.fn();

vi.mock("@/debate/llm/providerFactory", () => ({
  createProvider: () => ({ call: mockCall }),
}));

const mockSendDiscordMessage = vi.fn();
const mockSendDiscordFile = vi.fn();

vi.mock("@/lib/discord", () => ({
  sendDiscordMessage: mockSendDiscordMessage,
  sendDiscordFile: mockSendDiscordFile,
}));

const mockCreateGist = vi.fn();

vi.mock("@/lib/gist", () => ({
  createGist: mockCreateGist,
}));

const mockBuildHtmlReport = vi.fn();
const mockPublishHtmlReport = vi.fn();

vi.mock("@/lib/htmlReport", () => ({
  buildHtmlReport: mockBuildHtmlReport,
}));

vi.mock("@/lib/reportPublisher", () => ({
  publishHtmlReport: mockPublishHtmlReport,
}));

const mockSaveReviewFeedback = vi.fn();

vi.mock("@/lib/reviewFeedback", () => ({
  saveReviewFeedback: mockSaveReviewFeedback,
}));

// Import after mocks are registered
const {
  createDraftCaptureTool,
  reviewReport,
  refineReport,
  extractDataOnly,
  sendDrafts,
  runReviewPipeline,
  REVIEW_COOLDOWN_MS,
} = await import("@/agent/reviewAgent");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDraft(overrides: Partial<ReportDraft> = {}): ReportDraft {
  return {
    message: "Daily market summary: Tech sector leads.",
    ...overrides,
  };
}

function makeLLMResult(text: string) {
  return {
    content: text,
    tokensUsed: { input: 100, output: 50 },
  };
}

// ---------------------------------------------------------------------------
// createDraftCaptureTool
// ---------------------------------------------------------------------------

describe("createDraftCaptureTool", () => {
  it("has the correct tool name matching the real send_discord_report", () => {
    const drafts: ReportDraft[] = [];
    const tool = createDraftCaptureTool(drafts);

    expect(tool.definition.name).toBe("send_discord_report");
  });

  it("requires 'message' as the only mandatory field in schema", () => {
    const tool = createDraftCaptureTool([]);

    expect(tool.definition.input_schema.required).toContain("message");
  });

  it("pushes a draft with message only to the array", async () => {
    const drafts: ReportDraft[] = [];
    const tool = createDraftCaptureTool(drafts);

    await tool.execute({ message: "Hello world" });

    expect(drafts).toHaveLength(1);
    expect(drafts[0].message).toBe("Hello world");
    expect(drafts[0].markdownContent).toBeUndefined();
    expect(drafts[0].filename).toBeUndefined();
  });

  it("pushes a draft with markdownContent and filename when provided", async () => {
    const drafts: ReportDraft[] = [];
    const tool = createDraftCaptureTool(drafts);

    await tool.execute({
      message: "Summary",
      markdownContent: "# Report\nDetails here",
      filename: "daily-2026-03-04.md",
    });

    expect(drafts).toHaveLength(1);
    expect(drafts[0].markdownContent).toBe("# Report\nDetails here");
    expect(drafts[0].filename).toBe("daily-2026-03-04.md");
  });

  it("returns success JSON with correct fields on valid input", async () => {
    const drafts: ReportDraft[] = [];
    const tool = createDraftCaptureTool(drafts);

    const result = await tool.execute({ message: "Test message" });
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.status).toBe("draft_captured");
    expect(parsed.messageLength).toBe("Test message".length);
    expect(parsed.fileAttached).toBe(false);
  });

  it("returns fileAttached: true when markdownContent is provided", async () => {
    const drafts: ReportDraft[] = [];
    const tool = createDraftCaptureTool(drafts);

    const result = await tool.execute({
      message: "Test",
      markdownContent: "# Content",
    });
    const parsed = JSON.parse(result);

    expect(parsed.fileAttached).toBe(true);
  });

  it("returns an error JSON when message is an empty string", async () => {
    const drafts: ReportDraft[] = [];
    const tool = createDraftCaptureTool(drafts);

    const result = await tool.execute({ message: "" });
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeDefined();
    expect(drafts).toHaveLength(0);
  });

  it("returns an error JSON when message is missing (undefined)", async () => {
    const drafts: ReportDraft[] = [];
    const tool = createDraftCaptureTool(drafts);

    const result = await tool.execute({});
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeDefined();
    expect(drafts).toHaveLength(0);
  });

  it("returns an error JSON when message is not a string", async () => {
    const drafts: ReportDraft[] = [];
    const tool = createDraftCaptureTool(drafts);

    const result = await tool.execute({ message: 12345 });
    const parsed = JSON.parse(result);

    expect(parsed.error).toBeDefined();
    expect(drafts).toHaveLength(0);
  });

  it("ignores empty markdownContent and does not attach it to the draft", async () => {
    const drafts: ReportDraft[] = [];
    const tool = createDraftCaptureTool(drafts);

    await tool.execute({ message: "Valid", markdownContent: "" });

    expect(drafts[0].markdownContent).toBeUndefined();
  });

  it("ignores empty filename and does not attach it to the draft", async () => {
    const drafts: ReportDraft[] = [];
    const tool = createDraftCaptureTool(drafts);

    await tool.execute({ message: "Valid", filename: "" });

    expect(drafts[0].filename).toBeUndefined();
  });

  it("accumulates multiple drafts across successive calls", async () => {
    const drafts: ReportDraft[] = [];
    const tool = createDraftCaptureTool(drafts);

    await tool.execute({ message: "Draft one" });
    await tool.execute({ message: "Draft two" });
    await tool.execute({ message: "Draft three" });

    expect(drafts).toHaveLength(3);
    expect(drafts[1].message).toBe("Draft two");
  });
});

// ---------------------------------------------------------------------------
// reviewReport
// ---------------------------------------------------------------------------

describe("reviewReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns OK verdict when provider responds with valid OK JSON", async () => {
    const reviewJson = JSON.stringify({
      verdict: "OK",
      feedback: "Report is well structured.",
      issues: [],
    });
    mockCall.mockResolvedValueOnce(makeLLMResult(reviewJson));

    const result = await reviewReport([makeDraft()]);

    expect(result.verdict).toBe("OK");
    expect(result.feedback).toBe("Report is well structured.");
    expect(result.issues).toEqual([]);
  });

  it("returns REVISE verdict with feedback and issues", async () => {
    const reviewJson = JSON.stringify({
      verdict: "REVISE",
      feedback: "Missing risk section.",
      issues: ["No macro risk mentioned", "Valuation unclear"],
    });
    mockCall.mockResolvedValueOnce(makeLLMResult(reviewJson));

    const result = await reviewReport([makeDraft()]);

    expect(result.verdict).toBe("REVISE");
    expect(result.feedback).toBe("Missing risk section.");
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toBe("No macro risk mentioned");
  });

  it("returns REJECT verdict with issues", async () => {
    const reviewJson = JSON.stringify({
      verdict: "REJECT",
      feedback: "Report is fundamentally flawed.",
      issues: ["No data backing claims", "Misleading conclusions"],
    });
    mockCall.mockResolvedValueOnce(makeLLMResult(reviewJson));

    const result = await reviewReport([makeDraft()]);

    expect(result.verdict).toBe("REJECT");
    expect(result.issues).toHaveLength(2);
  });

  it("defaults to REVISE when provider returns malformed JSON", async () => {
    mockCall.mockResolvedValueOnce(makeLLMResult("not valid json at all"));

    const result = await reviewReport([makeDraft()]);

    expect(result.verdict).toBe("REVISE");
    expect(result.issues).toContain("review_parse_error");
  });

  it("defaults to REVISE when the JSON has an invalid verdict value", async () => {
    const badJson = JSON.stringify({ verdict: "MAYBE", feedback: "?", issues: [] });
    mockCall.mockResolvedValueOnce(makeLLMResult(badJson));

    const result = await reviewReport([makeDraft()]);

    expect(result.verdict).toBe("REVISE");
  });

  it("defaults to REVISE when provider returns an empty string", async () => {
    mockCall.mockResolvedValueOnce(makeLLMResult(""));

    const result = await reviewReport([makeDraft()]);

    expect(result.verdict).toBe("REVISE");
  });

  it("filters non-string values out of the issues array", async () => {
    const reviewJson = JSON.stringify({
      verdict: "REVISE",
      feedback: "Some issues.",
      issues: ["Valid issue", 42, null, "Another valid issue"],
    });
    mockCall.mockResolvedValueOnce(makeLLMResult(reviewJson));

    const result = await reviewReport([makeDraft()]);

    expect(result.issues).toEqual(["Valid issue", "Another valid issue"]);
  });

  it("coerces missing feedback to empty string", async () => {
    const reviewJson = JSON.stringify({ verdict: "OK", issues: [] });
    mockCall.mockResolvedValueOnce(makeLLMResult(reviewJson));

    const result = await reviewReport([makeDraft()]);

    expect(result.feedback).toBe("");
  });

  it("coerces missing issues to empty array", async () => {
    const reviewJson = JSON.stringify({ verdict: "OK", feedback: "Good." });
    mockCall.mockResolvedValueOnce(makeLLMResult(reviewJson));

    const result = await reviewReport([makeDraft()]);

    expect(result.issues).toEqual([]);
  });

  it("calls the provider with the reviewer system prompt", async () => {
    mockCall.mockResolvedValueOnce(
      makeLLMResult(JSON.stringify({ verdict: "OK", feedback: "", issues: [] })),
    );

    await reviewReport([makeDraft()]);

    const call = mockCall.mock.calls[0][0];
    expect(call.systemPrompt).toContain("수치 기준 명시");
    expect(call.systemPrompt).toContain("SYMBOL(+XX%)");
    expect(call.systemPrompt).toContain("+XX%(일간)");
    expect(call.systemPrompt).toContain("+XX%(5일)");
    expect(call.systemPrompt).toContain("+XX%(20일)");
    expect(call.systemPrompt).toContain("52주 저점 대비 +XX%");
  });

  it("includes all draft messages in the user message sent to provider", async () => {
    mockCall.mockResolvedValueOnce(
      makeLLMResult(JSON.stringify({ verdict: "OK", feedback: "", issues: [] })),
    );

    const drafts = [
      makeDraft({ message: "First draft content" }),
      makeDraft({ message: "Second draft content" }),
    ];

    await reviewReport(drafts);

    const call = mockCall.mock.calls[0][0];
    expect(call.userMessage).toContain("First draft content");
    expect(call.userMessage).toContain("Second draft content");
  });
});

// ---------------------------------------------------------------------------
// refineReport
// ---------------------------------------------------------------------------

describe("refineReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns refined drafts parsed from provider's JSON response", async () => {
    const refined: ReportDraft[] = [
      { message: "Refined summary", markdownContent: "# Refined", filename: "daily.md" },
    ];
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(refined)));

    const result = await refineReport([makeDraft()], "Add risk section.");

    expect(result).toHaveLength(1);
    expect(result[0].message).toBe("Refined summary");
    expect(result[0].markdownContent).toBe("# Refined");
    expect(result[0].filename).toBe("daily.md");
  });

  it("falls back to original drafts when provider returns malformed JSON", async () => {
    const originals = [makeDraft({ message: "Original content" })];
    mockCall.mockResolvedValueOnce(makeLLMResult("not json"));

    const result = await refineReport(originals, "Some feedback.");

    expect(result).toEqual(originals);
  });

  it("falls back to original drafts when provider returns an empty array", async () => {
    const originals = [makeDraft()];
    mockCall.mockResolvedValueOnce(makeLLMResult("[]"));

    const result = await refineReport(originals, "feedback");

    expect(result).toEqual(originals);
  });

  it("accepts a single-object JSON response (not wrapped in array)", async () => {
    mockCall.mockResolvedValueOnce(
      makeLLMResult(JSON.stringify({ message: "refined message" })),
    );

    const result = await refineReport([makeDraft()], "feedback");

    expect(result[0].message).toBe("refined message");
  });

  it("coerces missing markdownContent to undefined in refined draft", async () => {
    const refined = [{ message: "Refined without markdown" }];
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(refined)));

    const result = await refineReport([makeDraft()], "feedback");

    expect(result[0].markdownContent).toBeUndefined();
  });

  it("coerces missing filename to undefined in refined draft", async () => {
    const refined = [{ message: "Refined", markdownContent: "# Content" }];
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(refined)));

    const result = await refineReport([makeDraft()], "feedback");

    expect(result[0].filename).toBeUndefined();
  });

  it("falls back to original when message is not a string", async () => {
    const originals = [makeDraft({ message: "Original" })];
    mockCall.mockResolvedValueOnce(
      makeLLMResult(JSON.stringify([{ message: null }])),
    );

    const result = await refineReport(originals, "feedback");

    expect(result[0].message).toBe("Original");
  });

  it("calls the provider with the refine system prompt", async () => {
    const refined = [makeDraft({ message: "Refined" })];
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(refined)));

    await refineReport([makeDraft()], "Feedback here.");

    const call = mockCall.mock.calls[0][0];
    expect(call.systemPrompt).toContain("리뷰어의 지적사항");
  });

  it("includes the feedback in the user message sent to provider", async () => {
    const refined = [makeDraft({ message: "Refined" })];
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(refined)));

    await refineReport([makeDraft()], "Add macro risk analysis.");

    const call = mockCall.mock.calls[0][0];
    expect(call.userMessage).toContain("Add macro risk analysis.");
  });
});

// ---------------------------------------------------------------------------
// extractDataOnly
// ---------------------------------------------------------------------------

describe("extractDataOnly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns data-only drafts parsed from provider's JSON response", async () => {
    const dataOnly: ReportDraft[] = [
      { message: "S&P 500 +1.2% ⚠️ 리뷰어 판정에 따라 분석 섹션이 제외되었습니다." },
    ];
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(dataOnly)));

    const result = await extractDataOnly([makeDraft()]);

    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("S&P 500");
  });

  it("falls back to original drafts when provider returns malformed JSON", async () => {
    const originals = [makeDraft({ message: "Original with opinions" })];
    mockCall.mockResolvedValueOnce(makeLLMResult("not json"));

    const result = await extractDataOnly(originals);

    expect(result).toEqual(originals);
  });

  it("uses the DATA_ONLY system prompt (not REFINE)", async () => {
    const dataOnly: ReportDraft[] = [{ message: "Data only" }];
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(dataOnly)));

    await extractDataOnly([makeDraft()]);

    const call = mockCall.mock.calls[0][0];
    expect(call.systemPrompt).toContain("팩트/데이터 기반 섹션만");
    expect(call.systemPrompt).not.toContain("리뷰어의 지적사항");
  });
});

// ---------------------------------------------------------------------------
// sendDrafts
// ---------------------------------------------------------------------------

describe("sendDrafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TEST_WEBHOOK;
    delete process.env.GITHUB_TOKEN;
    mockBuildHtmlReport.mockReturnValue("<html>report</html>");
    mockPublishHtmlReport.mockResolvedValue(null);
  });

  it("does nothing when the webhook env var is not set", async () => {
    await sendDrafts([makeDraft()], "TEST_WEBHOOK");

    expect(mockSendDiscordMessage).not.toHaveBeenCalled();
    expect(mockSendDiscordFile).not.toHaveBeenCalled();
    expect(mockCreateGist).not.toHaveBeenCalled();
  });

  it("sends a simple message draft via sendDiscordMessage when no markdown", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";

    await sendDrafts([makeDraft({ message: "Simple message" })], "TEST_WEBHOOK");

    expect(mockSendDiscordMessage).toHaveBeenCalledWith(
      "Simple message",
      "TEST_WEBHOOK",
    );
    expect(mockCreateGist).not.toHaveBeenCalled();
  });

  it("creates a gist and appends its URL to the message when markdown is present", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";
    mockCreateGist.mockResolvedValueOnce({
      url: "https://gist.github.com/abc123",
      id: "abc123",
    });

    await sendDrafts(
      [makeDraft({ message: "Summary", markdownContent: "# Details", filename: "daily.md" })],
      "TEST_WEBHOOK",
    );

    expect(mockCreateGist).toHaveBeenCalledWith("daily.md", "# Details", "Summary");
    expect(mockSendDiscordMessage).toHaveBeenCalledWith(
      expect.stringContaining("https://gist.github.com/abc123"),
      "TEST_WEBHOOK",
    );
  });

  it("falls back to sendDiscordFile when gist creation returns null", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";
    mockCreateGist.mockResolvedValueOnce(null);

    await sendDrafts(
      [makeDraft({ message: "Summary", markdownContent: "# Details", filename: "daily.md" })],
      "TEST_WEBHOOK",
    );

    expect(mockSendDiscordFile).toHaveBeenCalledWith(
      "https://discord.test/webhook",
      "Summary",
      "daily.md",
      "# Details",
    );
    expect(mockSendDiscordMessage).not.toHaveBeenCalled();
  });

  it("uses 'report.md' as default filename when draft has no filename", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";
    mockCreateGist.mockResolvedValueOnce(null);

    await sendDrafts(
      [makeDraft({ message: "Msg", markdownContent: "# Content" })],
      "TEST_WEBHOOK",
    );

    expect(mockSendDiscordFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "report.md",
      expect.any(String),
    );
  });

  it("sends multiple drafts in order", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";

    const drafts = [
      makeDraft({ message: "First" }),
      makeDraft({ message: "Second" }),
    ];

    await sendDrafts(drafts, "TEST_WEBHOOK");

    expect(mockSendDiscordMessage).toHaveBeenCalledTimes(2);
    expect(mockSendDiscordMessage.mock.calls[0][0]).toBe("First");
    expect(mockSendDiscordMessage.mock.calls[1][0]).toBe("Second");
  });

  it("does not send anything when drafts array is empty", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";

    await sendDrafts([], "TEST_WEBHOOK");

    expect(mockSendDiscordMessage).not.toHaveBeenCalled();
    expect(mockSendDiscordFile).not.toHaveBeenCalled();
  });

  it("uploads HTML and sends GitHub Pages URL when date is provided and publish succeeds", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";
    mockBuildHtmlReport.mockReturnValue("<html>full report</html>");
    mockPublishHtmlReport.mockResolvedValue("https://sossost.github.io/market-reports/daily/2026-04-03/");

    await sendDrafts(
      [makeDraft({ message: "Summary line", markdownContent: "# Report\nDetails", filename: "daily.md" })],
      "TEST_WEBHOOK",
      "2026-04-03",
    );

    expect(mockBuildHtmlReport).toHaveBeenCalledWith(
      "# Report\nDetails",
      "Summary line",
      "2026-04-03",
    );
    expect(mockPublishHtmlReport).toHaveBeenCalledWith("<html>full report</html>", "2026-04-03");
    expect(mockSendDiscordMessage).toHaveBeenCalledWith(
      expect.stringContaining("https://sossost.github.io/market-reports/daily/2026-04-03/"),
      "TEST_WEBHOOK",
    );
    expect(mockSendDiscordMessage.mock.calls[0][0]).toContain("📊 상세 리포트:");
    expect(mockCreateGist).not.toHaveBeenCalled();
  });

  it("falls back to Gist when publish returns null", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";
    mockPublishHtmlReport.mockResolvedValue(null);
    mockCreateGist.mockResolvedValue({ url: "https://gist.github.com/fallback", id: "xyz" });

    await sendDrafts(
      [makeDraft({ message: "Summary", markdownContent: "# Report", filename: "daily.md" })],
      "TEST_WEBHOOK",
      "2026-04-03",
    );

    expect(mockCreateGist).toHaveBeenCalledWith("daily.md", "# Report", "Summary");
    expect(mockSendDiscordMessage).toHaveBeenCalledWith(
      expect.stringContaining("https://gist.github.com/fallback"),
      "TEST_WEBHOOK",
    );
    expect(mockSendDiscordMessage.mock.calls[0][0]).toContain("📄 상세 리포트:");
  });

  it("falls back to Gist when buildHtmlReport throws", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";
    mockBuildHtmlReport.mockImplementation(() => { throw new Error("marked parse error"); });
    mockCreateGist.mockResolvedValue({ url: "https://gist.github.com/error-fallback", id: "abc" });

    await sendDrafts(
      [makeDraft({ message: "Summary", markdownContent: "# Report" })],
      "TEST_WEBHOOK",
      "2026-04-03",
    );

    expect(mockCreateGist).toHaveBeenCalled();
    expect(mockSendDiscordMessage).toHaveBeenCalledWith(
      expect.stringContaining("https://gist.github.com/error-fallback"),
      "TEST_WEBHOOK",
    );
  });

  it("skips Storage upload and goes straight to Gist when date is not provided", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";
    mockCreateGist.mockResolvedValue({ url: "https://gist.github.com/no-date", id: "def" });

    await sendDrafts(
      [makeDraft({ message: "Summary", markdownContent: "# Report" })],
      "TEST_WEBHOOK",
    );

    expect(mockBuildHtmlReport).not.toHaveBeenCalled();
    expect(mockPublishHtmlReport).not.toHaveBeenCalled();
    expect(mockCreateGist).toHaveBeenCalled();
  });

  it("uses only first line of draft message as HTML title", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";
    mockPublishHtmlReport.mockResolvedValue("https://sossost.github.io/market-reports/daily/2026-04-03/");

    const multilineMessage = "First line title\nSecond line\nThird line";
    await sendDrafts(
      [makeDraft({ message: multilineMessage, markdownContent: "# Report" })],
      "TEST_WEBHOOK",
      "2026-04-03",
    );

    expect(mockBuildHtmlReport).toHaveBeenCalledWith(
      "# Report",
      "First line title",
      "2026-04-03",
    );
  });
});

// ---------------------------------------------------------------------------
// runReviewPipeline
// ---------------------------------------------------------------------------

describe("runReviewPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.TEST_WEBHOOK;
  });

  it("does nothing and skips review when drafts array is empty", async () => {
    await runReviewPipeline([], "TEST_WEBHOOK", { skipCooldown: true });

    expect(mockCall).not.toHaveBeenCalled();
    expect(mockSendDiscordMessage).not.toHaveBeenCalled();
  });

  it("sends original drafts directly when review verdict is OK", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";
    mockCall.mockResolvedValueOnce(
      makeLLMResult(
        JSON.stringify({ verdict: "OK", feedback: "", issues: [] }),
      ),
    );

    await runReviewPipeline([makeDraft({ message: "Original" })], "TEST_WEBHOOK", { skipCooldown: true });

    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(mockSendDiscordMessage).toHaveBeenCalledWith("Original", "TEST_WEBHOOK");
  });

  it("refines drafts and sends refined version when verdict is REVISE", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";

    mockCall.mockResolvedValueOnce(
      makeLLMResult(
        JSON.stringify({ verdict: "REVISE", feedback: "Add risks.", issues: ["Missing risk"] }),
      ),
    );

    const refined = { message: "Refined with risks added" };
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(refined)));

    await runReviewPipeline([makeDraft()], "TEST_WEBHOOK", { skipCooldown: true });

    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(mockSendDiscordMessage).toHaveBeenCalledWith(
      "Refined with risks added",
      "TEST_WEBHOOK",
    );
  });

  it("extracts data-only sections when verdict is REJECT", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";

    mockCall.mockResolvedValueOnce(
      makeLLMResult(
        JSON.stringify({
          verdict: "REJECT",
          feedback: "Completely rewrite.",
          issues: ["No data", "Wrong conclusions"],
        }),
      ),
    );

    const dataOnly = { message: "S&P 500 +1.2%, NASDAQ +0.8% ⚠️ 리뷰어 판정에 따라 분석 섹션이 제외되었습니다." };
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(dataOnly)));

    await runReviewPipeline([makeDraft()], "TEST_WEBHOOK", { skipCooldown: true });

    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(mockSendDiscordMessage).toHaveBeenCalledWith(
      expect.stringContaining("분석 섹션이 제외되었습니다"),
      "TEST_WEBHOOK",
    );
  });

  it("sends refined drafts (not originals) after REVISE", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";

    mockCall.mockResolvedValueOnce(
      makeLLMResult(
        JSON.stringify({ verdict: "REVISE", feedback: "Improve clarity.", issues: [] }),
      ),
    );

    const refined = { message: "Improved clarity version" };
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(refined)));

    await runReviewPipeline(
      [makeDraft({ message: "Original uncleated draft" })],
      "TEST_WEBHOOK",
      { skipCooldown: true },
    );

    const sentMessage = mockSendDiscordMessage.mock.calls[0][0];
    expect(sentMessage).toBe("Improved clarity version");
    expect(sentMessage).not.toBe("Original uncleated draft");
  });

  it("calls refineReport when review parse fails (conservative REVISE fallback)", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";

    mockCall.mockResolvedValueOnce(makeLLMResult("invalid json"));

    const refined = { message: "Conservatively refined" };
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(refined)));

    await runReviewPipeline([makeDraft({ message: "Original" })], "TEST_WEBHOOK", { skipCooldown: true });

    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(mockSendDiscordMessage).toHaveBeenCalledWith(
      "Conservatively refined",
      "TEST_WEBHOOK",
    );
  });

  it("still sends drafts even when webhook env var is not set", async () => {
    mockCall.mockResolvedValueOnce(
      makeLLMResult(
        JSON.stringify({ verdict: "OK", feedback: "", issues: [] }),
      ),
    );

    const result = await runReviewPipeline([makeDraft()], "TEST_WEBHOOK", { skipCooldown: true });

    expect(result).toHaveLength(1);
    expect(mockSendDiscordMessage).not.toHaveBeenCalled();
  });

  it("saves feedback when verdict is REVISE", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";

    mockCall.mockResolvedValueOnce(
      makeLLMResult(
        JSON.stringify({ verdict: "REVISE", feedback: "Add risks.", issues: ["Missing risk"] }),
      ),
    );

    const refined = { message: "Refined" };
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(refined)));

    await runReviewPipeline([makeDraft()], "TEST_WEBHOOK", { skipCooldown: true });

    expect(mockSaveReviewFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: "REVISE",
        feedback: "Add risks.",
        issues: ["Missing risk"],
      }),
    );
  });

  it("saves feedback when verdict is REJECT", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";

    mockCall.mockResolvedValueOnce(
      makeLLMResult(
        JSON.stringify({ verdict: "REJECT", feedback: "Bad report.", issues: ["No data"] }),
      ),
    );

    const dataOnly = { message: "Data only" };
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(dataOnly)));

    await runReviewPipeline([makeDraft()], "TEST_WEBHOOK", { skipCooldown: true });

    expect(mockSaveReviewFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: "REJECT" }),
    );
  });

  it("saves feedback when verdict is OK (all verdicts saved)", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";

    mockCall.mockResolvedValueOnce(
      makeLLMResult(
        JSON.stringify({ verdict: "OK", feedback: "Good report", issues: [] }),
      ),
    );

    await runReviewPipeline([makeDraft()], "TEST_WEBHOOK", { skipCooldown: true });

    expect(mockSaveReviewFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: "OK" }),
    );
  });

  it("passes reportType to saveReviewFeedback when provided", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";

    mockCall.mockResolvedValueOnce(
      makeLLMResult(
        JSON.stringify({ verdict: "OK", feedback: "", issues: [] }),
      ),
    );

    await runReviewPipeline([makeDraft()], "TEST_WEBHOOK", { skipCooldown: true, reportType: "daily" });

    expect(mockSaveReviewFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ reportType: "daily" }),
    );
  });

  it("exports REVIEW_COOLDOWN_MS as 60 seconds", () => {
    expect(REVIEW_COOLDOWN_MS).toBe(60_000);
  });

  it("sends original drafts when the provider call throws", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";
    mockCall.mockRejectedValueOnce(new Error("Network timeout"));

    await runReviewPipeline(
      [makeDraft({ message: "Original" })],
      "TEST_WEBHOOK",
      { skipCooldown: true },
    );

    expect(mockSendDiscordMessage).toHaveBeenCalledWith("Original", "TEST_WEBHOOK");
  });
});

// ---------------------------------------------------------------------------
// refineReport — multi-draft individual processing
// ---------------------------------------------------------------------------

describe("refineReport (multi-draft)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refines multiple drafts independently via separate provider calls", async () => {
    const refined1 = { message: "Refined draft 1" };
    const refined2 = { message: "Refined draft 2" };
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(refined1)));
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(refined2)));

    const originals = [
      makeDraft({ message: "Original 1" }),
      makeDraft({ message: "Original 2" }),
    ];

    const result = await refineReport(originals, "Add risks.");

    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
    expect(result[0].message).toBe("Refined draft 1");
    expect(result[1].message).toBe("Refined draft 2");
  });

  it("keeps original draft when one draft fails to refine", async () => {
    const refined1 = { message: "Refined draft 1" };
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(refined1)));
    mockCall.mockResolvedValueOnce(makeLLMResult("invalid json"));

    const originals = [
      makeDraft({ message: "Original 1" }),
      makeDraft({ message: "Original 2" }),
    ];

    const result = await refineReport(originals, "feedback");

    expect(result[0].message).toBe("Refined draft 1");
    expect(result[1].message).toBe("Original 2");
  });

  it("handles single draft without Promise.allSettled", async () => {
    const refined = { message: "Single refined" };
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(refined)));

    const result = await refineReport([makeDraft()], "feedback");

    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(result[0].message).toBe("Single refined");
  });

  it("handles provider response as array for single draft", async () => {
    const refined = [{ message: "Refined in array" }];
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(refined)));

    const result = await refineReport([makeDraft()], "feedback");

    expect(result[0].message).toBe("Refined in array");
  });
});

// ---------------------------------------------------------------------------
// extractDataOnly — multi-draft individual processing
// ---------------------------------------------------------------------------

describe("extractDataOnly (multi-draft)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts data from multiple drafts independently", async () => {
    const data1 = { message: "Data only 1" };
    const data2 = { message: "Data only 2" };
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(data1)));
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(data2)));

    const originals = [
      makeDraft({ message: "Original 1" }),
      makeDraft({ message: "Original 2" }),
    ];

    const result = await extractDataOnly(originals);

    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(result[0].message).toBe("Data only 1");
    expect(result[1].message).toBe("Data only 2");
  });

  it("keeps original when one draft extraction fails", async () => {
    const data1 = { message: "Data only 1" };
    mockCall.mockResolvedValueOnce(makeLLMResult(JSON.stringify(data1)));
    mockCall.mockResolvedValueOnce(makeLLMResult("broken"));

    const originals = [
      makeDraft({ message: "Original 1" }),
      makeDraft({ message: "Original 2" }),
    ];

    const result = await extractDataOnly(originals);

    expect(result[0].message).toBe("Data only 1");
    expect(result[1].message).toBe("Original 2");
  });
});

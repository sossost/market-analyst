import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReportDraft } from "@/agent/reviewAgent";

// ---------------------------------------------------------------------------
// Mock setup — must happen before any imports from the module under test
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

const mockSendDiscordMessage = vi.fn();
const mockSendDiscordFile = vi.fn();

vi.mock("@/agent/discord", () => ({
  sendDiscordMessage: mockSendDiscordMessage,
  sendDiscordFile: mockSendDiscordFile,
}));

const mockCreateGist = vi.fn();

vi.mock("@/agent/gist", () => ({
  createGist: mockCreateGist,
}));

// Import after mocks are registered
const {
  createDraftCaptureTool,
  reviewReport,
  refineReport,
  sendDrafts,
  runReviewPipeline,
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

function makeTextResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50 },
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

  it("returns OK verdict when Claude responds with valid OK JSON", async () => {
    const reviewJson = JSON.stringify({
      verdict: "OK",
      feedback: "Report is well structured.",
      issues: [],
    });
    mockCreate.mockResolvedValueOnce(makeTextResponse(reviewJson));

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
    mockCreate.mockResolvedValueOnce(makeTextResponse(reviewJson));

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
    mockCreate.mockResolvedValueOnce(makeTextResponse(reviewJson));

    const result = await reviewReport([makeDraft()]);

    expect(result.verdict).toBe("REJECT");
    expect(result.issues).toHaveLength(2);
  });

  it("defaults to REVISE when Claude returns malformed JSON", async () => {
    mockCreate.mockResolvedValueOnce(makeTextResponse("not valid json at all"));

    const result = await reviewReport([makeDraft()]);

    expect(result.verdict).toBe("REVISE");
    expect(result.issues).toContain("review_parse_error");
  });

  it("defaults to REVISE when the JSON has an invalid verdict value", async () => {
    const badJson = JSON.stringify({ verdict: "MAYBE", feedback: "?", issues: [] });
    mockCreate.mockResolvedValueOnce(makeTextResponse(badJson));

    const result = await reviewReport([makeDraft()]);

    expect(result.verdict).toBe("REVISE");
  });

  it("defaults to REVISE when Claude returns an empty text block", async () => {
    mockCreate.mockResolvedValueOnce(makeTextResponse(""));

    const result = await reviewReport([makeDraft()]);

    expect(result.verdict).toBe("REVISE");
  });

  it("defaults to REVISE when Claude response has no text content block", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 0 },
    });

    const result = await reviewReport([makeDraft()]);

    expect(result.verdict).toBe("REVISE");
  });

  it("filters non-string values out of the issues array", async () => {
    const reviewJson = JSON.stringify({
      verdict: "REVISE",
      feedback: "Some issues.",
      issues: ["Valid issue", 42, null, "Another valid issue"],
    });
    mockCreate.mockResolvedValueOnce(makeTextResponse(reviewJson));

    const result = await reviewReport([makeDraft()]);

    expect(result.issues).toEqual(["Valid issue", "Another valid issue"]);
  });

  it("coerces missing feedback to empty string", async () => {
    const reviewJson = JSON.stringify({ verdict: "OK", issues: [] });
    mockCreate.mockResolvedValueOnce(makeTextResponse(reviewJson));

    const result = await reviewReport([makeDraft()]);

    expect(result.feedback).toBe("");
  });

  it("coerces missing issues to empty array", async () => {
    const reviewJson = JSON.stringify({ verdict: "OK", feedback: "Good." });
    mockCreate.mockResolvedValueOnce(makeTextResponse(reviewJson));

    const result = await reviewReport([makeDraft()]);

    expect(result.issues).toEqual([]);
  });

  it("calls the Anthropic API with the correct model", async () => {
    mockCreate.mockResolvedValueOnce(
      makeTextResponse(JSON.stringify({ verdict: "OK", feedback: "", issues: [] })),
    );

    await reviewReport([makeDraft()]);

    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toBe("claude-sonnet-4-20250514");
  });

  it("includes all draft messages in the prompt sent to Claude", async () => {
    mockCreate.mockResolvedValueOnce(
      makeTextResponse(JSON.stringify({ verdict: "OK", feedback: "", issues: [] })),
    );

    const drafts = [
      makeDraft({ message: "First draft content" }),
      makeDraft({ message: "Second draft content" }),
    ];

    await reviewReport(drafts);

    const call = mockCreate.mock.calls[0][0];
    const userMessage = call.messages[0].content as string;
    expect(userMessage).toContain("First draft content");
    expect(userMessage).toContain("Second draft content");
  });
});

// ---------------------------------------------------------------------------
// refineReport
// ---------------------------------------------------------------------------

describe("refineReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns refined drafts parsed from Claude's JSON response", async () => {
    const refined: ReportDraft[] = [
      { message: "Refined summary", markdownContent: "# Refined", filename: "daily.md" },
    ];
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(refined)));

    const result = await refineReport([makeDraft()], "Add risk section.");

    expect(result).toHaveLength(1);
    expect(result[0].message).toBe("Refined summary");
    expect(result[0].markdownContent).toBe("# Refined");
    expect(result[0].filename).toBe("daily.md");
  });

  it("falls back to original drafts when Claude returns malformed JSON", async () => {
    const originals = [makeDraft({ message: "Original content" })];
    mockCreate.mockResolvedValueOnce(makeTextResponse("not json"));

    const result = await refineReport(originals, "Some feedback.");

    expect(result).toEqual(originals);
  });

  it("falls back to original drafts when Claude returns an empty array", async () => {
    const originals = [makeDraft()];
    mockCreate.mockResolvedValueOnce(makeTextResponse("[]"));

    const result = await refineReport(originals, "feedback");

    expect(result).toEqual(originals);
  });

  it("falls back to originals when Claude returns a non-array JSON value", async () => {
    const originals = [makeDraft()];
    mockCreate.mockResolvedValueOnce(
      makeTextResponse(JSON.stringify({ message: "oops" })),
    );

    const result = await refineReport(originals, "feedback");

    expect(result).toEqual(originals);
  });

  it("coerces missing markdownContent to undefined in refined draft", async () => {
    const refined = [{ message: "Refined without markdown" }];
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(refined)));

    const result = await refineReport([makeDraft()], "feedback");

    expect(result[0].markdownContent).toBeUndefined();
  });

  it("coerces missing filename to undefined in refined draft", async () => {
    const refined = [{ message: "Refined", markdownContent: "# Content" }];
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(refined)));

    const result = await refineReport([makeDraft()], "feedback");

    expect(result[0].filename).toBeUndefined();
  });

  it("coerces non-string message to empty string in refined draft", async () => {
    const refined = [{ message: null }];
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(refined)));

    const result = await refineReport([makeDraft()], "feedback");

    expect(result[0].message).toBe("");
  });

  it("calls the Anthropic API with the correct model", async () => {
    const refined = [makeDraft({ message: "Refined" })];
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(refined)));

    await refineReport([makeDraft()], "Feedback here.");

    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toBe("claude-sonnet-4-20250514");
  });

  it("includes the feedback in the prompt sent to Claude", async () => {
    const refined = [makeDraft({ message: "Refined" })];
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(refined)));

    await refineReport([makeDraft()], "Add macro risk analysis.");

    const call = mockCreate.mock.calls[0][0];
    const userMessage = call.messages[0].content as string;
    expect(userMessage).toContain("Add macro risk analysis.");
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

    expect(mockCreateGist).toHaveBeenCalledWith("daily.md", "# Details", "daily.md");
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
    await runReviewPipeline([], "TEST_WEBHOOK");

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSendDiscordMessage).not.toHaveBeenCalled();
  });

  it("sends original drafts directly when review verdict is OK", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";
    mockCreate.mockResolvedValueOnce(
      makeTextResponse(
        JSON.stringify({ verdict: "OK", feedback: "", issues: [] }),
      ),
    );

    await runReviewPipeline([makeDraft({ message: "Original" })], "TEST_WEBHOOK");

    // reviewReport called once, refineReport NOT called (mockCreate only called once)
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockSendDiscordMessage).toHaveBeenCalledWith("Original", "TEST_WEBHOOK");
  });

  it("refines drafts and sends refined version when verdict is REVISE", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";

    // First Claude call: reviewReport → REVISE
    mockCreate.mockResolvedValueOnce(
      makeTextResponse(
        JSON.stringify({ verdict: "REVISE", feedback: "Add risks.", issues: ["Missing risk"] }),
      ),
    );

    // Second Claude call: refineReport → refined draft
    const refined: ReportDraft[] = [{ message: "Refined with risks added" }];
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(refined)));

    await runReviewPipeline([makeDraft()], "TEST_WEBHOOK");

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockSendDiscordMessage).toHaveBeenCalledWith(
      "Refined with risks added",
      "TEST_WEBHOOK",
    );
  });

  it("refines drafts and sends refined version when verdict is REJECT", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";

    // First Claude call: reviewReport → REJECT
    mockCreate.mockResolvedValueOnce(
      makeTextResponse(
        JSON.stringify({
          verdict: "REJECT",
          feedback: "Completely rewrite.",
          issues: ["No data", "Wrong conclusions"],
        }),
      ),
    );

    // Second Claude call: refineReport
    const refined: ReportDraft[] = [{ message: "Completely rewritten draft" }];
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(refined)));

    await runReviewPipeline([makeDraft()], "TEST_WEBHOOK");

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockSendDiscordMessage).toHaveBeenCalledWith(
      "Completely rewritten draft",
      "TEST_WEBHOOK",
    );
  });

  it("sends refined drafts (not originals) after REVISE", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";

    mockCreate.mockResolvedValueOnce(
      makeTextResponse(
        JSON.stringify({ verdict: "REVISE", feedback: "Improve clarity.", issues: [] }),
      ),
    );

    const refined: ReportDraft[] = [{ message: "Improved clarity version" }];
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(refined)));

    await runReviewPipeline(
      [makeDraft({ message: "Original uncleated draft" })],
      "TEST_WEBHOOK",
    );

    const sentMessage = mockSendDiscordMessage.mock.calls[0][0];
    expect(sentMessage).toBe("Improved clarity version");
    expect(sentMessage).not.toBe("Original uncleated draft");
  });

  it("calls refineReport when review parse fails (conservative REVISE fallback)", async () => {
    process.env.TEST_WEBHOOK = "https://discord.test/webhook";

    // Malformed JSON → reviewReport defaults to REVISE (conservative)
    mockCreate.mockResolvedValueOnce(makeTextResponse("invalid json"));

    // refineReport is called → returns refined draft
    const refined: ReportDraft[] = [{ message: "Conservatively refined" }];
    mockCreate.mockResolvedValueOnce(makeTextResponse(JSON.stringify(refined)));

    await runReviewPipeline([makeDraft({ message: "Original" })], "TEST_WEBHOOK");

    // Two Claude calls: reviewReport + refineReport
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockSendDiscordMessage).toHaveBeenCalledWith(
      "Conservatively refined",
      "TEST_WEBHOOK",
    );
  });

  it("still sends drafts even when webhook env var is not set", async () => {
    // TEST_WEBHOOK not set → sendDrafts will skip silently
    mockCreate.mockResolvedValueOnce(
      makeTextResponse(
        JSON.stringify({ verdict: "OK", feedback: "", issues: [] }),
      ),
    );

    // Should not throw
    await expect(
      runReviewPipeline([makeDraft()], "TEST_WEBHOOK"),
    ).resolves.toBeUndefined();

    expect(mockSendDiscordMessage).not.toHaveBeenCalled();
  });
});

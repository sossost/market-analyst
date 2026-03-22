import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  appendValidationWarnings,
  createSendDiscordReport,
  inferReportType,
} from "../sendDiscordReport";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/discord", () => ({
  sendDiscordMessage: vi.fn().mockResolvedValue(undefined),
  sendDiscordFile: vi.fn().mockResolvedValue(undefined),
  sendDiscordError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/gist", () => ({
  createGist: vi.fn().mockResolvedValue({ id: "gist-1", url: "https://gist.github.com/1" }),
}));

// ---------------------------------------------------------------------------
// inferReportType — 순수 함수 테스트
// ---------------------------------------------------------------------------

describe("inferReportType", () => {
  it("daily-*.md → 'daily'", () => {
    expect(inferReportType("daily-2026-03-19.md")).toBe("daily");
  });

  it("weekly-*.md → 'weekly'", () => {
    expect(inferReportType("weekly-2026-03-19.md")).toBe("weekly");
  });

  it("unknown filename → undefined", () => {
    expect(inferReportType("report.md")).toBeUndefined();
  });

  it("null → undefined", () => {
    expect(inferReportType(null)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// appendValidationWarnings — 순수 함수 테스트
// ---------------------------------------------------------------------------

describe("appendValidationWarnings", () => {
  it("returns original markdown when no warnings or errors exist", () => {
    const md = "# 리포트\n리스크 요인: 하락 가능성. 상승 모멘텀.";
    const result = appendValidationWarnings(md);
    expect(result).toBe(md);
  });

  it("appends warning section when bull-bias is detected", () => {
    // bull keywords only, no bear keywords → triggers both error (no risk) and warning (bull-bias)
    const md = "상승 급등 돌파 신고가 강세 긍정 호재 성장 개선 확대";
    const result = appendValidationWarnings(md);

    expect(result).toContain("---");
    expect(result).toContain("자동 품질 검증 결과");
    expect(result).toContain("리스크 관련 키워드가 전혀 없습니다");
    expect(result).toContain("Bull-bias");
  });

  it("appends error when risk keywords are completely absent", () => {
    const md = "좋은 내용입니다. 모든 것이 완벽합니다.";
    const result = appendValidationWarnings(md);

    expect(result).toContain("리스크 관련 키워드가 전혀 없습니다");
  });

  it("does not modify markdown when bear keywords are present with balance", () => {
    // Both bull and bear present in balanced ratio
    const md = "상승 모멘텀 확인. 리스크 주의 경고 위험 하락 약세 변동성.";
    const result = appendValidationWarnings(md);

    // Bear keywords (6) outnumber bull (1), so no bull-bias and risk keywords present
    expect(result).toBe(md);
  });
});

// ---------------------------------------------------------------------------
// createSendDiscordReport — 통합 테스트 (Discord/Gist mocked)
// ---------------------------------------------------------------------------

describe("createSendDiscordReport", () => {
  const ENV_VAR = "TEST_DISCORD_WEBHOOK";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env[ENV_VAR] = "https://discord.test/webhook";
  });

  it("includes validation warnings in gist markdown content", async () => {
    const { createGist } = await import("@/lib/gist");
    const mockCreateGist = vi.mocked(createGist);
    mockCreateGist.mockResolvedValue({ id: "g1", url: "https://gist.github.com/g1" });

    const tool = createSendDiscordReport(ENV_VAR);

    // 리스크 키워드 1개(리스크) + bull 키워드 다수 → bull-bias warning, error 없음
    const warningOnlyMd = "리스크. 상승 급등 돌파 신고가 강세 긍정 호재 성장 개선 확대";
    await tool.execute({
      message: "테스트 요약",
      markdownContent: warningOnlyMd,
      filename: "test.md",
    });

    // Gist should receive markdown with appended warnings
    const gistCall = mockCreateGist.mock.calls[0];
    const sentContent = gistCall[1] as string;
    expect(sentContent).toContain("자동 품질 검증 결과");
    expect(sentContent).toContain("Bull-bias");
  });

  it("does not append warnings when report is balanced", async () => {
    const { createGist } = await import("@/lib/gist");
    const mockCreateGist = vi.mocked(createGist);
    mockCreateGist.mockClear();
    mockCreateGist.mockResolvedValue({ id: "g2", url: "https://gist.github.com/g2" });

    const tool = createSendDiscordReport(ENV_VAR);

    const balancedMd = "상승 모멘텀 확인. 리스크 주의 경고 위험 하락 약세 변동성.";
    await tool.execute({
      message: "테스트 요약",
      markdownContent: balancedMd,
      filename: "test.md",
    });

    // After mockClear, calls[0] is the call from this test only
    const gistCall = mockCreateGist.mock.calls[0];
    const sentContent = gistCall[1] as string;
    expect(sentContent).not.toContain("자동 품질 검증 결과");
  });

  it("sends message-only without validation when no markdownContent", async () => {
    const { sendDiscordMessage } = await import("@/lib/discord");
    const mockSend = vi.mocked(sendDiscordMessage);
    mockSend.mockResolvedValue(undefined);

    const tool = createSendDiscordReport(ENV_VAR);
    const resultStr = await tool.execute({ message: "간단 메시지" });
    const result = JSON.parse(resultStr);

    expect(result.success).toBe(true);
    expect(result.fileAttached).toBe(false);
  });

  it("includes warnings in fallback file when gist fails", async () => {
    const { createGist } = await import("@/lib/gist");
    const { sendDiscordFile } = await import("@/lib/discord");
    const mockCreateGist = vi.mocked(createGist);
    const mockSendFile = vi.mocked(sendDiscordFile);
    mockCreateGist.mockResolvedValue(null);
    mockSendFile.mockResolvedValue(undefined);

    const tool = createSendDiscordReport(ENV_VAR);

    // 리스크 키워드 있고 bull-bias warning만 발생 — error 없어 차단되지 않음
    const warningOnlyMd = "리스크. 상승 급등 돌파 신고가 강세 긍정 호재 성장 개선 확대";
    await tool.execute({
      message: "테스트 요약",
      markdownContent: warningOnlyMd,
      filename: "test.md",
    });

    // Fallback file should also include warnings
    const fileCall = mockSendFile.mock.calls[0];
    const sentContent = fileCall[3] as string;
    expect(sentContent).toContain("자동 품질 검증 결과");
  });

  // ---------------------------------------------------------------------------
  // 발송 차단 게이트 — errors 반환 시 차단
  // ---------------------------------------------------------------------------

  it("auto-corrects Phase 2 double conversion and sends successfully", async () => {
    const { sendDiscordMessage, sendDiscordError } = await import("@/lib/discord");
    const { createGist } = await import("@/lib/gist");
    const mockSend = vi.mocked(sendDiscordMessage);
    const mockError = vi.mocked(sendDiscordError);
    const mockGist = vi.mocked(createGist);
    mockSend.mockResolvedValue(undefined);
    mockError.mockResolvedValue(undefined);
    mockGist.mockResolvedValue({ url: "https://gist.github.com/test", id: "abc" });

    const tool = createSendDiscordReport(ENV_VAR);

    // Phase 2 비율 이상값 → 자동 교정 후 정상 발송
    const invalidMd = "리스크 주의. Phase 2 비율: 2330%";
    const resultStr = await tool.execute({
      message: "테스트 요약",
      markdownContent: invalidMd,
      filename: "test.md",
    });
    const result = JSON.parse(resultStr);

    expect(result.success).toBe(true);
    // Gist에는 교정된 마크다운이 전달됨
    expect(mockGist).toHaveBeenCalledOnce();
    const gistContent = mockGist.mock.calls[0][1];
    expect(gistContent).toContain("Phase 2 비율: 23.3%");
    expect(gistContent).not.toContain("2330%");
  });

  it("returns success: false and does not send when validation errors exist", async () => {
    const { sendDiscordMessage, sendDiscordError } = await import("@/lib/discord");
    const { createGist } = await import("@/lib/gist");
    const mockSend = vi.mocked(sendDiscordMessage);
    const mockError = vi.mocked(sendDiscordError);
    const mockGist = vi.mocked(createGist);
    mockSend.mockResolvedValue(undefined);
    mockError.mockResolvedValue(undefined);

    const tool = createSendDiscordReport(ENV_VAR);

    // 리스크 키워드 없음 → errors 반환 (이건 자동 교정 대상이 아님)
    const invalidMd = "반도체 섹터가 강세를 보이며 신고가를 돌파했습니다. 성장 전망이 매우 긍정적입니다.";
    const resultStr = await tool.execute({
      message: "테스트 요약",
      markdownContent: invalidMd,
      filename: "test.md",
    });
    const result = JSON.parse(resultStr);

    expect(result.success).toBe(false);
    expect(result.error).toContain("발송 차단됨");
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockGist).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalledOnce();
  });

  it("proceeds with send when only warnings exist (no errors)", async () => {
    const { sendDiscordMessage, sendDiscordError } = await import("@/lib/discord");
    const { createGist } = await import("@/lib/gist");
    const mockSend = vi.mocked(sendDiscordMessage);
    const mockError = vi.mocked(sendDiscordError);
    const mockGist = vi.mocked(createGist);
    mockSend.mockResolvedValue(undefined);
    mockError.mockResolvedValue(undefined);
    mockGist.mockResolvedValue({ id: "g3", url: "https://gist.github.com/g3" });

    const tool = createSendDiscordReport(ENV_VAR);

    // bull-bias 경고(warning)만 있고 error 없는 케이스:
    // 리스크 키워드 1개(리스크) + bull 키워드 다수 → bull-bias warning, no error
    const warningOnlyMd = "리스크. 상승 급등 돌파 신고가 강세 긍정 호재 성장 개선 확대";
    const resultStr = await tool.execute({
      message: "테스트 요약",
      markdownContent: warningOnlyMd,
      filename: "test.md",
    });
    const result = JSON.parse(resultStr);

    expect(result.success).toBe(true);
    expect(mockError).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledOnce();
  });
});

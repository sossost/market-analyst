import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  appendValidationWarnings,
  createSendDiscordReport,
} from "../sendDiscordReport";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/agent/discord", () => ({
  sendDiscordMessage: vi.fn().mockResolvedValue(undefined),
  sendDiscordFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/agent/gist", () => ({
  createGist: vi.fn().mockResolvedValue({ id: "gist-1", url: "https://gist.github.com/1" }),
}));

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
    vi.restoreAllMocks();
    process.env[ENV_VAR] = "https://discord.test/webhook";
  });

  it("includes validation warnings in gist markdown content", async () => {
    const { createGist } = await import("@/agent/gist");
    const mockCreateGist = vi.mocked(createGist);
    mockCreateGist.mockResolvedValue({ id: "g1", url: "https://gist.github.com/g1" });

    const tool = createSendDiscordReport(ENV_VAR);

    // markdown with only bull keywords → triggers warnings
    const bullOnlyMd = "상승 급등 돌파 신고가 강세 긍정 호재 성장 개선 확대";
    await tool.execute({
      message: "테스트 요약",
      markdownContent: bullOnlyMd,
      filename: "test.md",
    });

    // Gist should receive markdown with appended warnings
    const gistCall = mockCreateGist.mock.calls[0];
    const sentContent = gistCall[1] as string;
    expect(sentContent).toContain("자동 품질 검증 결과");
    expect(sentContent).toContain("Bull-bias");
  });

  it("does not append warnings when report is balanced", async () => {
    const { createGist } = await import("@/agent/gist");
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
    const { sendDiscordMessage } = await import("@/agent/discord");
    const mockSend = vi.mocked(sendDiscordMessage);
    mockSend.mockResolvedValue(undefined);

    const tool = createSendDiscordReport(ENV_VAR);
    const resultStr = await tool.execute({ message: "간단 메시지" });
    const result = JSON.parse(resultStr);

    expect(result.success).toBe(true);
    expect(result.fileAttached).toBe(false);
  });

  it("includes warnings in fallback file when gist fails", async () => {
    const { createGist } = await import("@/agent/gist");
    const { sendDiscordFile } = await import("@/agent/discord");
    const mockCreateGist = vi.mocked(createGist);
    const mockSendFile = vi.mocked(sendDiscordFile);
    mockCreateGist.mockResolvedValue(null);
    mockSendFile.mockResolvedValue(undefined);

    const tool = createSendDiscordReport(ENV_VAR);

    const bullOnlyMd = "상승 급등 돌파 신고가 강세 긍정 호재 성장 개선 확대";
    await tool.execute({
      message: "테스트 요약",
      markdownContent: bullOnlyMd,
      filename: "test.md",
    });

    // Fallback file should also include warnings
    const fileCall = mockSendFile.mock.calls[0];
    const sentContent = fileCall[3] as string;
    expect(sentContent).toContain("자동 품질 검증 결과");
  });
});

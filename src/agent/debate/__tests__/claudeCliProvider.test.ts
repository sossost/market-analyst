import { describe, it, expect, vi, beforeEach } from "vitest";
import { LLMProviderError } from "../llm/types.js";
import { ClaudeCliProvider } from "../llm/claudeCliProvider.js";
import { FallbackProvider } from "../llm/fallbackProvider.js";
import type { LLMProvider, LLMCallOptions } from "../llm/types.js";

// node:child_process 모킹
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const { execFile } = await import("node:child_process");
const mockExecFile = vi.mocked(execFile);

const CALL_OPTIONS: LLMCallOptions = {
  systemPrompt: "You are a helpful assistant.",
  userMessage: "Hello world",
};

/**
 * execFile mock helper — callback 방식 시뮬레이션.
 */
function mockExecFileSuccess(stdout: string) {
  mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
    const callback = cb as (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    const child = {
      stdin: {
        end: vi.fn(),
      },
    };
    // 비동기로 콜백 호출 (실제 exec 동작 모사)
    process.nextTick(() => callback(null, stdout, ""));
    return child as any;
  });
}

function mockExecFileError(error: Error) {
  mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
    const callback = cb as (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    const child = {
      stdin: {
        end: vi.fn(),
      },
    };
    process.nextTick(() => callback(error, "", ""));
    return child as any;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ─── 성공 케이스 ──────────────────────────────────────────────────────────────

describe("ClaudeCliProvider — 성공 케이스", () => {
  it("JSON 출력에서 result 필드를 content로 반환한다", async () => {
    const jsonOutput = JSON.stringify({
      type: "result",
      result: "분석 결과입니다.",
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    mockExecFileSuccess(jsonOutput);

    const provider = new ClaudeCliProvider();
    const result = await provider.call(CALL_OPTIONS);

    expect(result.content).toBe("분석 결과입니다.");
    expect(result.tokensUsed.input).toBe(100);
    expect(result.tokensUsed.output).toBe(50);
  });

  it("JSON 출력에서 content 필드를 content로 반환한다 (result 없는 경우)", async () => {
    const jsonOutput = JSON.stringify({
      content: "콘텐츠 필드 응답",
    });
    mockExecFileSuccess(jsonOutput);

    const provider = new ClaudeCliProvider();
    const result = await provider.call(CALL_OPTIONS);

    expect(result.content).toBe("콘텐츠 필드 응답");
  });

  it("usage 필드 없으면 tokensUsed를 { input: 0, output: 0 }로 반환한다", async () => {
    const jsonOutput = JSON.stringify({ result: "응답" });
    mockExecFileSuccess(jsonOutput);

    const provider = new ClaudeCliProvider();
    const result = await provider.call(CALL_OPTIONS);

    expect(result.tokensUsed).toEqual({ input: 0, output: 0 });
  });

  it("JSON 파싱 실패 시 raw 텍스트를 content로 반환한다", async () => {
    mockExecFileSuccess("일반 텍스트 응답 (JSON 아님)");

    const provider = new ClaudeCliProvider();
    const result = await provider.call(CALL_OPTIONS);

    expect(result.content).toBe("일반 텍스트 응답 (JSON 아님)");
    expect(result.tokensUsed).toEqual({ input: 0, output: 0 });
  });

  it("빈 stdout이면 빈 content를 반환한다", async () => {
    mockExecFileSuccess("");

    const provider = new ClaudeCliProvider();
    const result = await provider.call(CALL_OPTIONS);

    expect(result.content).toBe("");
    expect(result.tokensUsed).toEqual({ input: 0, output: 0 });
  });
});

// ─── 에러 케이스 ──────────────────────────────────────────────────────────────

describe("ClaudeCliProvider — 에러 케이스", () => {
  it("ENOENT 에러를 CLI 미설치 LLMProviderError로 래핑한다", async () => {
    const enoentError = Object.assign(new Error("spawn claude ENOENT"), {
      code: "ENOENT",
    });
    mockExecFileError(enoentError);

    const provider = new ClaudeCliProvider();
    await expect(provider.call(CALL_OPTIONS)).rejects.toThrow(LLMProviderError);
    await expect(provider.call(CALL_OPTIONS)).rejects.toThrow(
      "Claude CLI not found",
    );
  });

  it("타임아웃 에러를 LLMProviderError로 래핑한다", async () => {
    const timeoutError = Object.assign(new Error("Process timed out"), {
      killed: true,
      code: "ETIMEDOUT",
    });
    mockExecFileError(timeoutError);

    const provider = new ClaudeCliProvider();
    await expect(provider.call(CALL_OPTIONS)).rejects.toThrow(LLMProviderError);
    await expect(provider.call(CALL_OPTIONS)).rejects.toThrow("timed out");
  });

  it("non-zero exit (rate limit 포함)을 LLMProviderError로 래핑한다", async () => {
    const exitError = Object.assign(
      new Error("Command failed: rate limit exceeded"),
      { code: 1 },
    );
    mockExecFileError(exitError);

    const provider = new ClaudeCliProvider();
    await expect(provider.call(CALL_OPTIONS)).rejects.toThrow(LLMProviderError);
    await expect(provider.call(CALL_OPTIONS)).rejects.toThrow(
      "Claude CLI exited with error",
    );
  });
});

// ─── FallbackProvider 조합 ────────────────────────────────────────────────────

describe("FallbackProvider(ClaudeCliProvider, AnthropicProvider) 조합", () => {
  it("CLI 실패 시 fallback provider로 넘어간다", async () => {
    const exitError = Object.assign(new Error("CLI failed"), { code: 1 });
    mockExecFileError(exitError);

    const fallbackResult = {
      content: "폴백 응답",
      tokensUsed: { input: 10, output: 20 },
    };

    const mockFallback: LLMProvider = {
      call: vi.fn().mockResolvedValue(fallbackResult),
    };

    const cli = new ClaudeCliProvider();
    const provider = new FallbackProvider(cli, mockFallback, "ClaudeCLI");

    const result = await provider.call(CALL_OPTIONS);
    expect(result.content).toBe("폴백 응답");
    expect(mockFallback.call).toHaveBeenCalledOnce();
  });

  it("CLI 성공 시 fallback provider를 호출하지 않는다", async () => {
    const jsonOutput = JSON.stringify({ result: "CLI 응답" });
    mockExecFileSuccess(jsonOutput);

    const mockFallback: LLMProvider = {
      call: vi.fn().mockResolvedValue({
        content: "폴백 응답",
        tokensUsed: { input: 0, output: 0 },
      }),
    };

    const cli = new ClaudeCliProvider();
    const provider = new FallbackProvider(cli, mockFallback, "ClaudeCLI");

    const result = await provider.call(CALL_OPTIONS);
    expect(result.content).toBe("CLI 응답");
    expect(mockFallback.call).not.toHaveBeenCalled();
  });
});

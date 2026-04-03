import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

/** 마지막으로 생성된 mock child — kill 호출 검증용 */
let lastMockChild: { stdin: { end: ReturnType<typeof vi.fn> }; kill: ReturnType<typeof vi.fn> };

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
      stdin: { end: vi.fn() },
      kill: vi.fn(),
    };
    lastMockChild = child;
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
      stdin: { end: vi.fn() },
      kill: vi.fn(),
    };
    lastMockChild = child;
    process.nextTick(() => callback(error, "", ""));
    return child as any;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  // 테스트 간 전역 인스턴스 정리
  ClaudeCliProvider.killAll();
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

  it("빈 stdout이면 LLMProviderError를 throw한다", async () => {
    mockExecFileSuccess("");

    const provider = new ClaudeCliProvider();

    await expect(provider.call(CALL_OPTIONS)).rejects.toThrow("empty response");
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

// ─── child process 정리 ─────────────────────────────────────────────────────

describe("ClaudeCliProvider — child process 정리", () => {
  it("에러 발생 시 child.kill('SIGTERM')을 호출한다", async () => {
    const exitError = Object.assign(new Error("CLI failed"), { code: 1 });
    mockExecFileError(exitError);

    const provider = new ClaudeCliProvider();
    await expect(provider.call(CALL_OPTIONS)).rejects.toThrow(LLMProviderError);

    expect(lastMockChild.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("성공 시 child.kill을 호출하지 않는다", async () => {
    const jsonOutput = JSON.stringify({ result: "응답" });
    mockExecFileSuccess(jsonOutput);

    const provider = new ClaudeCliProvider();
    await provider.call(CALL_OPTIONS);

    expect(lastMockChild.kill).not.toHaveBeenCalled();
  });

  it("child.kill이 에러를 던져도 원래 에러가 전파된다", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      const callback = cb as (error: Error | null, stdout: string, stderr: string) => void;
      const child = {
        stdin: { end: vi.fn() },
        kill: vi.fn(() => { throw new Error("Process already exited"); }),
      };
      lastMockChild = child;
      process.nextTick(() => callback(Object.assign(new Error("timeout"), { killed: true, code: "ETIMEDOUT" }), "", ""));
      return child as any;
    });

    const provider = new ClaudeCliProvider();
    await expect(provider.call(CALL_OPTIONS)).rejects.toThrow("timed out");
  });

  it("dispose()가 활성 child를 모두 종료한다", async () => {
    // 콜백을 지연시켜 child가 activeChildren에 남아있도록 한다
    const pendingCallbacks: Array<(error: Error | null, stdout: string, stderr: string) => void> = [];
    const mockChildren: Array<{ kill: ReturnType<typeof vi.fn> }> = [];

    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      const callback = cb as (error: Error | null, stdout: string, stderr: string) => void;
      pendingCallbacks.push(callback);
      const child = {
        stdin: { end: vi.fn() },
        kill: vi.fn(),
      };
      mockChildren.push(child);
      return child as any;
    });

    const provider = new ClaudeCliProvider();
    // call을 시작하되 완료를 기다리지 않음 (콜백 미실행)
    const promise1 = provider.call(CALL_OPTIONS);
    const promise2 = provider.call(CALL_OPTIONS);

    // dispose 호출 — 아직 완료되지 않은 child들이 kill되어야 함
    provider.dispose();

    expect(mockChildren[0].kill).toHaveBeenCalledWith("SIGTERM");
    expect(mockChildren[1].kill).toHaveBeenCalledWith("SIGTERM");

    // 콜백 해제하여 promise가 settle되도록
    for (const cb of pendingCallbacks) {
      cb(Object.assign(new Error("killed"), { code: 1 }), "", "");
    }
    await Promise.allSettled([promise1, promise2]);
  });

  it("killAll()이 모든 인스턴스의 활성 child를 종료한다", async () => {
    const pendingCallbacks: Array<(error: Error | null, stdout: string, stderr: string) => void> = [];
    const mockChildren: Array<{ kill: ReturnType<typeof vi.fn> }> = [];

    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      const callback = cb as (error: Error | null, stdout: string, stderr: string) => void;
      pendingCallbacks.push(callback);
      const child = {
        stdin: { end: vi.fn() },
        kill: vi.fn(),
      };
      mockChildren.push(child);
      return child as any;
    });

    const provider1 = new ClaudeCliProvider();
    const provider2 = new ClaudeCliProvider();
    const p1 = provider1.call(CALL_OPTIONS);
    const p2 = provider2.call(CALL_OPTIONS);

    ClaudeCliProvider.killAll();

    expect(mockChildren[0].kill).toHaveBeenCalledWith("SIGTERM");
    expect(mockChildren[1].kill).toHaveBeenCalledWith("SIGTERM");

    for (const cb of pendingCallbacks) {
      cb(Object.assign(new Error("killed"), { code: 1 }), "", "");
    }
    await Promise.allSettled([p1, p2]);
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

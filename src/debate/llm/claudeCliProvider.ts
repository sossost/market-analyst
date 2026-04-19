import { execFile, type ChildProcess } from "node:child_process";
import type { LLMCallOptions, LLMCallResult, LLMProvider } from "./types.js";
import { LLMProviderError } from "./types.js";
import { CLAUDE_OPUS } from "@/lib/models.js";

const TIMEOUT_MS = 3_600_000; // 60분 — Round 3 합성 시 대용량 입력 대응
const MAX_SYSTEM_PROMPT_BYTES = 64 * 1024; // 64KB

interface ClaudeCliJsonOutput {
  type?: string;
  result?: string;
  content?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

function extractContent(parsed: ClaudeCliJsonOutput): string {
  if (typeof parsed.result === "string") return parsed.result;
  if (typeof parsed.content === "string") return parsed.content;
  return "";
}

function extractTokensUsed(
  parsed: ClaudeCliJsonOutput,
): { input: number; output: number } {
  const usage = parsed.usage;
  if (usage == null) return { input: 0, output: 0 };
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
  };
}

function sanitizeForCli(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\0/g, "");
}

function parseCliOutput(stdout: string): LLMCallResult {
  const trimmed = stdout.trim();
  if (trimmed === "") {
    throw new LLMProviderError("Claude CLI returned empty response");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // JSON 파싱 실패 시 raw 텍스트를 content로 반환
    return { content: trimmed, tokensUsed: { input: 0, output: 0 } };
  }

  if (parsed == null || typeof parsed !== "object") {
    return { content: trimmed, tokensUsed: { input: 0, output: 0 } };
  }

  const output = parsed as ClaudeCliJsonOutput;
  return {
    content: extractContent(output),
    tokensUsed: extractTokensUsed(output),
  };
}

/**
 * Claude CLI (`claude -p`) 를 통해 LLM 호출을 실행하는 Provider.
 *
 * Max 구독 내 처리 → API 비용 $0. Opus 모델 기본 사용.
 * CLI 미설치(ENOENT), non-zero exit, 타임아웃 → `LLMProviderError` 로 래핑.
 */
export class ClaudeCliProvider implements LLMProvider {
  private readonly model: string;
  private readonly timeoutMs: number;

  /** 현재 실행 중인 child process 추적 — 에러/종료 시 일괄 정리용 */
  private readonly activeChildren = new Set<ChildProcess>();

  /** 전역 인스턴스 추적 — process exit 시 모든 인스턴스의 child 일괄 정리 */
  private static readonly instances = new Set<ClaudeCliProvider>();

  constructor(
    model: string = CLAUDE_OPUS,
    timeoutMs: number = TIMEOUT_MS,
  ) {
    this.model = model;
    this.timeoutMs = timeoutMs;
    ClaudeCliProvider.instances.add(this);
  }

  /** 이 인스턴스의 활성 child process를 모두 종료한다. */
  dispose(): void {
    for (const child of this.activeChildren) {
      try { child.kill("SIGTERM"); } catch { /* 이미 종료된 프로세스 무시 */ }
    }
    this.activeChildren.clear();
    ClaudeCliProvider.instances.delete(this);
  }

  /** 모든 ClaudeCliProvider 인스턴스의 활성 child process를 종료한다. */
  static killAll(): void {
    for (const instance of Array.from(ClaudeCliProvider.instances)) {
      instance.dispose();
    }
  }

  async call(options: LLMCallOptions): Promise<LLMCallResult> {
    const { systemPrompt, userMessage } = options;

    const sanitizedPrompt = sanitizeForCli(systemPrompt);
    if (Buffer.byteLength(sanitizedPrompt, "utf-8") > MAX_SYSTEM_PROMPT_BYTES) {
      throw new LLMProviderError(
        `System prompt exceeds ${MAX_SYSTEM_PROMPT_BYTES / 1024}KB limit`,
      );
    }

    const args = [
      "--print",
      "--model",
      this.model,
      "--system-prompt",
      sanitizedPrompt,
      "--output-format",
      "json",
    ];

    // ANTHROPIC_API_KEY가 있으면 CLI가 Max 대신 API 과금으로 동작하므로 제거
    const { ANTHROPIC_API_KEY: _, ...cleanEnv } = process.env;

    return new Promise<LLMCallResult>((resolve, reject) => {
      const child = execFile(
        "claude",
        args,
        { timeout: this.timeoutMs, maxBuffer: 10 * 1024 * 1024, env: cleanEnv },
        (error, stdout, stderr) => {
          this.activeChildren.delete(child);
          if (error != null) {
            try { child.kill("SIGTERM"); } catch { /* 이미 종료된 프로세스 무시 */ }
            reject(this.classifyError(error, stdout, stderr));
            return;
          }
          try {
            resolve(parseCliOutput(stdout));
          } catch (parseError) {
            reject(
              new LLMProviderError(
                `Claude CLI output parse failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
                parseError,
              ),
            );
          }
        },
      );

      this.activeChildren.add(child);
      child.stdin?.end(userMessage, "utf-8");
    });
  }

  private classifyError(error: Error, stdout: string, stderr: string = ""): LLMProviderError {
    const nodeError = error as NodeJS.ErrnoException & { killed?: boolean };

    if (nodeError.code === "ENOENT") {
      return new LLMProviderError(
        "Claude CLI not found. Please install claude CLI and ensure it is in PATH.",
        error,
      );
    }

    if (nodeError.killed === true || nodeError.code === "ETIMEDOUT") {
      return new LLMProviderError(
        `Claude CLI timed out after ${this.timeoutMs / 1000}s`,
        error,
      );
    }

    const stderrSnippet = stderr.slice(0, 300);
    const stdoutSnippet = stdout.slice(0, 300);
    const detail = [
      error.message,
      stderrSnippet !== "" ? `stderr: ${stderrSnippet}` : null,
      stdoutSnippet !== "" ? `stdout: ${stdoutSnippet}` : null,
    ].filter(Boolean).join(" | ");
    return new LLMProviderError(
      `Claude CLI exited with error: ${detail}`,
      error,
    );
  }
}

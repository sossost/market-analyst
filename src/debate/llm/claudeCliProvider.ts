import { execFile } from "node:child_process";
import type { LLMCallOptions, LLMCallResult, LLMProvider } from "./types.js";
import { LLMProviderError } from "./types.js";

const DEFAULT_MODEL = "claude-opus-4-6";
const TIMEOUT_MS = 600_000; // 10분 — Round 3 Opus 합성 시 입력 ~30K 토큰 처리 대응
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

  constructor(
    model: string = DEFAULT_MODEL,
    timeoutMs: number = TIMEOUT_MS,
  ) {
    this.model = model;
    this.timeoutMs = timeoutMs;
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
        (error, stdout, _stderr) => {
          if (error != null) {
            reject(this.classifyError(error, stdout));
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

      child.stdin?.end(userMessage, "utf-8");
    });
  }

  private classifyError(error: Error, stdout: string): LLMProviderError {
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

    const detail = error.message !== "" ? error.message : stdout.slice(0, 200);
    return new LLMProviderError(
      `Claude CLI exited with error: ${detail}`,
      error,
    );
  }
}

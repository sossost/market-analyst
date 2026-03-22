// ---------------------------------------------------------------------------
// qaIssueReporter.test.ts — QA 이슈 생성 로직 단위 테스트
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// child_process.execFile을 mock하여 실제 gh CLI 호출 차단
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// util.promisify가 execFile을 그대로 반환하도록 mock
vi.mock("node:util", () => ({
  promisify: (fn: unknown) => fn,
}));

import * as childProcess from "node:child_process";
import { reportQAIssue, buildIssueTitle, type QAType } from "../qaIssueReporter";
import type { DailyQAResult } from "@/agent/dailyQA";
import type { DebateQAResult } from "@/agent/debateQA";

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

/**
 * execFile promise mock을 설정한다.
 * qaIssueReporter는 promisify(execFile) 결과를 await하므로
 * execFile이 Promise를 반환하는 형태로 mock한다.
 *
 * 첫 호출(gh issue list — 중복 체크): 빈 결과 반환
 * 이후 호출(gh issue create): issueUrl 반환
 */
function setupExecMock(mockUrl = "https://github.com/org/repo/issues/999"): void {
  vi.mocked(childProcess.execFile)
    .mockResolvedValueOnce({ stdout: "", stderr: "" } as never)  // gh issue list (중복 없음)
    .mockResolvedValue({ stdout: mockUrl + "\n", stderr: "" } as never);  // gh issue create
}

function setupExecErrorMock(errorMessage: string): void {
  vi.mocked(childProcess.execFile)
    .mockResolvedValueOnce({ stdout: "", stderr: "" } as never)  // gh issue list (중복 없음)
    .mockRejectedValue(new Error(errorMessage));  // gh issue create 실패
}

// ────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────

function makeQAResult(
  severity: "ok" | "warn" | "block",
  mismatchCount: number = 1,
): DailyQAResult {
  const mismatches = Array.from({ length: mismatchCount }, (_, i) => ({
    type: "symbol_phase" as const,
    field: `STOCK${i}.phase`,
    expected: 2,
    actual: 3,
    severity: "warn" as const,
  }));

  return {
    date: "2026-03-21",
    severity,
    mismatches,
    checkedItems: 3,
    checkedAt: "2026-03-21T04:00:00.000Z",
  };
}

function makeDebateQAResult(severity: "ok" | "warn" | "block"): DebateQAResult {
  return {
    date: "2026-03-21",
    severity,
    mismatches:
      severity === "ok"
        ? []
        : [
            {
              type: "sector_list" as const,
              field: "bull_bias",
              expected: "bullish + bearish 균형",
              actual: "전체 3건 bullish, bearish 0건",
              severity: severity === "block" ? ("block" as const) : ("warn" as const),
            },
          ],
    checkedItems: 2,
    checkedAt: "2026-03-21T04:00:00.000Z",
  };
}

// ────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────

describe("buildIssueTitle", () => {
  it("daily warn이면 '[WARN] 일간 QA' 형식 반환", () => {
    const title = buildIssueTitle("2026-03-21", "daily", "warn");
    expect(title).toContain("[WARN]");
    expect(title).toContain("일간 QA");
    expect(title).toContain("2026-03-21");
  });

  it("debate block이면 '[BLOCK] 토론 QA' 형식 반환", () => {
    const title = buildIssueTitle("2026-03-21", "debate", "block");
    expect(title).toContain("[BLOCK]");
    expect(title).toContain("토론 QA");
  });
});

describe("reportQAIssue", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
    delete process.env["DRY_RUN"];
    delete process.env["VALIDATE_DRY_RUN"];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ────────────────
  // severity ok → 아무것도 하지 않음
  // ────────────────
  it("severity ok이면 gh issue create 호출하지 않음", async () => {
    const result = makeQAResult("ok", 0);
    await reportQAIssue(result, "2026-03-21", "daily");
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });

  it("severity ok debate이면 gh issue create 호출하지 않음", async () => {
    const result = makeDebateQAResult("ok");
    await reportQAIssue(result, "2026-03-21", "debate");
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });

  // ────────────────
  // severity warn → P2: medium 라벨
  // ────────────────
  it("severity warn이면 gh issue create를 P2: medium 라벨로 호출", async () => {
    setupExecMock();
    const result = makeQAResult("warn");
    await reportQAIssue(result, "2026-03-21", "daily");

    // 첫 호출: gh issue list (중복 체크), 두 번째 호출: gh issue create
    expect(childProcess.execFile).toHaveBeenCalledTimes(2);
    const [_file, createArgs] = vi.mocked(childProcess.execFile).mock.calls[1] as unknown as [string, string[]];
    expect(_file).toBe("gh");
    expect(createArgs).toContain("create");
    expect(createArgs).toContain("P2: medium");
    expect(createArgs).toContain("report-feedback");
  });

  // ────────────────
  // severity block → P1: high 라벨
  // ────────────────
  it("severity block이면 gh issue create를 P1: high 라벨로 호출", async () => {
    setupExecMock();
    const result = makeQAResult("block", 3);
    await reportQAIssue(result, "2026-03-21", "daily");

    expect(childProcess.execFile).toHaveBeenCalledTimes(2);
    const [, createArgs] = vi.mocked(childProcess.execFile).mock.calls[1] as unknown as [string, string[]];
    expect(createArgs).toContain("P1: high");
    expect(createArgs).toContain("report-feedback");
  });

  // ────────────────
  // DRY_RUN 환경변수
  // ────────────────
  it("DRY_RUN=1이면 gh issue create 호출하지 않음", async () => {
    process.env["DRY_RUN"] = "1";
    const result = makeQAResult("warn");
    await reportQAIssue(result, "2026-03-21", "daily");
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });

  it("VALIDATE_DRY_RUN=1이면 gh issue create 호출하지 않음", async () => {
    process.env["VALIDATE_DRY_RUN"] = "1";
    const result = makeQAResult("block");
    await reportQAIssue(result, "2026-03-21", "daily");
    expect(childProcess.execFile).not.toHaveBeenCalled();
  });

  // ────────────────
  // 이슈 생성 실패 → 비블로킹
  // ────────────────
  it("gh CLI 실패 시 예외 전파 없이 graceful 처리", async () => {
    setupExecErrorMock("gh: command not found");
    const result = makeQAResult("warn");
    await expect(reportQAIssue(result, "2026-03-21", "daily")).resolves.not.toThrow();
  });

  // ────────────────
  // qaType별 이슈 제목
  // ────────────────
  it("daily 타입이면 이슈 제목에 '일간 QA' 포함", async () => {
    setupExecMock();
    const result = makeQAResult("warn");
    await reportQAIssue(result, "2026-03-21", "daily");

    const [, createArgs] = vi.mocked(childProcess.execFile).mock.calls[1] as unknown as [string, string[]];
    // --title 다음 원소가 실제 제목
    const titleIndex = createArgs.indexOf("--title") + 1;
    expect(createArgs[titleIndex]).toContain("일간 QA");
    expect(createArgs[titleIndex]).toContain("2026-03-21");
  });

  it("debate 타입이면 이슈 제목에 '토론 QA' 포함", async () => {
    setupExecMock();
    const result = makeDebateQAResult("warn");
    await reportQAIssue(result, "2026-03-21", "debate");

    const [, createArgs] = vi.mocked(childProcess.execFile).mock.calls[1] as unknown as [string, string[]];
    expect(createArgs.join(" ")).toContain("토론 QA");
  });

  // ────────────────
  // 이슈 본문에 날짜 포함
  // ────────────────
  it("이슈 본문에 reportDate가 포함됨", async () => {
    setupExecMock();
    const result = makeQAResult("warn");
    await reportQAIssue(result, "2026-03-21", "daily");

    const [, createArgs] = vi.mocked(childProcess.execFile).mock.calls[1] as unknown as [string, string[]];
    // --body 인수에 날짜가 포함되어야 함
    const bodyIndex = createArgs.indexOf("--body") + 1;
    expect(createArgs[bodyIndex]).toContain("2026-03-21");
  });

  // ────────────────
  // 중복 이슈 방어
  // ────────────────
  it("동일 제목의 open 이슈가 있으면 생성 스킵", async () => {
    // gh issue list가 기존 이슈를 반환하도록 설정
    vi.mocked(childProcess.execFile).mockResolvedValueOnce({
      stdout: "123\t[WARN] 일간 QA 데이터 정합성 이상 — 2026-03-21\tOPEN\n",
      stderr: "",
    } as never);

    const result = makeQAResult("warn");
    await reportQAIssue(result, "2026-03-21", "daily");

    // gh issue list만 호출되고 gh issue create는 호출되지 않아야 함
    expect(childProcess.execFile).toHaveBeenCalledOnce();
  });
});

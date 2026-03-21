// ---------------------------------------------------------------------------
// qaIssueReporter.test.ts — QA 이슈 생성 로직 단위 테스트
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// child_process.exec을 mock하여 실제 gh CLI 호출 차단
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

import * as childProcess from "node:child_process";
import { reportQAIssue, buildIssueTitle, type QAType } from "../qaIssueReporter";
import type { DailyQAResult } from "../../dailyQA";
import type { DebateQAResult } from "../../debateQA";

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

/**
 * exec 콜백 기반 mock을 설정한다.
 * qaIssueReporter의 execCommand는 exec(cmd, callback) 형태로 호출한다.
 */
function setupExecMock(mockUrl = "https://github.com/org/repo/issues/999"): void {
  // exec 오버로드 중 (command, callback) 형태에 맞춰 any로 캐스팅
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(childProcess.exec).mockImplementation((_cmd: string, callback: any) => {
    if (typeof callback === "function") {
      callback(null, mockUrl + "\n", "");
    }
    return {} as never;
  });
}

function setupExecErrorMock(errorMessage: string): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(childProcess.exec).mockImplementation((_cmd: string, callback: any) => {
    if (typeof callback === "function") {
      callback(new Error(errorMessage), "", "");
    }
    return {} as never;
  });
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
    expect(childProcess.exec).not.toHaveBeenCalled();
  });

  it("severity ok debate이면 gh issue create 호출하지 않음", async () => {
    const result = makeDebateQAResult("ok");
    await reportQAIssue(result, "2026-03-21", "debate");
    expect(childProcess.exec).not.toHaveBeenCalled();
  });

  // ────────────────
  // severity warn → P2: medium 라벨
  // ────────────────
  it("severity warn이면 gh issue create를 P2: medium 라벨로 호출", async () => {
    setupExecMock();
    const result = makeQAResult("warn");
    await reportQAIssue(result, "2026-03-21", "daily");

    expect(childProcess.exec).toHaveBeenCalledOnce();
    const command = vi.mocked(childProcess.exec).mock.calls[0][0] as string;
    expect(command).toContain("gh issue create");
    expect(command).toContain("P2: medium");
    expect(command).toContain("report-feedback");
  });

  // ────────────────
  // severity block → P1: high 라벨
  // ────────────────
  it("severity block이면 gh issue create를 P1: high 라벨로 호출", async () => {
    setupExecMock();
    const result = makeQAResult("block", 3);
    await reportQAIssue(result, "2026-03-21", "daily");

    expect(childProcess.exec).toHaveBeenCalledOnce();
    const command = vi.mocked(childProcess.exec).mock.calls[0][0] as string;
    expect(command).toContain("P1: high");
    expect(command).toContain("report-feedback");
  });

  // ────────────────
  // DRY_RUN 환경변수
  // ────────────────
  it("DRY_RUN=1이면 gh issue create 호출하지 않음", async () => {
    process.env["DRY_RUN"] = "1";
    const result = makeQAResult("warn");
    await reportQAIssue(result, "2026-03-21", "daily");
    expect(childProcess.exec).not.toHaveBeenCalled();
  });

  it("VALIDATE_DRY_RUN=1이면 gh issue create 호출하지 않음", async () => {
    process.env["VALIDATE_DRY_RUN"] = "1";
    const result = makeQAResult("block");
    await reportQAIssue(result, "2026-03-21", "daily");
    expect(childProcess.exec).not.toHaveBeenCalled();
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

    const command = vi.mocked(childProcess.exec).mock.calls[0][0] as string;
    expect(command).toContain("일간 QA");
  });

  it("debate 타입이면 이슈 제목에 '토론 QA' 포함", async () => {
    setupExecMock();
    const result = makeDebateQAResult("warn");
    await reportQAIssue(result, "2026-03-21", "debate");

    const command = vi.mocked(childProcess.exec).mock.calls[0][0] as string;
    expect(command).toContain("토론 QA");
  });

  // ────────────────
  // 이슈 본문에 날짜 포함
  // ────────────────
  it("이슈 본문에 reportDate가 포함됨", async () => {
    setupExecMock();
    const result = makeQAResult("warn");
    await reportQAIssue(result, "2026-03-21", "daily");

    const command = vi.mocked(childProcess.exec).mock.calls[0][0] as string;
    expect(command).toContain("2026-03-21");
  });
});

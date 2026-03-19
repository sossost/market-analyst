import { describe, it, expect } from "vitest";
import { withDebateQAWarning } from "../run-debate-agent.js";
import type { ReportDraft } from "../reviewAgent.js";
import type { DebateQAResult } from "../debateQA.js";

// ────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────

function makeDraft(overrides?: Partial<ReportDraft>): ReportDraft {
  return {
    message: "📊 시황 브리핑 (2026-03-20)",
    markdownContent: "# Full report",
    filename: "briefing-2026-03-20.md",
    ...overrides,
  };
}

function makeQAResult(overrides?: Partial<DebateQAResult>): DebateQAResult {
  return {
    date: "2026-03-20",
    severity: "warn",
    mismatches: [
      {
        type: "sector_list",
        field: "bull_bias",
        expected: "bullish + bearish 균형",
        actual: "전체 3건 bullish, bearish 0건",
        severity: "warn",
      },
    ],
    checkedItems: 1,
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────

describe("withDebateQAWarning", () => {
  it("경고 블록을 첫 번째 draft 앞에 삽입한다", () => {
    const drafts = [makeDraft()];
    const qa = makeQAResult();

    const result = withDebateQAWarning(drafts, qa);
    expect(result[0].message).toContain("⚠️ **[투자 브리핑 데이터 정합성 경고]**");
    expect(result[0].message).toContain("bull_bias");
    // 원본 메시지도 포함되어 있어야 함
    expect(result[0].message).toContain("📊 시황 브리핑");
  });

  it("원본 drafts를 변경하지 않는다 (immutability)", () => {
    const drafts = [makeDraft()];
    const originalMessage = drafts[0].message;
    const qa = makeQAResult();

    withDebateQAWarning(drafts, qa);
    expect(drafts[0].message).toBe(originalMessage);
  });

  it("빈 drafts 배열이면 그대로 반환", () => {
    const qa = makeQAResult();
    const result = withDebateQAWarning([], qa);
    expect(result).toHaveLength(0);
  });

  it("여러 mismatch가 있으면 모두 경고 블록에 포함", () => {
    const drafts = [makeDraft()];
    const qa = makeQAResult({
      mismatches: [
        {
          type: "sector_list",
          field: "bull_bias",
          expected: "bullish + bearish 균형",
          actual: "전체 3건 bullish",
          severity: "warn",
        },
        {
          type: "symbol_phase",
          field: "NVDA.phase",
          expected: "Phase 2+",
          actual: "Phase 1",
          severity: "warn",
        },
      ],
    });

    const result = withDebateQAWarning(drafts, qa);
    expect(result[0].message).toContain("bull_bias");
    expect(result[0].message).toContain("NVDA.phase");
  });

  it("두 번째 이후 draft는 변경하지 않는다", () => {
    const drafts = [makeDraft(), makeDraft({ message: "Second draft" })];
    const qa = makeQAResult();

    const result = withDebateQAWarning(drafts, qa);
    expect(result).toHaveLength(2);
    expect(result[1].message).toBe("Second draft");
  });
});

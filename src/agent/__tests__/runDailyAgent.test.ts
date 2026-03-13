import { describe, it, expect } from "vitest";
import { withQAWarning } from "../run-daily-agent";
import type { ReportDraft } from "../reviewAgent";
import type { DailyQAResult } from "../dailyQA";

// ────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────

function makeDraft(message: string): ReportDraft {
  return { message };
}

function makeQAResult(
  severity: DailyQAResult["severity"],
  mismatches: DailyQAResult["mismatches"] = [],
): DailyQAResult {
  return {
    date: "2026-03-12",
    severity,
    mismatches,
    checkedItems: mismatches.length,
    checkedAt: new Date().toISOString(),
  };
}

// ────────────────────────────────────────────
// withQAWarning
// ────────────────────────────────────────────

describe("withQAWarning", () => {
  it("drafts가 빈 배열이면 원본 반환", () => {
    const qaResult = makeQAResult("warn", [
      { type: "phase2_ratio", field: "phase2Ratio", expected: 30.0, actual: 2850.0, severity: "warn" },
    ]);

    const result = withQAWarning([], qaResult);

    expect(result).toHaveLength(0);
  });

  it("warn severity — 첫 번째 draft 앞에 경고 블록 삽입", () => {
    const drafts = [makeDraft("original message")];
    const qaResult = makeQAResult("warn", [
      { type: "phase2_ratio", field: "phase2Ratio", expected: 30.0, actual: 2850.0, severity: "warn" },
    ]);

    const result = withQAWarning(drafts, qaResult);

    expect(result).toHaveLength(1);
    expect(result[0].message).toContain("⚠️ **[데이터 정합성 경고]**");
    expect(result[0].message).toContain("phase2Ratio");
    expect(result[0].message).toContain("original message");
  });

  it("block severity — 첫 번째 draft 앞에 경고 블록 삽입", () => {
    const drafts = [makeDraft("original message")];
    const qaResult = makeQAResult("block", [
      { type: "sector_list", field: "leadingSectors", expected: "Technology,Energy", actual: "Healthcare,Utilities", severity: "block" },
    ]);

    const result = withQAWarning(drafts, qaResult);

    expect(result[0].message).toContain("⚠️ **[데이터 정합성 경고]**");
    expect(result[0].message).toContain("leadingSectors");
  });

  it("여러 draft 중 첫 번째에만 경고 삽입, 나머지는 원본 유지", () => {
    const drafts = [makeDraft("first"), makeDraft("second"), makeDraft("third")];
    const qaResult = makeQAResult("warn", [
      { type: "phase2_ratio", field: "phase2Ratio", expected: 30.0, actual: 2850.0, severity: "warn" },
    ]);

    const result = withQAWarning(drafts, qaResult);

    expect(result).toHaveLength(3);
    expect(result[0].message).toContain("⚠️");
    expect(result[1].message).toBe("second");
    expect(result[2].message).toBe("third");
  });

  it("여러 mismatch — 모두 경고 블록에 포함", () => {
    const drafts = [makeDraft("message")];
    const qaResult = makeQAResult("warn", [
      { type: "phase2_ratio", field: "phase2Ratio", expected: 30.0, actual: 2850.0, severity: "warn" },
      { type: "sector_list", field: "leadingSectors", expected: "Technology", actual: "Healthcare", severity: "warn" },
    ]);

    const result = withQAWarning(drafts, qaResult);

    expect(result[0].message).toContain("phase2Ratio");
    expect(result[0].message).toContain("leadingSectors");
  });

  it("원본 drafts 배열을 변경하지 않는다 (불변성)", () => {
    const original = "original message";
    const drafts = [makeDraft(original)];
    const qaResult = makeQAResult("warn", [
      { type: "phase2_ratio", field: "phase2Ratio", expected: 30.0, actual: 100.0, severity: "warn" },
    ]);

    withQAWarning(drafts, qaResult);

    expect(drafts[0].message).toBe(original);
  });

  it("markdownContent와 filename은 첫 번째 draft에서 유지", () => {
    const drafts = [
      { message: "original", markdownContent: "# Report", filename: "daily-2026-03-12.md" },
    ];
    const qaResult = makeQAResult("warn", [
      { type: "phase2_ratio", field: "phase2Ratio", expected: 30.0, actual: 2850.0, severity: "warn" },
    ]);

    const result = withQAWarning(drafts, qaResult);

    expect(result[0].markdownContent).toBe("# Report");
    expect(result[0].filename).toBe("daily-2026-03-12.md");
  });
});

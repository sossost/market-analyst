import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  saveReviewFeedback,
  loadRecentFeedback,
  buildFeedbackPromptSection,
  type ReviewFeedbackEntry,
} from "@/agent/reviewFeedback";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeFeedback(overrides: Partial<ReviewFeedbackEntry> = {}): ReviewFeedbackEntry {
  return {
    date: "2026-03-04",
    verdict: "REVISE",
    feedback: "밸류에이션 리스크 경고 부족",
    issues: ["밸류에이션 리스크 경고 부족", "섹터 과집중 리스크 미언급"],
    ...overrides,
  };
}

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `review-feedback-test-${Date.now()}`);
});

afterEach(() => {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// saveReviewFeedback
// ---------------------------------------------------------------------------

describe("saveReviewFeedback", () => {
  it("creates the feedback directory if it does not exist", () => {
    const entry = makeFeedback();

    saveReviewFeedback(entry, testDir);

    expect(existsSync(testDir)).toBe(true);
  });

  it("saves a JSON file named by date", () => {
    const entry = makeFeedback({ date: "2026-03-04" });

    saveReviewFeedback(entry, testDir);

    const filePath = join(testDir, "2026-03-04.json");
    expect(existsSync(filePath)).toBe(true);
  });

  it("overwrites the file when saving for the same date", () => {
    const entry1 = makeFeedback({ feedback: "First feedback" });
    const entry2 = makeFeedback({ feedback: "Updated feedback" });

    saveReviewFeedback(entry1, testDir);
    saveReviewFeedback(entry2, testDir);

    const loaded = loadRecentFeedback(1, testDir);
    expect(loaded[0].feedback).toBe("Updated feedback");
  });
});

// ---------------------------------------------------------------------------
// loadRecentFeedback
// ---------------------------------------------------------------------------

describe("loadRecentFeedback", () => {
  it("returns empty array when directory does not exist", () => {
    const result = loadRecentFeedback(5, "/nonexistent/path/feedback");

    expect(result).toEqual([]);
  });

  it("returns empty array when directory is empty", () => {
    mkdirSync(testDir, { recursive: true });

    const result = loadRecentFeedback(5, testDir);

    expect(result).toEqual([]);
  });

  it("loads entries sorted by date descending", () => {
    mkdirSync(testDir, { recursive: true });

    const entry1 = makeFeedback({ date: "2026-03-01" });
    const entry2 = makeFeedback({ date: "2026-03-03" });
    const entry3 = makeFeedback({ date: "2026-03-02" });

    writeFileSync(join(testDir, "2026-03-01.json"), JSON.stringify(entry1));
    writeFileSync(join(testDir, "2026-03-03.json"), JSON.stringify(entry2));
    writeFileSync(join(testDir, "2026-03-02.json"), JSON.stringify(entry3));

    const result = loadRecentFeedback(5, testDir);

    expect(result).toHaveLength(3);
    expect(result[0].date).toBe("2026-03-03");
    expect(result[1].date).toBe("2026-03-02");
    expect(result[2].date).toBe("2026-03-01");
  });

  it("limits results to count parameter", () => {
    mkdirSync(testDir, { recursive: true });

    for (let i = 1; i <= 10; i++) {
      const date = `2026-03-${String(i).padStart(2, "0")}`;
      const entry = makeFeedback({ date });
      writeFileSync(join(testDir, `${date}.json`), JSON.stringify(entry));
    }

    const result = loadRecentFeedback(3, testDir);

    expect(result).toHaveLength(3);
    expect(result[0].date).toBe("2026-03-10");
  });

  it("ignores non-JSON files", () => {
    mkdirSync(testDir, { recursive: true });

    const entry = makeFeedback({ date: "2026-03-04" });
    writeFileSync(join(testDir, "2026-03-04.json"), JSON.stringify(entry));
    writeFileSync(join(testDir, "README.md"), "# Not feedback");

    const result = loadRecentFeedback(5, testDir);

    expect(result).toHaveLength(1);
  });

  it("roundtrips data correctly with saveReviewFeedback", () => {
    const entry = makeFeedback({
      date: "2026-03-04",
      verdict: "REJECT",
      feedback: "데이터 근거 없는 주장 다수",
      issues: ["No data backing", "Misleading conclusions"],
    });

    saveReviewFeedback(entry, testDir);
    const loaded = loadRecentFeedback(1, testDir);

    expect(loaded[0]).toEqual(entry);
  });
});

// ---------------------------------------------------------------------------
// buildFeedbackPromptSection
// ---------------------------------------------------------------------------

describe("buildFeedbackPromptSection", () => {
  it("returns empty string when entries are empty", () => {
    const result = buildFeedbackPromptSection([]);

    expect(result).toBe("");
  });

  it("includes header with entry count", () => {
    const entries = [makeFeedback()];

    const result = buildFeedbackPromptSection(entries);

    expect(result).toContain("최근 1회");
    expect(result).toContain("과거 리뷰 피드백");
  });

  it("includes date and verdict for each entry", () => {
    const entries = [
      makeFeedback({ date: "2026-03-04", verdict: "REVISE" }),
      makeFeedback({ date: "2026-03-03", verdict: "REJECT" }),
    ];

    const result = buildFeedbackPromptSection(entries);

    expect(result).toContain("### 2026-03-04 (REVISE)");
    expect(result).toContain("### 2026-03-03 (REJECT)");
  });

  it("lists issues as bullet points", () => {
    const entries = [
      makeFeedback({ issues: ["밸류에이션 리스크 경고 부족", "섹터 과집중 리스크 미언급"] }),
    ];

    const result = buildFeedbackPromptSection(entries);

    expect(result).toContain("- 밸류에이션 리스크 경고 부족");
    expect(result).toContain("- 섹터 과집중 리스크 미언급");
  });

  it("includes instruction to reflect feedback", () => {
    const entries = [makeFeedback()];

    const result = buildFeedbackPromptSection(entries);

    expect(result).toContain("이번 리포트 작성 시 반드시 반영하세요");
  });
});

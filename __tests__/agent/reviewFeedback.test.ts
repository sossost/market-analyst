import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  saveReviewFeedback,
  loadRecentFeedback,
  buildFeedbackPromptSection,
  detectRepeatedPatterns,
  buildMandatoryRules,
  buildAdvisoryFeedback,
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
      makeFeedback({ date: "2026-03-04", verdict: "REVISE", issues: ["밸류에이션 분석 부재"] }),
      makeFeedback({ date: "2026-03-03", verdict: "REJECT", issues: ["차트 포맷 오류 발견"] }),
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

  it("includes feedback prose text, not just issues", () => {
    const entries = [
      makeFeedback({ feedback: "리스크 분석이 전반적으로 부족합니다" }),
    ];

    const result = buildFeedbackPromptSection(entries);

    expect(result).toContain("리스크 분석이 전반적으로 부족합니다");
  });

  it("handles entry with empty issues array gracefully", () => {
    const entries = [
      makeFeedback({ issues: [], feedback: "전반적으로 양호하나 소폭 수정 필요" }),
    ];

    const result = buildFeedbackPromptSection(entries);

    expect(result).toContain("### 2026-03-04 (REVISE)");
    expect(result).toContain("전반적으로 양호하나 소폭 수정 필요");
  });
});

// ---------------------------------------------------------------------------
// loadRecentFeedback — corrupt file handling
// ---------------------------------------------------------------------------

describe("loadRecentFeedback (corrupt files)", () => {
  it("skips corrupt JSON files and returns valid entries only", () => {
    mkdirSync(testDir, { recursive: true });

    const validEntry = makeFeedback({ date: "2026-03-04" });
    writeFileSync(join(testDir, "2026-03-04.json"), JSON.stringify(validEntry));
    writeFileSync(join(testDir, "2026-03-03.json"), "not valid json{{{");

    const result = loadRecentFeedback(5, testDir);

    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-03-04");
  });

  it("ignores files that do not match YYYY-MM-DD.json format", () => {
    mkdirSync(testDir, { recursive: true });

    const validEntry = makeFeedback({ date: "2026-03-04" });
    writeFileSync(join(testDir, "2026-03-04.json"), JSON.stringify(validEntry));
    writeFileSync(join(testDir, "notes.json"), '{"random": true}');
    writeFileSync(join(testDir, "2026-3-4.json"), '{"unpadded": true}');

    const result = loadRecentFeedback(5, testDir);

    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-03-04");
  });
});

// ---------------------------------------------------------------------------
// detectRepeatedPatterns
// ---------------------------------------------------------------------------

describe("detectRepeatedPatterns", () => {
  it("returns empty array when entries have no issues", () => {
    const entries = [makeFeedback({ issues: [] })];

    const result = detectRepeatedPatterns(entries);

    expect(result).toEqual([]);
  });

  it("returns empty array when no pattern reaches threshold", () => {
    const entries = [
      makeFeedback({ date: "2026-03-01", issues: ["밸류에이션 리스크 경고 부족"] }),
    ];

    const result = detectRepeatedPatterns(entries);

    expect(result).toEqual([]);
  });

  it("detects pattern when same issue appears 2+ times (default threshold)", () => {
    const entries = [
      makeFeedback({ date: "2026-03-01", issues: ["밸류에이션 리스크 경고 부족"] }),
      makeFeedback({ date: "2026-03-02", issues: ["밸류에이션 리스크 경고 미흡"] }),
    ];

    const result = detectRepeatedPatterns(entries);

    expect(result).toHaveLength(1);
    expect(result[0].count).toBeGreaterThanOrEqual(2);
    expect(result[0].pattern).toContain("밸류에이션");
  });

  it("detects pattern when same issue appears 3+ times", () => {
    const entries = [
      makeFeedback({ date: "2026-03-01", issues: ["밸류에이션 리스크 경고 부족"] }),
      makeFeedback({ date: "2026-03-02", issues: ["밸류에이션 리스크 경고 미흡"] }),
      makeFeedback({ date: "2026-03-03", issues: ["밸류에이션 리스크 분석 부족"] }),
    ];

    const result = detectRepeatedPatterns(entries);

    expect(result).toHaveLength(1);
    expect(result[0].count).toBeGreaterThanOrEqual(3);
    expect(result[0].pattern).toContain("밸류에이션");
    expect(result[0].rule).toContain("과거");
  });

  it("supports custom threshold", () => {
    const entries = [
      makeFeedback({ date: "2026-03-01", issues: ["근거 부족한 주장"] }),
      makeFeedback({ date: "2026-03-02", issues: ["근거 부족한 분석"] }),
    ];

    const result = detectRepeatedPatterns(entries, 2);

    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(2);
  });

  it("detects multiple distinct repeated patterns", () => {
    const entries = [
      makeFeedback({ date: "2026-03-01", issues: ["밸류에이션 분석 미흡 평가", "카탈리스트 검색 누락 종목"] }),
      makeFeedback({ date: "2026-03-02", issues: ["밸류에이션 분석 부족 평가", "카탈리스트 검색 미실행 종목"] }),
      makeFeedback({ date: "2026-03-03", issues: ["밸류에이션 분석 경고 평가", "카탈리스트 검색 생략 종목"] }),
    ];

    const result = detectRepeatedPatterns(entries);

    expect(result).toHaveLength(2);
  });

  it("returns empty array when entries are empty", () => {
    const result = detectRepeatedPatterns([]);

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildMandatoryRules
// ---------------------------------------------------------------------------

describe("buildMandatoryRules", () => {
  it("returns empty string when no repeated patterns exist", () => {
    const entries = [
      makeFeedback({ date: "2026-03-01", issues: ["일회성 이슈"] }),
    ];

    const result = buildMandatoryRules(entries);

    expect(result).toBe("");
  });

  it("returns mandatory rules section for repeated patterns", () => {
    const entries = [
      makeFeedback({ date: "2026-03-01", issues: ["밸류에이션 리스크 경고 부족"] }),
      makeFeedback({ date: "2026-03-02", issues: ["밸류에이션 리스크 분석 부족"] }),
      makeFeedback({ date: "2026-03-03", issues: ["밸류에이션 리스크 경고 미흡"] }),
    ];

    const result = buildMandatoryRules(entries);

    expect(result).toContain("## 필수 규칙 (반복 지적 기반)");
    expect(result).toContain("반드시 준수하세요");
    expect(result).toContain("과거");
    expect(result).toContain("회 지적");
  });

  it("returns empty string for empty entries", () => {
    const result = buildMandatoryRules([]);

    expect(result).toBe("");
  });
});

// ---------------------------------------------------------------------------
// buildAdvisoryFeedback
// ---------------------------------------------------------------------------

describe("buildAdvisoryFeedback", () => {
  it("returns only non-repeated issues", () => {
    const entries = [
      makeFeedback({ date: "2026-03-01", feedback: "피드백 내용 A", issues: ["밸류에이션 분석 경고 평가", "차트 포맷 개선 필요"] }),
      makeFeedback({ date: "2026-03-02", feedback: "피드백 내용 B", issues: ["밸류에이션 분석 부족 평가", "마크다운 링크 오류"] }),
      makeFeedback({ date: "2026-03-03", feedback: "피드백 내용 C", issues: ["밸류에이션 분석 미흡 평가", "타이틀 오타 수정"] }),
    ];

    const result = buildAdvisoryFeedback(entries);

    // 반복 이슈는 제외되고 비반복 이슈만 포함
    expect(result).toContain("차트 포맷");
    expect(result).toContain("마크다운 링크");
    expect(result).toContain("타이틀 오타");
    expect(result).toContain("## 과거 리뷰 피드백 (참고사항)");
  });

  it("returns empty string when all issues are repeated patterns", () => {
    const entries = [
      makeFeedback({ date: "2026-03-01", issues: ["밸류에이션 리스크 경고 부족"] }),
      makeFeedback({ date: "2026-03-02", issues: ["밸류에이션 리스크 분석 부족"] }),
      makeFeedback({ date: "2026-03-03", issues: ["밸류에이션 리스크 경고 미흡"] }),
    ];

    const result = buildAdvisoryFeedback(entries);

    expect(result).toBe("");
  });

  it("returns empty string for empty entries", () => {
    const result = buildAdvisoryFeedback([]);

    expect(result).toBe("");
  });

  it("preserves date and verdict in advisory entries", () => {
    const entries = [
      makeFeedback({ date: "2026-03-04", verdict: "REVISE", issues: ["고유한 이슈 분석"] }),
    ];

    const result = buildAdvisoryFeedback(entries);

    expect(result).toContain("### 2026-03-04 (REVISE)");
  });
});

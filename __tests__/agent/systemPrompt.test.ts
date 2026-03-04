import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock reviewFeedback — must be before importing systemPrompt
// ---------------------------------------------------------------------------

const mockLoadRecentFeedback = vi.fn();
const mockBuildFeedbackPromptSection = vi.fn();

vi.mock("@/agent/reviewFeedback", () => ({
  loadRecentFeedback: mockLoadRecentFeedback,
  buildFeedbackPromptSection: mockBuildFeedbackPromptSection,
}));

const { buildDailySystemPrompt, buildWeeklySystemPrompt } =
  await import("@/agent/systemPrompt");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildDailySystemPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns base prompt without feedback section when no feedback exists", () => {
    mockLoadRecentFeedback.mockReturnValue([]);

    const result = buildDailySystemPrompt();

    expect(result).toContain("미국 주식 시장 분석 전문가 Agent");
    expect(result).toContain("시장 온도");
    expect(mockBuildFeedbackPromptSection).not.toHaveBeenCalled();
  });

  it("appends feedback section when feedback entries exist", () => {
    const entries = [
      {
        date: "2026-03-04",
        verdict: "REVISE",
        feedback: "리스크 부족",
        issues: ["밸류에이션 리스크 경고 부족"],
      },
    ];
    mockLoadRecentFeedback.mockReturnValue(entries);
    mockBuildFeedbackPromptSection.mockReturnValue("## 과거 리뷰 피드백\n- 밸류에이션 리스크 경고 부족");

    const result = buildDailySystemPrompt();

    expect(result).toContain("## 과거 리뷰 피드백");
    expect(result).toContain("밸류에이션 리스크 경고 부족");
    expect(mockBuildFeedbackPromptSection).toHaveBeenCalledWith(entries);
  });

  it("calls loadRecentFeedback with default count", () => {
    mockLoadRecentFeedback.mockReturnValue([]);

    buildDailySystemPrompt();

    expect(mockLoadRecentFeedback).toHaveBeenCalledWith();
  });
});

describe("buildWeeklySystemPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns base prompt without feedback section when no feedback exists", () => {
    mockLoadRecentFeedback.mockReturnValue([]);

    const result = buildWeeklySystemPrompt();

    expect(result).toContain("미국 주식 시장 분석 전문가 Agent");
    expect(result).toContain("Phase 2 초입 주도주");
    expect(mockBuildFeedbackPromptSection).not.toHaveBeenCalled();
  });

  it("appends feedback section when feedback entries exist", () => {
    const entries = [
      {
        date: "2026-03-03",
        verdict: "REJECT",
        feedback: "데이터 근거 없음",
        issues: ["No data backing claims"],
      },
    ];
    mockLoadRecentFeedback.mockReturnValue(entries);
    mockBuildFeedbackPromptSection.mockReturnValue("## 과거 리뷰 피드백\n- No data backing claims");

    const result = buildWeeklySystemPrompt();

    expect(result).toContain("## 과거 리뷰 피드백");
    expect(result).toContain("No data backing claims");
  });
});

import { describe, it, expect } from "vitest";
import { draftsToFullContent } from "../reviewAgent";
import type { ReportDraft } from "../reviewAgent";

describe("draftsToFullContent", () => {
  it("단일 draft — markdownContent가 있으면 markdownContent 사용", () => {
    const drafts: ReportDraft[] = [
      { message: "Discord summary", markdownContent: "# Full Report\n\nDetailed analysis." },
    ];

    const result = draftsToFullContent(drafts);

    expect(result).toBe("# Full Report\n\nDetailed analysis.");
  });

  it("단일 draft — markdownContent가 없으면 message fallback", () => {
    const drafts: ReportDraft[] = [
      { message: "Discord only message" },
    ];

    const result = draftsToFullContent(drafts);

    expect(result).toBe("Discord only message");
  });

  it("복수 draft — separator로 연결", () => {
    const drafts: ReportDraft[] = [
      { message: "Part 1", markdownContent: "# Part 1 Detail" },
      { message: "Part 2" },
    ];

    const result = draftsToFullContent(drafts);

    expect(result).toBe("# Part 1 Detail\n\n---\n\nPart 2");
  });

  it("빈 배열 — 빈 문자열 반환", () => {
    const result = draftsToFullContent([]);

    expect(result).toBe("");
  });
});

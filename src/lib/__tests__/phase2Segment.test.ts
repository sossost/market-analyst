import { describe, it, expect } from "vitest";
import {
  classifyPhase2Segment,
  computePhase2SinceDays,
  getPhase2SegmentInfo,
} from "@/lib/phase2Segment.js";

describe("classifyPhase2Segment", () => {
  it("returns 초입 for days 1~5", () => {
    expect(classifyPhase2Segment(1)).toBe("초입");
    expect(classifyPhase2Segment(3)).toBe("초입");
    expect(classifyPhase2Segment(5)).toBe("초입");
  });

  it("returns 진행 for days 6~20", () => {
    expect(classifyPhase2Segment(6)).toBe("진행");
    expect(classifyPhase2Segment(13)).toBe("진행");
    expect(classifyPhase2Segment(20)).toBe("진행");
  });

  it("returns 확립 for days 21+", () => {
    expect(classifyPhase2Segment(21)).toBe("확립");
    expect(classifyPhase2Segment(50)).toBe("확립");
    expect(classifyPhase2Segment(100)).toBe("확립");
  });
});

describe("computePhase2SinceDays", () => {
  it("returns null for null phase2Since", () => {
    expect(computePhase2SinceDays(null)).toBe(null);
  });

  it("returns null for invalid date string", () => {
    expect(computePhase2SinceDays("not-a-date")).toBe(null);
  });

  it("computes correct days between two dates (start day = day 1)", () => {
    expect(computePhase2SinceDays("2026-04-10", "2026-04-14")).toBe(5);
    expect(computePhase2SinceDays("2026-04-01", "2026-04-14")).toBe(14);
    expect(computePhase2SinceDays("2026-03-20", "2026-04-14")).toBe(26);
  });

  it("returns minimum 1 day for same-day or future dates", () => {
    expect(computePhase2SinceDays("2026-04-14", "2026-04-14")).toBe(1);
    expect(computePhase2SinceDays("2026-04-15", "2026-04-14")).toBe(1);
  });
});

describe("getPhase2SegmentInfo", () => {
  it("returns null for null phase2Since", () => {
    expect(getPhase2SegmentInfo(null)).toBe(null);
  });

  it("returns days and segment for valid dates", () => {
    const result = getPhase2SegmentInfo("2026-04-12", "2026-04-14");
    expect(result).toEqual({ days: 3, segment: "초입" });
  });

  it("returns 진행 segment for 10-day gap", () => {
    const result = getPhase2SegmentInfo("2026-04-04", "2026-04-14");
    expect(result).toEqual({ days: 11, segment: "진행" });
  });

  it("returns 확립 segment for 30-day gap", () => {
    const result = getPhase2SegmentInfo("2026-03-15", "2026-04-14");
    expect(result).toEqual({ days: 31, segment: "확립" });
  });
});

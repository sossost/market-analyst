import { describe, it, expect } from "vitest";
import { parseJudgments, calcElapsedDays, findHighProgressHolds } from "@/debate/thesisVerifier";

describe("parseJudgments", () => {
  const validIds = [1, 2, 3, 5];

  it("parses valid JSON array", () => {
    const raw = `[
      { "thesisId": 1, "verdict": "CONFIRMED", "reason": "조건 충족" },
      { "thesisId": 2, "verdict": "HOLD", "reason": "데이터 부족" },
      { "thesisId": 3, "verdict": "INVALIDATED", "reason": "반대 방향" }
    ]`;

    const result = parseJudgments(raw, validIds);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ thesisId: 1, verdict: "CONFIRMED", reason: "조건 충족" });
    expect(result[1]).toEqual({ thesisId: 2, verdict: "HOLD", reason: "데이터 부족" });
    expect(result[2]).toEqual({ thesisId: 3, verdict: "INVALIDATED", reason: "반대 방향" });
  });

  it("handles code-fenced JSON", () => {
    const raw = "```json\n[{\"thesisId\": 1, \"verdict\": \"HOLD\", \"reason\": \"유지\"}]\n```";
    const result = parseJudgments(raw, validIds);
    expect(result).toHaveLength(1);
    expect(result[0].verdict).toBe("HOLD");
  });

  it("filters out invalid thesis IDs", () => {
    const raw = `[
      { "thesisId": 1, "verdict": "CONFIRMED", "reason": "ok" },
      { "thesisId": 999, "verdict": "CONFIRMED", "reason": "invalid id" }
    ]`;
    const result = parseJudgments(raw, validIds);
    expect(result).toHaveLength(1);
    expect(result[0].thesisId).toBe(1);
  });

  it("filters out invalid verdicts", () => {
    const raw = `[
      { "thesisId": 1, "verdict": "MAYBE", "reason": "invalid verdict" },
      { "thesisId": 2, "verdict": "CONFIRMED", "reason": "valid" }
    ]`;
    const result = parseJudgments(raw, validIds);
    expect(result).toHaveLength(1);
    expect(result[0].verdict).toBe("CONFIRMED");
  });

  it("returns empty array for non-JSON response", () => {
    const raw = "이것은 JSON이 아닙니다. 검증 결과를 정리하겠습니다.";
    const result = parseJudgments(raw, validIds);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for malformed JSON", () => {
    const raw = "[{thesisId: 1, verdict: CONFIRMED}]";
    const result = parseJudgments(raw, validIds);
    expect(result).toHaveLength(0);
  });

  it("handles text before and after JSON array", () => {
    const raw = "검증 결과:\n[{\"thesisId\": 1, \"verdict\": \"HOLD\", \"reason\": \"대기\"}]\n추가 설명";
    const result = parseJudgments(raw, validIds);
    expect(result).toHaveLength(1);
  });

  it("filters items with missing fields", () => {
    const raw = `[
      { "thesisId": 1, "verdict": "CONFIRMED" },
      { "thesisId": 2, "verdict": "HOLD", "reason": "ok" }
    ]`;
    const result = parseJudgments(raw, validIds);
    expect(result).toHaveLength(1);
    expect(result[0].thesisId).toBe(2);
  });
});

describe("calcElapsedDays", () => {
  it("returns 0 when debateDate and currentDate are the same", () => {
    expect(calcElapsedDays("2025-01-01", "2025-01-01")).toBe(0);
  });

  it("returns correct elapsed days for a 30-day gap", () => {
    expect(calcElapsedDays("2025-01-01", "2025-01-31")).toBe(30);
  });

  it("returns 0 when currentDate is before debateDate (guard against negative)", () => {
    expect(calcElapsedDays("2025-02-01", "2025-01-01")).toBe(0);
  });

  it("returns correct elapsed days across month boundary", () => {
    expect(calcElapsedDays("2025-01-20", "2025-02-19")).toBe(30);
  });

  it("returns 0 for invalid date strings", () => {
    expect(calcElapsedDays("", "2025-01-01")).toBe(0);
    expect(calcElapsedDays("not-a-date", "2025-01-01")).toBe(0);
    expect(calcElapsedDays("2025-01-01", "")).toBe(0);
  });
});

describe("findHighProgressHolds", () => {
  const makeHeld = (thesisId: number) => ({
    thesisId,
    verdict: "HOLD" as const,
    reason: "데이터 부족",
  });

  it("진행률 50% 이상 HOLD thesis ID를 반환한다", () => {
    const thesisMap = new Map([
      [1, { debateDate: "2025-01-01", timeframeDays: 30 }], // 25일 경과 = 83%
    ]);

    const result = findHighProgressHolds([makeHeld(1)], thesisMap, "2025-01-26");

    expect(result).toEqual([1]);
  });

  it("진행률 50% 미만 HOLD thesis는 포함하지 않는다", () => {
    const thesisMap = new Map([
      [1, { debateDate: "2025-01-01", timeframeDays: 30 }], // 10일 경과 = 33%
    ]);

    const result = findHighProgressHolds([makeHeld(1)], thesisMap, "2025-01-11");

    expect(result).toEqual([]);
  });

  it("정확히 50%인 thesis는 강제 만료 대상이다", () => {
    const thesisMap = new Map([
      [1, { debateDate: "2025-01-01", timeframeDays: 30 }], // 15일 경과 = 50%
    ]);

    const result = findHighProgressHolds([makeHeld(1)], thesisMap, "2025-01-16");

    expect(result).toEqual([1]);
  });

  it("혼합: 고진행률 1건 + 저진행률 1건 → 고진행률만 반환", () => {
    const thesisMap = new Map([
      [1, { debateDate: "2025-01-01", timeframeDays: 30 }], // 25일 = 83%
      [2, { debateDate: "2025-01-15", timeframeDays: 60 }], // 11일 = 18%
    ]);

    const result = findHighProgressHolds(
      [makeHeld(1), makeHeld(2)],
      thesisMap,
      "2025-01-26",
    );

    expect(result).toEqual([1]);
  });

  it("thesisMap에 없는 thesis ID는 무시한다", () => {
    const thesisMap = new Map<number, { debateDate: string; timeframeDays: number }>();

    const result = findHighProgressHolds([makeHeld(999)], thesisMap, "2025-01-26");

    expect(result).toEqual([]);
  });

  it("빈 heldJudgments → 빈 배열", () => {
    const thesisMap = new Map([
      [1, { debateDate: "2025-01-01", timeframeDays: 30 }],
    ]);

    const result = findHighProgressHolds([], thesisMap, "2025-01-26");

    expect(result).toEqual([]);
  });

  it("timeframeDays가 0인 thesis는 강제 만료 대상이 아니다", () => {
    const thesisMap = new Map([
      [1, { debateDate: "2025-01-01", timeframeDays: 0 }],
    ]);

    const result = findHighProgressHolds([makeHeld(1)], thesisMap, "2025-01-26");

    expect(result).toEqual([]);
  });
});

/**
 * qualityFilter 순수 함수 단위 테스트
 */

import { describe, it, expect } from "vitest";
import { clampScore, parseQualityScore } from "../qualityFilter.js";

describe("clampScore", () => {
  it("1~5 범위 내 정수를 그대로 반환한다", () => {
    expect(clampScore(1)).toBe(1);
    expect(clampScore(3)).toBe(3);
    expect(clampScore(5)).toBe(5);
  });

  it("1 미만 값을 1로 클램핑한다", () => {
    expect(clampScore(0)).toBe(1);
    expect(clampScore(-10)).toBe(1);
  });

  it("5 초과 값을 5로 클램핑한다", () => {
    expect(clampScore(6)).toBe(5);
    expect(clampScore(100)).toBe(5);
  });

  it("소수를 반올림한 뒤 클램핑한다", () => {
    expect(clampScore(2.4)).toBe(2);
    expect(clampScore(2.6)).toBe(3);
  });

  it("NaN에 대해 1을 반환한다 (폴백)", () => {
    expect(clampScore(NaN)).toBe(1);
    expect(clampScore("not-a-number")).toBe(1);
  });

  it("Infinity에 대해 1을 반환한다 (폴백)", () => {
    expect(clampScore(Infinity)).toBe(1);
    expect(clampScore(-Infinity)).toBe(1);
  });

  it("null/undefined에 대해 1을 반환한다 (폴백)", () => {
    expect(clampScore(null)).toBe(1);
    expect(clampScore(undefined)).toBe(1);
  });

  it("숫자 형태의 문자열을 변환해 처리한다", () => {
    expect(clampScore("4")).toBe(4);
  });
});

describe("parseQualityScore", () => {
  it("올바른 JSON에서 점수를 파싱하고 total을 계산한다", () => {
    const content = '{"specificity": 4, "goalAlignment": 5, "actionability": 3, "evidenceSufficiency": 4}';
    const score = parseQualityScore(content);
    expect(score.specificity).toBe(4);
    expect(score.goalAlignment).toBe(5);
    expect(score.actionability).toBe(3);
    expect(score.evidenceSufficiency).toBe(4);
    expect(score.total).toBe(16);
  });

  it("JSON 외 텍스트가 섞인 응답에서도 JSON 블록을 추출한다", () => {
    const content = '다음과 같이 평가합니다:\n{"specificity": 3, "goalAlignment": 3, "actionability": 3, "evidenceSufficiency": 3}\n감사합니다';
    const score = parseQualityScore(content);
    expect(score.total).toBe(12);
  });

  it("JSON이 없는 응답에 대해 폴백 점수(4점)를 반환한다", () => {
    const score = parseQualityScore("JSON 없는 텍스트 응답");
    expect(score.total).toBe(4);
    expect(score.specificity).toBe(1);
  });

  it("유효하지 않은 JSON에 대해 폴백 점수를 반환한다", () => {
    const score = parseQualityScore("{invalid json}");
    expect(score.total).toBe(4);
  });

  it("5 초과 점수를 5로 클램핑한다", () => {
    const content = '{"specificity": 10, "goalAlignment": 5, "actionability": 5, "evidenceSufficiency": 5}';
    const score = parseQualityScore(content);
    expect(score.specificity).toBe(5);
    expect(score.total).toBe(20);
  });

  it("1 미만 점수를 1로 클램핑한다", () => {
    const content = '{"specificity": 0, "goalAlignment": 1, "actionability": 1, "evidenceSufficiency": 1}';
    const score = parseQualityScore(content);
    expect(score.specificity).toBe(1);
    expect(score.total).toBe(4);
  });
});

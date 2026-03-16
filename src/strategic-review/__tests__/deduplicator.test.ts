/**
 * deduplicator 순수 함수 단위 테스트
 */

import { describe, it, expect } from "vitest";
import { jaccardSimilarity, tokenize } from "../deduplicator.js";

describe("tokenize", () => {
  it("소문자로 변환하고 단어 단위로 분리한다", () => {
    const tokens = tokenize("Phase 2 detection");
    expect(tokens.has("phase")).toBe(true);
    expect(tokens.has("detection")).toBe(true);
  });

  it("특수문자를 공백으로 처리한다", () => {
    const tokens = tokenize("phase-detection.ts: 임계값");
    expect(tokens.has("phase")).toBe(true);
    expect(tokens.has("detection")).toBe(true);
    expect(tokens.has("ts")).toBe(true);
    expect(tokens.has("임계값")).toBe(true);
  });

  it("길이 1 이하 토큰을 제거한다", () => {
    const tokens = tokenize("a b cc");
    expect(tokens.has("a")).toBe(false);
    expect(tokens.has("b")).toBe(false);
    expect(tokens.has("cc")).toBe(true);
  });

  it("중복 단어는 집합으로 하나만 유지한다", () => {
    const tokens = tokenize("phase phase detection");
    expect(tokens.size).toBe(2);
  });

  it("빈 문자열에 대해 빈 집합을 반환한다", () => {
    const tokens = tokenize("");
    expect(tokens.size).toBe(0);
  });
});

describe("jaccardSimilarity", () => {
  it("동일한 집합에 대해 1.0을 반환한다", () => {
    const a = new Set(["phase", "detection", "logic"]);
    const b = new Set(["phase", "detection", "logic"]);
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it("교집합이 없는 경우 0을 반환한다", () => {
    const a = new Set(["phase", "detection"]);
    const b = new Set(["learning", "loop"]);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it("두 집합이 모두 빈 경우 1을 반환한다", () => {
    const a = new Set<string>();
    const b = new Set<string>();
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it("부분 교집합에 대해 올바른 유사도를 계산한다", () => {
    // A = {a, b, c}, B = {b, c, d} → 교집합 = {b, c}, 합집합 = {a, b, c, d}
    // Jaccard = 2 / 4 = 0.5
    const a = new Set(["aa", "bb", "cc"]);
    const b = new Set(["bb", "cc", "dd"]);
    expect(jaccardSimilarity(a, b)).toBeCloseTo(0.5);
  });

  it("한 집합이 다른 집합의 부분집합인 경우 올바른 유사도를 계산한다", () => {
    // A = {a, b}, B = {a, b, c, d} → 교집합 = {a, b}, 합집합 = {a, b, c, d}
    // Jaccard = 2 / 4 = 0.5
    const a = new Set(["aa", "bb"]);
    const b = new Set(["aa", "bb", "cc", "dd"]);
    expect(jaccardSimilarity(a, b)).toBeCloseTo(0.5);
  });
});

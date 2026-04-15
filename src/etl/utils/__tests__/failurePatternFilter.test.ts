import { describe, it, expect } from "vitest";
import {
  deriveConditionKeys,
  parsePatternConditions,
  matchesPattern,
  findMatchingPattern,
  deriveBreadthDirection,
  type CandidateConditions,
} from "../failurePatternFilter.js";
import type { ActiveFailurePatternRow } from "@/db/repositories/failurePatternRepository.js";

// ─── deriveConditionKeys ────────────────────────────────────────────────────

describe("deriveConditionKeys", () => {
  it("모든 조건이 있으면 3개 키를 생성한다", () => {
    const keys = deriveConditionKeys({
      sepaGrade: "B",
      volumeConfirmed: true,
      breadthDirection: "improving",
    });

    expect(keys).toEqual(
      expect.arrayContaining([
        "breadth:improving",
        "volume:true",
        "sepa:B",
      ]),
    );
    expect(keys).toHaveLength(3);
  });

  it("C 등급은 C-F로 그룹화한다", () => {
    const keys = deriveConditionKeys({
      sepaGrade: "C",
      volumeConfirmed: null,
      breadthDirection: null,
    });

    expect(keys).toContain("sepa:C-F");
    expect(keys).not.toContain("sepa:C");
  });

  it("F 등급은 C-F로 그룹화한다", () => {
    const keys = deriveConditionKeys({
      sepaGrade: "F",
      volumeConfirmed: null,
      breadthDirection: null,
    });

    expect(keys).toContain("sepa:C-F");
  });

  it("S, A, B 등급은 그대로 유지한다", () => {
    expect(deriveConditionKeys({ sepaGrade: "S", volumeConfirmed: null, breadthDirection: null }))
      .toContain("sepa:S");
    expect(deriveConditionKeys({ sepaGrade: "A", volumeConfirmed: null, breadthDirection: null }))
      .toContain("sepa:A");
    expect(deriveConditionKeys({ sepaGrade: "B", volumeConfirmed: null, breadthDirection: null }))
      .toContain("sepa:B");
  });

  it("null 값은 건너뛴다", () => {
    const keys = deriveConditionKeys({
      sepaGrade: null,
      volumeConfirmed: null,
      breadthDirection: null,
    });

    expect(keys).toHaveLength(0);
  });

  it("일부만 있으면 해당 키만 생성한다", () => {
    const keys = deriveConditionKeys({
      sepaGrade: "A",
      volumeConfirmed: null,
      breadthDirection: "declining",
    });

    expect(keys).toEqual(
      expect.arrayContaining(["breadth:declining", "sepa:A"]),
    );
    expect(keys).toHaveLength(2);
  });

  it("volumeConfirmed false도 키로 생성한다", () => {
    const keys = deriveConditionKeys({
      sepaGrade: null,
      volumeConfirmed: false,
      breadthDirection: null,
    });

    expect(keys).toContain("volume:false");
  });
});

// ─── parsePatternConditions ─────────────────────────────────────────────────

describe("parsePatternConditions", () => {
  it("단일 조건을 파싱한다", () => {
    expect(parsePatternConditions("sepa:C-F")).toEqual(["sepa:C-F"]);
  });

  it("2개 조합을 파싱한다", () => {
    expect(parsePatternConditions("breadth:declining|sepa:C-F")).toEqual([
      "breadth:declining",
      "sepa:C-F",
    ]);
  });

  it("빈 문자열은 빈 배열을 반환한다", () => {
    expect(parsePatternConditions("")).toEqual([]);
  });
});

// ─── matchesPattern ─────────────────────────────────────────────────────────

describe("matchesPattern", () => {
  it("모든 조건이 포함되면 매칭한다", () => {
    const candidateKeys = new Set(["breadth:declining", "sepa:C-F", "volume:false"]);
    expect(matchesPattern(candidateKeys, ["breadth:declining", "sepa:C-F"])).toBe(true);
  });

  it("일부 조건이 누락되면 매칭하지 않는다", () => {
    const candidateKeys = new Set(["sepa:C-F"]);
    expect(matchesPattern(candidateKeys, ["breadth:declining", "sepa:C-F"])).toBe(false);
  });

  it("단일 조건 매칭", () => {
    const candidateKeys = new Set(["sepa:C-F", "volume:true"]);
    expect(matchesPattern(candidateKeys, ["sepa:C-F"])).toBe(true);
  });

  it("빈 후보 키는 매칭하지 않는다", () => {
    const candidateKeys = new Set<string>();
    expect(matchesPattern(candidateKeys, ["sepa:C-F"])).toBe(false);
  });

  it("빈 패턴 조건은 매칭하지 않는다", () => {
    const candidateKeys = new Set(["sepa:B", "volume:true"]);
    expect(matchesPattern(candidateKeys, [])).toBe(false);
  });
});

// ─── findMatchingPattern ────────────────────────────────────────────────────

describe("findMatchingPattern", () => {
  const patterns: ActiveFailurePatternRow[] = [
    {
      patternName: "펀더멘탈 부실",
      conditions: "sepa:C-F",
      failureRate: "0.8500",
      failureCount: 17,
      totalCount: 20,
    },
    {
      patternName: "브레드스 악화 + 거래량 미확인",
      conditions: "breadth:declining|volume:false",
      failureRate: "0.7500",
      failureCount: 15,
      totalCount: 20,
    },
  ];

  it("매칭되는 패턴이 있으면 첫 번째 매칭을 반환한다", () => {
    const result = findMatchingPattern(
      { sepaGrade: "C", volumeConfirmed: true, breadthDirection: "improving" },
      patterns,
    );

    expect(result).not.toBeNull();
    expect(result!.patternName).toBe("펀더멘탈 부실");
    expect(result!.failureRate).toBe(0.85);
  });

  it("2개 조건 조합 패턴이 매칭된다", () => {
    const result = findMatchingPattern(
      { sepaGrade: "A", volumeConfirmed: false, breadthDirection: "declining" },
      patterns,
    );

    expect(result).not.toBeNull();
    expect(result!.patternName).toBe("브레드스 악화 + 거래량 미확인");
  });

  it("매칭되는 패턴이 없으면 null을 반환한다", () => {
    const result = findMatchingPattern(
      { sepaGrade: "A", volumeConfirmed: true, breadthDirection: "improving" },
      patterns,
    );

    expect(result).toBeNull();
  });

  it("패턴 목록이 비어있으면 null을 반환한다", () => {
    const result = findMatchingPattern(
      { sepaGrade: "C", volumeConfirmed: true, breadthDirection: "declining" },
      [],
    );

    expect(result).toBeNull();
  });

  it("후보 조건이 모두 null이면 null을 반환한다 (패스스루)", () => {
    const result = findMatchingPattern(
      { sepaGrade: null, volumeConfirmed: null, breadthDirection: null },
      patterns,
    );

    expect(result).toBeNull();
  });

  it("sectorRsIsolated 조건 패턴은 매칭되지 않는다 (미구현 fail-safe)", () => {
    const sectorPattern: ActiveFailurePatternRow[] = [
      {
        patternName: "섹터 고립 상승",
        conditions: "sector_isolated:true",
        failureRate: "0.8000",
        failureCount: 16,
        totalCount: 20,
      },
    ];

    const result = findMatchingPattern(
      { sepaGrade: "A", volumeConfirmed: true, breadthDirection: "improving" },
      sectorPattern,
    );

    expect(result).toBeNull();
  });

  it("failureRate가 null인 패턴도 0으로 처리한다", () => {
    const patternWithNullRate: ActiveFailurePatternRow[] = [
      {
        patternName: "test",
        conditions: "sepa:C-F",
        failureRate: null,
        failureCount: 0,
        totalCount: 0,
      },
    ];

    const result = findMatchingPattern(
      { sepaGrade: "F", volumeConfirmed: null, breadthDirection: null },
      patternWithNullRate,
    );

    expect(result).not.toBeNull();
    expect(result!.failureRate).toBe(0);
  });
});

// ─── deriveBreadthDirection ─────────────────────────────────────────────────

describe("deriveBreadthDirection", () => {
  it("양수면 improving을 반환한다", () => {
    expect(deriveBreadthDirection(0.5)).toBe("improving");
    expect(deriveBreadthDirection(0.1)).toBe("improving");
  });

  it("음수면 declining을 반환한다", () => {
    expect(deriveBreadthDirection(-0.3)).toBe("declining");
    expect(deriveBreadthDirection(-0.1)).toBe("declining");
  });

  it("0이면 neutral을 반환한다", () => {
    expect(deriveBreadthDirection(0)).toBe("neutral");
  });

  it("null이면 null을 반환한다", () => {
    expect(deriveBreadthDirection(null)).toBeNull();
  });
});

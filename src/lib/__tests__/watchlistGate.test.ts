/**
 * watchlistGate.test.ts — 5중 교집합 게이트 단위 테스트
 *
 * 순수 함수만 테스트 — DB 접근 없음.
 */

import { describe, it, expect } from "vitest";
import {
  evaluatePhaseCondition,
  evaluateSectorRsCondition,
  evaluateIndividualRsCondition,
  evaluateNarrativeBasisCondition,
  evaluateSepaGradeCondition,
  evaluateWatchlistGate,
  type WatchlistGateInput,
  REQUIRED_PHASE,
  MIN_INDIVIDUAL_RS,
  MIN_SECTOR_RS,
} from "../watchlistGate";

// ─── evaluatePhaseCondition ───────────────────────────────────────────────────

describe("evaluatePhaseCondition", () => {
  it("Phase 2 이상이면 null 반환 (통과)", () => {
    expect(evaluatePhaseCondition(2)).toBeNull();
    expect(evaluatePhaseCondition(3)).toBeNull();
    expect(evaluatePhaseCondition(4)).toBeNull();
  });

  it("Phase 1이면 실패 사유 반환", () => {
    const result = evaluatePhaseCondition(1);
    expect(result).not.toBeNull();
    expect(result?.condition).toBe("phase");
    expect(result?.reason).toContain(`Phase 1 < ${REQUIRED_PHASE}`);
  });

  it("Phase 0이면 실패 사유 반환", () => {
    const result = evaluatePhaseCondition(0);
    expect(result).not.toBeNull();
    expect(result?.condition).toBe("phase");
  });
});

// ─── evaluateSectorRsCondition ────────────────────────────────────────────────

describe("evaluateSectorRsCondition", () => {
  it("섹터 RS가 기준 이상이면 null 반환 (통과)", () => {
    expect(evaluateSectorRsCondition(50)).toBeNull();
    expect(evaluateSectorRsCondition(75)).toBeNull();
    expect(evaluateSectorRsCondition(100)).toBeNull();
  });

  it(`섹터 RS가 ${MIN_SECTOR_RS} 미만이면 실패 사유 반환`, () => {
    const result = evaluateSectorRsCondition(49);
    expect(result).not.toBeNull();
    expect(result?.condition).toBe("sectorRs");
    expect(result?.reason).toContain("49.0");
  });

  it("섹터 RS가 null이면 실패 사유 반환", () => {
    const result = evaluateSectorRsCondition(null);
    expect(result).not.toBeNull();
    expect(result?.condition).toBe("sectorRs");
    expect(result?.reason).toContain("없음");
  });

  it("섹터 RS 경계값 0이면 실패 사유 반환", () => {
    const result = evaluateSectorRsCondition(0);
    expect(result).not.toBeNull();
    expect(result?.condition).toBe("sectorRs");
  });
});

// ─── evaluateIndividualRsCondition ────────────────────────────────────────────

describe("evaluateIndividualRsCondition", () => {
  it(`개별 RS가 ${MIN_INDIVIDUAL_RS} 이상이면 null 반환 (통과)`, () => {
    expect(evaluateIndividualRsCondition(60)).toBeNull();
    expect(evaluateIndividualRsCondition(80)).toBeNull();
    expect(evaluateIndividualRsCondition(100)).toBeNull();
  });

  it(`개별 RS가 ${MIN_INDIVIDUAL_RS} 미만이면 실패 사유 반환`, () => {
    const result = evaluateIndividualRsCondition(59);
    expect(result).not.toBeNull();
    expect(result?.condition).toBe("individualRs");
    expect(result?.reason).toContain("59");
  });

  it("개별 RS가 null이면 실패 사유 반환", () => {
    const result = evaluateIndividualRsCondition(null);
    expect(result).not.toBeNull();
    expect(result?.condition).toBe("individualRs");
    expect(result?.reason).toContain("없음");
  });
});

// ─── evaluateNarrativeBasisCondition ─────────────────────────────────────────

describe("evaluateNarrativeBasisCondition", () => {
  it("thesis_id가 존재하면 null 반환 (통과)", () => {
    expect(evaluateNarrativeBasisCondition(1)).toBeNull();
    expect(evaluateNarrativeBasisCondition(999)).toBeNull();
  });

  it("thesis_id가 null이면 실패 사유 반환", () => {
    const result = evaluateNarrativeBasisCondition(null);
    expect(result).not.toBeNull();
    expect(result?.condition).toBe("narrativeBasis");
    expect(result?.reason).toContain("thesis");
  });
});

// ─── evaluateSepaGradeCondition ───────────────────────────────────────────────

describe("evaluateSepaGradeCondition", () => {
  it("S 등급이면 null 반환 (통과)", () => {
    expect(evaluateSepaGradeCondition("S")).toBeNull();
  });

  it("A 등급이면 null 반환 (통과)", () => {
    expect(evaluateSepaGradeCondition("A")).toBeNull();
  });

  it("B 등급이면 실패 사유 반환", () => {
    const result = evaluateSepaGradeCondition("B");
    expect(result).not.toBeNull();
    expect(result?.condition).toBe("sepaGrade");
    expect(result?.reason).toContain("B");
  });

  it("C 등급이면 실패 사유 반환", () => {
    const result = evaluateSepaGradeCondition("C");
    expect(result).not.toBeNull();
    expect(result?.condition).toBe("sepaGrade");
  });

  it("F 등급이면 실패 사유 반환", () => {
    const result = evaluateSepaGradeCondition("F");
    expect(result).not.toBeNull();
    expect(result?.condition).toBe("sepaGrade");
  });

  it("null이면 실패 사유 반환 (데이터 없음)", () => {
    const result = evaluateSepaGradeCondition(null);
    expect(result).not.toBeNull();
    expect(result?.condition).toBe("sepaGrade");
    expect(result?.reason).toContain("없음");
  });
});

// ─── evaluateWatchlistGate — 5중 교집합 ──────────────────────────────────────

describe("evaluateWatchlistGate", () => {
  const validInput: WatchlistGateInput = {
    symbol: "AAPL",
    phase: 2,
    rsScore: 75,
    sectorRs: 60,
    sepaGrade: "A",
    thesisId: 42,
  };

  it("5가지 조건 모두 충족 시 passed: true, failures: []", () => {
    const result = evaluateWatchlistGate(validInput);
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it("Phase 미달 시 passed: false, failures에 phase 조건 포함", () => {
    const result = evaluateWatchlistGate({ ...validInput, phase: 1 });
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.condition === "phase")).toBe(true);
  });

  it("섹터 RS 미달 시 passed: false, failures에 sectorRs 조건 포함", () => {
    const result = evaluateWatchlistGate({ ...validInput, sectorRs: 30 });
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.condition === "sectorRs")).toBe(true);
  });

  it("개별 RS 미달 시 passed: false, failures에 individualRs 조건 포함", () => {
    const result = evaluateWatchlistGate({ ...validInput, rsScore: 40 });
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.condition === "individualRs")).toBe(true);
  });

  it("thesis_id 없을 시 passed: false, failures에 narrativeBasis 조건 포함", () => {
    const result = evaluateWatchlistGate({ ...validInput, thesisId: null });
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.condition === "narrativeBasis")).toBe(true);
  });

  it("SEPA 등급 미달 시 passed: false, failures에 sepaGrade 조건 포함", () => {
    const result = evaluateWatchlistGate({ ...validInput, sepaGrade: "C" });
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.condition === "sepaGrade")).toBe(true);
  });

  it("복수 조건 미달 시 모든 실패 사유가 failures에 포함됨", () => {
    const result = evaluateWatchlistGate({
      ...validInput,
      phase: 1,
      rsScore: 30,
      sepaGrade: "F",
    });
    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThanOrEqual(3);
    expect(result.failures.some((f) => f.condition === "phase")).toBe(true);
    expect(result.failures.some((f) => f.condition === "individualRs")).toBe(true);
    expect(result.failures.some((f) => f.condition === "sepaGrade")).toBe(true);
  });

  it("섹터 RS null + SEPA null일 때 두 가지 실패 사유 포함", () => {
    const result = evaluateWatchlistGate({ ...validInput, sectorRs: null, sepaGrade: null });
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.condition === "sectorRs")).toBe(true);
    expect(result.failures.some((f) => f.condition === "sepaGrade")).toBe(true);
  });

  it("S 등급 + 최소 RS + Phase 2 + sectorRs 경계값으로 통과", () => {
    const result = evaluateWatchlistGate({
      symbol: "TEST",
      phase: 2,
      rsScore: 60,
      sectorRs: 50,
      sepaGrade: "S",
      thesisId: 1,
    });
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });
});

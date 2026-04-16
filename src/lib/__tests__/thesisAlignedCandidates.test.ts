/**
 * thesisAlignedCandidates.test.ts — countGatePasses 단위 테스트
 *
 * 순수 함수만 테스트 — DB 접근 없음.
 */

import { describe, it, expect } from "vitest";
import { countGatePasses } from "../thesisAlignedCandidates";

// ─── countGatePasses ──────────────────────────────────────────────────────────

describe("countGatePasses", () => {
  it("Phase 2 + RS >= 60 + SEPA S/A + thesis 연결 → 4/4", () => {
    expect(countGatePasses(2, 75, "S")).toBe(4);
    expect(countGatePasses(2, 60, "A")).toBe(4);
  });

  it("SEPA B이면 3/4 (SEPA 미충족)", () => {
    expect(countGatePasses(2, 75, "B")).toBe(3);
  });

  it("Phase 3이면 3/4 (Phase 미충족)", () => {
    expect(countGatePasses(3, 75, "S")).toBe(3);
  });

  it("Phase 1이면 3/4 (Phase 미충족)", () => {
    expect(countGatePasses(1, 75, "A")).toBe(3);
  });

  it("RS 59이면 3/4 (RS 미충족)", () => {
    expect(countGatePasses(2, 59, "S")).toBe(3);
  });

  it("RS 0이면 3/4 (RS 미충족)", () => {
    expect(countGatePasses(2, 0, "S")).toBe(3);
  });

  it("thesis 미연결은 없음 — Gate 4는 chain에서 왔으므로 항상 충족하여 1 고정", () => {
    // Gate 4는 항상 +1이므로 모든 나머지 미충족 시 최솟값은 1
    expect(countGatePasses(1, 0, "F")).toBe(1);
  });

  it("Phase 2 + RS >= 60 + SEPA C → 3/4 (SEPA 미충족)", () => {
    expect(countGatePasses(2, 80, "C")).toBe(3);
  });

  it("Phase 2 + RS >= 60 + SEPA F → 3/4 (SEPA 미충족)", () => {
    expect(countGatePasses(2, 80, "F")).toBe(3);
  });

  // ─── RS 과열 상한 (MAX_RS_SCORE = 95) ────────────────────────────────────────

  it("RS 95이면 4/4 (상한 경계, 통과)", () => {
    expect(countGatePasses(2, 95, "S")).toBe(4);
  });

  it("RS 96이면 3/4 (과열 — RS 게이트 미충족)", () => {
    expect(countGatePasses(2, 96, "S")).toBe(3);
  });

  it("RS 100이면 3/4 (과열 — RS 게이트 미충족)", () => {
    expect(countGatePasses(2, 100, "S")).toBe(3);
  });

  it("RS 97 + Phase 3이면 2/4 (과열 + Phase 미충족)", () => {
    expect(countGatePasses(3, 97, "A")).toBe(2);
  });

  // ─── 엣지: null RS ──────────────────────────────────────────────────────────

  it("RS null이면 RS 게이트 미충족 → 3/4 (Phase 2 + SEPA A + thesis)", () => {
    expect(countGatePasses(2, null, "A")).toBe(3);
  });

  it("RS null + Phase non-2 → 2/4", () => {
    expect(countGatePasses(3, null, "A")).toBe(2);
  });

  // ─── 엣지: null SEPA ───────────────────────────────────────────────────────

  it("SEPA null이면 SEPA 게이트 미충족 → 3/4 (Phase 2 + RS 80 + thesis)", () => {
    expect(countGatePasses(2, 80, null)).toBe(3);
  });

  it("SEPA null + RS null → 2/4 (Phase 2 + thesis)", () => {
    expect(countGatePasses(2, null, null)).toBe(2);
  });

  it("Phase null + RS null + SEPA null → 1/4 (thesis만)", () => {
    expect(countGatePasses(null, null, null)).toBe(1);
  });
});

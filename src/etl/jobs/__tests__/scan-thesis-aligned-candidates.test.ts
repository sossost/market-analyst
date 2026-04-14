/**
 * scan-thesis-aligned-candidates 단위 테스트.
 *
 * 순수 함수(tier 판정, tracking_end_date 계산)를 격리 테스트한다.
 *
 * Issue #773 — tracked_stocks 통합 ETL Phase 2
 */

import { describe, it, expect } from "vitest";

import {
  determineTier,
  calcTrackingEndDate,
} from "../scan-thesis-aligned-candidates.js";

// =============================================================================
// determineTier — tier 판정
// =============================================================================

describe("determineTier", () => {
  it("certified=true이면 featured를 반환한다", () => {
    expect(determineTier(true)).toBe("featured");
  });

  it("certified=false이면 standard를 반환한다", () => {
    expect(determineTier(false)).toBe("standard");
  });

  it("certified=undefined(인증 미실행)이면 standard를 반환한다", () => {
    expect(determineTier(undefined)).toBe("standard");
  });
});

// =============================================================================
// calcTrackingEndDate — 90일 후 날짜 계산
// =============================================================================

describe("calcTrackingEndDate", () => {
  it("2026-01-01에서 90일 후는 2026-04-01이다", () => {
    expect(calcTrackingEndDate("2026-01-01")).toBe("2026-04-01");
  });

  it("2026-04-14에서 90일 후는 2026-07-13이다", () => {
    expect(calcTrackingEndDate("2026-04-14")).toBe("2026-07-13");
  });

  it("윤년(2026-01-31)에서 90일 후를 올바르게 계산한다", () => {
    expect(calcTrackingEndDate("2026-01-31")).toBe("2026-05-01");
  });
});

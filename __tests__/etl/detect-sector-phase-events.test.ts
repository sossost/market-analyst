import { describe, it, expect } from "vitest";
import { filterValidTransitions } from "../../src/etl/jobs/detect-sector-phase-events.js";

describe("filterValidTransitions", () => {
  it("prevGroupPhase가 null인 경우는 SQL에서 이미 필터링됨 (from_phase는 항상 NOT NULL)", () => {
    // filterValidTransitions은 SQL 결과를 받으므로 from_phase는 항상 존재
    // 이 테스트는 from_phase === to_phase인 경우만 확인
    const rows = [
      {
        date: "2026-03-01",
        entity_name: "Technology",
        from_phase: 2,
        to_phase: 2,
        avg_rs: "65.3",
        phase2_ratio: "0.45",
      },
    ];

    const events = filterValidTransitions(rows, "sector");

    expect(events).toEqual([]);
  });

  it("from_phase === to_phase이면 이벤트를 생성하지 않는다", () => {
    const rows = [
      {
        date: "2026-03-01",
        entity_name: "Energy",
        from_phase: 3,
        to_phase: 3,
        avg_rs: "40.0",
        phase2_ratio: "0.20",
      },
    ];

    const events = filterValidTransitions(rows, "sector");

    expect(events).toEqual([]);
  });

  it("Phase 1→2 전이를 정확히 탐지한다", () => {
    const rows = [
      {
        date: "2026-03-01",
        entity_name: "Semiconductors",
        from_phase: 1,
        to_phase: 2,
        avg_rs: "72.5",
        phase2_ratio: "0.55",
      },
    ];

    const events = filterValidTransitions(rows, "sector");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      date: "2026-03-01",
      entityType: "sector",
      entityName: "Semiconductors",
      fromPhase: 1,
      toPhase: 2,
      avgRs: "72.5",
      phase2Ratio: "0.55",
    });
  });

  it("Phase 3→4 전이도 탐지한다", () => {
    const rows = [
      {
        date: "2026-03-05",
        entity_name: "Real Estate",
        from_phase: 3,
        to_phase: 4,
        avg_rs: "25.0",
        phase2_ratio: "0.10",
      },
    ];

    const events = filterValidTransitions(rows, "industry");

    expect(events).toHaveLength(1);
    expect(events[0].entityType).toBe("industry");
    expect(events[0].fromPhase).toBe(3);
    expect(events[0].toPhase).toBe(4);
  });

  it("여러 전이를 동시에 처리한다", () => {
    const rows = [
      {
        date: "2026-03-01",
        entity_name: "Technology",
        from_phase: 1,
        to_phase: 2,
        avg_rs: "70.0",
        phase2_ratio: "0.50",
      },
      {
        date: "2026-03-01",
        entity_name: "Energy",
        from_phase: 2,
        to_phase: 2, // 동일 → 제외
        avg_rs: "40.0",
        phase2_ratio: "0.20",
      },
      {
        date: "2026-03-01",
        entity_name: "Healthcare",
        from_phase: 2,
        to_phase: 3,
        avg_rs: "55.0",
        phase2_ratio: "0.35",
      },
    ];

    const events = filterValidTransitions(rows, "sector");

    expect(events).toHaveLength(2);
    expect(events[0].entityName).toBe("Technology");
    expect(events[1].entityName).toBe("Healthcare");
  });

  it("avgRs와 phase2Ratio가 null이어도 정상 처리한다", () => {
    const rows = [
      {
        date: "2026-03-01",
        entity_name: "Utilities",
        from_phase: 4,
        to_phase: 1,
        avg_rs: null,
        phase2_ratio: null,
      },
    ];

    const events = filterValidTransitions(rows, "sector");

    expect(events).toHaveLength(1);
    expect(events[0].avgRs).toBeNull();
    expect(events[0].phase2Ratio).toBeNull();
  });

  it("빈 배열이면 빈 배열을 반환한다", () => {
    const events = filterValidTransitions([], "sector");
    expect(events).toEqual([]);
  });
});

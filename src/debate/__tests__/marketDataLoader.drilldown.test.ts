import { describe, it, expect, vi } from "vitest";

/**
 * formatMarketSnapshot — Phase 전환 드릴다운 렌더링 테스트.
 *
 * 검증 대상:
 * - phaseTransitionDrilldown이 있으면 드릴다운 섹션이 렌더링된다
 * - RS 변화 상위, Phase 역행, Phase2 비율이 포함된다
 * - phaseTransitionDrilldown이 없으면 드릴다운 섹션이 없다
 */

vi.mock("@/db/client", () => ({
  db: {},
  pool: { query: vi.fn() },
}));

import { formatMarketSnapshot } from "../marketDataLoader";
import type { MarketSnapshot } from "../marketDataLoader";

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function makeBaseSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    date: "2026-03-30",
    sectors: [
      {
        sector: "Financial Services",
        avgRs: 50.5,
        rsRank: 3,
        groupPhase: 2,
        prevGroupPhase: 3,
        change4w: 2.0,
        change12w: null,
        phase2Ratio: 30.9,
        phase1to2Count5d: 2,
      },
    ],
    newPhase2Stocks: [],
    topPhase2Stocks: [],
    breadth: null,
    indices: [],
    fearGreed: null,
    ...overrides,
  };
}

// ─── 테스트 ───────────────────────────────────────────────────────────────────

describe("formatMarketSnapshot — Phase 전환 드릴다운", () => {
  it("드릴다운이 있으면 업종 테이블과 Phase 역행 경고를 포함한다", () => {
    const snapshot = makeBaseSnapshot({
      phaseTransitionDrilldown: {
        "Financial Services": {
          topRsChange: [
            { industry: "Insurance - Reinsurance", avgRs: 65.89, rsChange: 1.89, groupPhase: 2 },
            { industry: "Financial - Conglomerates", avgRs: 54.88, rsChange: 3.01, groupPhase: 2 },
          ],
          phaseAnomalies: [
            { industry: "Banks - Regional", avgRs: 63.99, groupPhase: 3, prevGroupPhase: 1 },
          ],
          phase2Ratio: { count: 3, total: 10, percent: 30 },
        },
      },
    });

    const result = formatMarketSnapshot(snapshot);

    // 드릴다운 제목
    expect(result).toContain("Financial Services Phase 3→2 전환 업종 드릴다운");
    // RS 변화 상위 업종 테이블
    expect(result).toContain("RS 변화 상위 업종 (전환 드라이버)");
    expect(result).toContain("Insurance - Reinsurance");
    expect(result).toContain("+1.89");
    expect(result).toContain("Financial - Conglomerates");
    expect(result).toContain("+3.01");
    // Phase 역행 업종
    expect(result).toContain("Phase 역행 업종 (불안정 신호)");
    expect(result).toContain("Banks - Regional");
    expect(result).toContain("Phase 1→3");
    // Phase2 비율
    expect(result).toContain("3/10 (30%)");
    expect(result).toContain("전환 견고성 판단 근거");
  });

  it("드릴다운이 없으면 드릴다운 섹션이 렌더링되지 않는다", () => {
    const snapshot = makeBaseSnapshot({
      sectors: [
        {
          sector: "Technology",
          avgRs: 60.0,
          rsRank: 1,
          groupPhase: 2,
          prevGroupPhase: 2,
          change4w: 3.0,
          change12w: null,
          phase2Ratio: 50.0,
          phase1to2Count5d: 5,
        },
      ],
    });

    const result = formatMarketSnapshot(snapshot);

    expect(result).not.toContain("전환 업종 드릴다운");
    expect(result).not.toContain("RS 변화 상위 업종");
  });

  it("Phase 역행 업종이 없으면 해당 섹션을 생략한다", () => {
    const snapshot = makeBaseSnapshot({
      phaseTransitionDrilldown: {
        "Financial Services": {
          topRsChange: [
            { industry: "Insurance", avgRs: 65.0, rsChange: 2.0, groupPhase: 2 },
          ],
          phaseAnomalies: [],
          phase2Ratio: { count: 5, total: 10, percent: 50 },
        },
      },
    });

    const result = formatMarketSnapshot(snapshot);

    expect(result).toContain("RS 변화 상위 업종");
    expect(result).not.toContain("Phase 역행 업종");
    expect(result).toContain("5/10 (50%)");
  });

  it("RS 변화가 음수인 업종도 올바르게 표시한다", () => {
    const snapshot = makeBaseSnapshot({
      phaseTransitionDrilldown: {
        "Financial Services": {
          topRsChange: [
            { industry: "Banking", avgRs: 40.0, rsChange: -1.5, groupPhase: 3 },
          ],
          phaseAnomalies: [],
          phase2Ratio: { count: 1, total: 5, percent: 20 },
        },
      },
    });

    const result = formatMarketSnapshot(snapshot);

    expect(result).toContain("-1.5");
    // 음수에는 + 접두어 없음
    expect(result).not.toContain("+-1.5");
  });
});

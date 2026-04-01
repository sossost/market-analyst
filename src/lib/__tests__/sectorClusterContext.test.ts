/**
 * sectorClusterContext.test.ts — 업종 클러스터 포맷 단위 테스트
 *
 * 순수 함수만 테스트 — DB 접근 없음.
 */

import { describe, it, expect } from "vitest";
import {
  groupSectorClusters,
  formatSectorClustersForPrompt,
  type SectorCluster,
} from "../sectorClusterContext";
import type { SectorClusterRow } from "@/db/repositories/index";

// ─── groupSectorClusters ────────────────────────────────────────────────────

describe("groupSectorClusters", () => {
  it("빈 배열이면 빈 배열 반환", () => {
    expect(groupSectorClusters([])).toEqual([]);
  });

  it("단일 섹터의 종목을 그룹핑", () => {
    const rows: SectorClusterRow[] = [
      {
        sector: "Semiconductors",
        sector_avg_rs: "72.5",
        phase2_ratio: "0.506",
        group_phase: 2,
        symbol: "ICHR",
        rs_score: 96,
        industry: "Semiconductor Equipment & Materials",
      },
      {
        sector: "Semiconductors",
        sector_avg_rs: "72.5",
        phase2_ratio: "0.506",
        group_phase: 2,
        symbol: "UCTT",
        rs_score: 96,
        industry: "Semiconductor Equipment & Materials",
      },
      {
        sector: "Semiconductors",
        sector_avg_rs: "72.5",
        phase2_ratio: "0.506",
        group_phase: 2,
        symbol: "TER",
        rs_score: 94,
        industry: "Semiconductor Equipment & Materials",
      },
    ];

    const clusters = groupSectorClusters(rows);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].sector).toBe("Semiconductors");
    expect(clusters[0].sectorAvgRs).toBe(72.5);
    expect(clusters[0].phase2Ratio).toBe(50.6);
    expect(clusters[0].stocks).toHaveLength(3);
    expect(clusters[0].stocks[0].symbol).toBe("ICHR");
    expect(clusters[0].stocks[0].rsScore).toBe(96);
  });

  it("여러 섹터를 분리하여 그룹핑", () => {
    const rows: SectorClusterRow[] = [
      {
        sector: "Semiconductors",
        sector_avg_rs: "72.5",
        phase2_ratio: "0.506",
        group_phase: 2,
        symbol: "ICHR",
        rs_score: 96,
        industry: "Semiconductor Equipment",
      },
      {
        sector: "Technology",
        sector_avg_rs: "68.0",
        phase2_ratio: "0.42",
        group_phase: 2,
        symbol: "AAPL",
        rs_score: 85,
        industry: "Consumer Electronics",
      },
    ];

    const clusters = groupSectorClusters(rows);

    expect(clusters).toHaveLength(2);
    expect(clusters[0].sector).toBe("Semiconductors");
    expect(clusters[1].sector).toBe("Technology");
  });

  it("종목이 없는 섹터 (LEFT JOIN null)", () => {
    const rows: SectorClusterRow[] = [
      {
        sector: "Energy",
        sector_avg_rs: "65.0",
        phase2_ratio: "0.45",
        group_phase: 2,
        symbol: null,
        rs_score: null,
        industry: null,
      },
    ];

    const clusters = groupSectorClusters(rows);

    expect(clusters).toHaveLength(1);
    expect(clusters[0].sector).toBe("Energy");
    expect(clusters[0].stocks).toHaveLength(0);
  });

  it("phase2Ratio를 퍼센트(0~100)로 변환", () => {
    const rows: SectorClusterRow[] = [
      {
        sector: "Health Care",
        sector_avg_rs: "60.0",
        phase2_ratio: "0.333",
        group_phase: 2,
        symbol: null,
        rs_score: null,
        industry: null,
      },
    ];

    const clusters = groupSectorClusters(rows);

    expect(clusters[0].phase2Ratio).toBe(33.3);
  });
});

// ─── formatSectorClustersForPrompt ──────────────────────────────────────────

describe("formatSectorClustersForPrompt", () => {
  it("빈 배열이면 빈 문자열 반환", () => {
    expect(formatSectorClustersForPrompt([])).toBe("");
  });

  it("종목이 있는 클러스터를 테이블로 포맷", () => {
    const clusters: SectorCluster[] = [
      {
        sector: "Semiconductors",
        sectorAvgRs: 72.5,
        phase2Ratio: 50.6,
        stocks: [
          { symbol: "ICHR", rsScore: 96, industry: "Semiconductor Equipment" },
          { symbol: "UCTT", rsScore: 96, industry: "Semiconductor Equipment" },
        ],
      },
    ];

    const result = formatSectorClustersForPrompt(clusters);

    expect(result).toContain("## 업종 클러스터");
    expect(result).toContain("Semiconductors");
    expect(result).toContain("섹터RS 72.5");
    expect(result).toContain("Phase 2 비율 50.6%");
    expect(result).toContain("| ICHR | 96 | Semiconductor Equipment |");
    expect(result).toContain("| UCTT | 96 | Semiconductor Equipment |");
    expect(result).toContain("thesis 유무와 무관하게");
  });

  it("종목이 없는 클러스터를 포맷", () => {
    const clusters: SectorCluster[] = [
      {
        sector: "Energy",
        sectorAvgRs: 65.0,
        phase2Ratio: 45.0,
        stocks: [],
      },
    ];

    const result = formatSectorClustersForPrompt(clusters);

    expect(result).toContain("Energy");
    expect(result).toContain("RS 80+ Phase 2 종목 없음");
  });

  it("여러 섹터를 모두 포함", () => {
    const clusters: SectorCluster[] = [
      {
        sector: "Semiconductors",
        sectorAvgRs: 72.5,
        phase2Ratio: 50.6,
        stocks: [
          { symbol: "ICHR", rsScore: 96, industry: "Semiconductor Equipment" },
        ],
      },
      {
        sector: "Technology",
        sectorAvgRs: 68.0,
        phase2Ratio: 42.0,
        stocks: [
          { symbol: "AAPL", rsScore: 85, industry: "Consumer Electronics" },
        ],
      },
    ];

    const result = formatSectorClustersForPrompt(clusters);

    expect(result).toContain("Semiconductors");
    expect(result).toContain("Technology");
    expect(result).toContain("ICHR");
    expect(result).toContain("AAPL");
  });
});

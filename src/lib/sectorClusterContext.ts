import { findSectorClusters } from "@/db/repositories/sectorClusterRepository.js";
import type { SectorClusterRow } from "@/db/repositories/index.js";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/lib/utils.js";

/**
 * 업종 클러스터 — 프롬프트 주입용 포맷.
 *
 * Phase 2 비율이 높은(40%+) 섹터의 고RS 종목 클러스터를 가시화한다.
 * thesis 유무와 무관하게 업종 단위 강세 클러스터를 LLM에 노출시켜,
 * thesis 부재로 인한 리포트 누락을 방지한다.
 */

export interface SectorCluster {
  sector: string;
  sectorAvgRs: number;
  phase2Ratio: number;
  stocks: {
    symbol: string;
    rsScore: number;
    industry: string;
  }[];
}

/**
 * DB 쿼리 결과를 섹터 클러스터 구조체로 그룹핑한다.
 * 순수 함수 — DB 접근 없음.
 */
export function groupSectorClusters(rows: SectorClusterRow[]): SectorCluster[] {
  const sectorMap = new Map<string, SectorCluster>();

  for (const row of rows) {
    let cluster = sectorMap.get(row.sector);
    if (cluster == null) {
      cluster = {
        sector: row.sector,
        sectorAvgRs: Math.round(toNum(row.sector_avg_rs) * 10) / 10,
        phase2Ratio: Math.round(toNum(row.phase2_ratio) * 1000) / 10,
        stocks: [],
      };
      sectorMap.set(row.sector, cluster);
    }

    if (row.symbol != null && row.rs_score != null && row.industry != null) {
      cluster.stocks.push({
        symbol: row.symbol,
        rsScore: row.rs_score,
        industry: row.industry,
      });
    }
  }

  return Array.from(sectorMap.values());
}

/**
 * 섹터 클러스터를 프롬프트 주입용 문자열로 포맷한다.
 * 순수 함수 — DB 접근 없음.
 */
export function formatSectorClustersForPrompt(clusters: SectorCluster[]): string {
  if (clusters.length === 0) return "";

  const lines: string[] = [
    "## 업종 클러스터 — Phase 2 강세 집중 섹터\n",
    "아래는 Phase 2 비율이 높은 섹터(40%+)와 해당 섹터의 고RS 종목입니다.",
    "**thesis 유무와 무관하게** 리포트에서 이 클러스터를 분석하세요.",
    "thesis가 없는 종목이라도 업종 클러스터 단위로 강세가 확인되면 반드시 언급하세요.\n",
  ];

  for (const cluster of clusters) {
    lines.push(
      `### ${cluster.sector} (섹터RS ${cluster.sectorAvgRs} | Phase 2 비율 ${cluster.phase2Ratio}%)`,
    );

    if (cluster.stocks.length === 0) {
      lines.push("- RS 80+ Phase 2 종목 없음\n");
      continue;
    }

    lines.push("| 종목 | RS | 업종 |");
    lines.push("|------|-----|------|");
    for (const stock of cluster.stocks) {
      lines.push(`| ${stock.symbol} | ${stock.rsScore} | ${stock.industry} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * DB에서 업종 클러스터를 조회하고 프롬프트 주입용 문자열로 반환한다.
 * 데이터가 없으면 빈 문자열을 반환한다.
 */
export async function loadSectorClusterContext(date: string): Promise<string> {
  const rows = await retryDatabaseOperation(() =>
    findSectorClusters({ date }),
  );

  const clusters = groupSectorClusters(rows);
  return formatSectorClustersForPrompt(clusters);
}

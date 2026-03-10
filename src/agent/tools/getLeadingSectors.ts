import { pool } from "@/db/client";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { clampPercent, validateDate, validateNumber } from "./validation";

const DEFAULT_LIMIT = 10;

interface SectorRow {
  sector: string;
  avg_rs: string;
  rs_rank: number;
  stock_count: number;
  change_4w: string | null;
  change_8w: string | null;
  change_12w: string | null;
  group_phase: number;
  prev_group_phase: number | null;
  phase2_ratio: string;
  ma_ordered_ratio: string;
  phase1to2_count_5d: number;
}

interface IndustryRow {
  sector: string;
  industry: string;
  avg_rs: string;
  rs_rank: number;
  group_phase: number;
  phase2_ratio: string;
}

function mapSectorRow(
  s: SectorRow,
  industryBySector: Map<string, IndustryRow[]>,
) {
  return {
    sector: s.sector,
    avgRs: toNum(s.avg_rs),
    rsRank: s.rs_rank,
    stockCount: s.stock_count,
    change4w: s.change_4w != null ? toNum(s.change_4w) : null,
    change8w: s.change_8w != null ? toNum(s.change_8w) : null,
    change12w: s.change_12w != null ? toNum(s.change_12w) : null,
    groupPhase: s.group_phase,
    prevGroupPhase: s.prev_group_phase,
    phase2Ratio: clampPercent(
      Number((toNum(s.phase2_ratio) * 100).toFixed(1)),
      `sector:${s.sector}:phase2Ratio`,
    ),
    maOrderedRatio: clampPercent(
      Number((toNum(s.ma_ordered_ratio) * 100).toFixed(1)),
      `sector:${s.sector}:maOrderedRatio`,
    ),
    phase1to2Count5d: s.phase1to2_count_5d,
    topIndustries: (industryBySector.get(s.sector) ?? []).map((i) => ({
      industry: i.industry,
      avgRs: toNum(i.avg_rs),
      groupPhase: i.group_phase,
      phase2Ratio: clampPercent(
        Number((toNum(i.phase2_ratio) * 100).toFixed(1)),
        `industry:${i.industry}:phase2Ratio`,
      ),
    })),
  };
}

async function fetchTopIndustries(
  date: string,
  sectorRows: SectorRow[],
): Promise<Map<string, IndustryRow[]>> {
  const sectorNames = sectorRows.map((s) => s.sector);
  const { rows: industryRows } = await retryDatabaseOperation(() =>
    pool.query<IndustryRow>(
      `SELECT sector, industry, avg_rs::text, rs_rank, group_phase, phase2_ratio::text
       FROM industry_rs_daily
       WHERE date = $1 AND sector = ANY($2)
       ORDER BY sector, avg_rs::numeric DESC`,
      [date, sectorNames],
    ),
  );

  const industryBySector = new Map<string, IndustryRow[]>();
  for (const row of industryRows) {
    const arr = industryBySector.get(row.sector) ?? [];
    if (arr.length < 3) {
      arr.push(row);
    }
    industryBySector.set(row.sector, arr);
  }
  return industryBySector;
}

/**
 * 섹터/업종 RS 랭킹과 트렌드를 조회한다.
 * 섹터 상위 N개와 각 섹터의 상위 업종까지 반환.
 */
export const getLeadingSectors: AgentTool = {
  definition: {
    name: "get_leading_sectors",
    description:
      "섹터/업종 RS 랭킹과 트렌드를 조회합니다. RS 상위 섹터, 4주/8주/12주 RS 변화, Phase 2 비율, 그룹 Phase, 상위 업종을 포함합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "조회 날짜 (YYYY-MM-DD)",
        },
        limit: {
          type: "number",
          description: "반환할 섹터 수 (기본 10)",
        },
        mode: {
          type: "string",
          enum: ["daily", "weekly"],
          description:
            "조회 모드. daily(기본): 당일 스냅샷, weekly: 전주 대비 순위 변동 포함",
        },
      },
      required: ["date"],
    },
  },

  async execute(input) {
    const date = validateDate(input.date);
    if (date == null) {
      return JSON.stringify({ error: "Invalid or missing date parameter" });
    }
    const limit = validateNumber(input.limit, DEFAULT_LIMIT);
    const mode = input.mode === "weekly" ? "weekly" : "daily";

    // 섹터 RS 랭킹
    const { rows: sectorRows } = await retryDatabaseOperation(() =>
      pool.query<SectorRow>(
        `SELECT sector, avg_rs::text, rs_rank, stock_count,
                change_4w::text, change_8w::text, change_12w::text,
                group_phase, prev_group_phase,
                phase2_ratio::text, ma_ordered_ratio::text,
                phase1to2_count_5d
         FROM sector_rs_daily
         WHERE date = $1
         ORDER BY avg_rs::numeric DESC
         LIMIT $2`,
        [date, limit],
      ),
    );

    // 각 상위 섹터의 상위 3개 업종
    const industryBySector = await fetchTopIndustries(date, sectorRows);

    if (mode === "daily") {
      const sectors = sectorRows.map((s) =>
        mapSectorRow(s, industryBySector),
      );
      return JSON.stringify({ date, sectors });
    }

    // weekly: 전주 날짜 조회
    const { rows: prevDateRows } = await retryDatabaseOperation(() =>
      pool.query<{ prev_week_date: string | null }>(
        `SELECT MAX(date) AS prev_week_date
         FROM sector_rs_daily
         WHERE date < ($1::date - INTERVAL '5 days')`,
        [date],
      ),
    );

    const prevWeekDate = prevDateRows[0]?.prev_week_date ?? null;

    if (prevWeekDate == null) {
      const sectors = sectorRows.map((s) =>
        mapSectorRow(s, industryBySector),
      );
      return JSON.stringify({
        mode: "weekly",
        date,
        prevWeekDate: null,
        note: "이전 주 데이터 없음 — 전주 대비 비교 불가",
        newEntrants: [],
        exits: [],
        sectors,
      });
    }

    // 전주 섹터 랭킹 조회
    const { rows: prevSectorRows } = await retryDatabaseOperation(() =>
      pool.query<{ sector: string; avg_rs: string; rs_rank: number }>(
        `SELECT sector, avg_rs::text, rs_rank
         FROM sector_rs_daily
         WHERE date = $1
         ORDER BY avg_rs::numeric DESC
         LIMIT $2`,
        [prevWeekDate, limit],
      ),
    );

    const prevRankMap = new Map<string, { rank: number; avgRs: number }>();
    for (const row of prevSectorRows) {
      prevRankMap.set(row.sector, {
        rank: row.rs_rank,
        avgRs: toNum(row.avg_rs),
      });
    }

    const currentTopSectors = new Set(sectorRows.map((s) => s.sector));
    const prevTopSectors = new Set(prevSectorRows.map((s) => s.sector));

    const newEntrants = [...currentTopSectors].filter(
      (s) => !prevTopSectors.has(s),
    );
    const exits = [...prevTopSectors].filter(
      (s) => !currentTopSectors.has(s),
    );

    const sectors = sectorRows.map((s) => {
      const base = mapSectorRow(s, industryBySector);
      const prev = prevRankMap.get(s.sector);
      return {
        ...base,
        prevWeekRank: prev?.rank ?? null,
        rankChange: prev != null ? prev.rank - s.rs_rank : null,
        prevWeekAvgRs: prev?.avgRs ?? null,
        rsChange:
          prev != null
            ? Number((toNum(s.avg_rs) - prev.avgRs).toFixed(2))
            : null,
      };
    });

    return JSON.stringify({
      mode: "weekly",
      date,
      prevWeekDate,
      newEntrants,
      exits,
      sectors,
    });
  },
};

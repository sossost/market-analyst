import { retryDatabaseOperation } from "@/etl/utils/retry";
import {
  findTopSectors,
  findTopIndustries,
  findTopIndustriesGlobal,
  findPrevWeekDate,
  findPrevDayDate,
  findSectorsByDate,
  findSectorsByDateAndNames,
} from "@/db/repositories/index.js";
import type {
  SectorRsRow,
  IndustryRsRow,
  IndustryRsGlobalRow,
} from "@/db/repositories/index.js";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { clampPercent, validateDate, validateNumber } from "./validation";

const DEFAULT_LIMIT = 10;

function mapSectorRow(
  s: SectorRsRow,
  industryBySector: Map<string, IndustryRsRow[]>,
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
  sectorRows: SectorRsRow[],
): Promise<Map<string, IndustryRsRow[]>> {
  const sectorNames = sectorRows.map((s) => s.sector);
  const industryRows = await retryDatabaseOperation(() =>
    findTopIndustries(date, sectorNames),
  );

  const industryBySector = new Map<string, IndustryRsRow[]>();
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
          enum: ["daily", "weekly", "industry"],
          description:
            "조회 모드. daily(기본): 당일 섹터 스냅샷, weekly: 전주 대비 순위 변동 포함, industry: 섹터 종속 없는 전체 업종 RS 상위 랭킹 (소속 섹터 RS·divergence 포함)",
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
    const mode =
      input.mode === "industry"
        ? "industry"
        : input.mode === "weekly"
          ? "weekly"
          : "daily";

    if (mode === "industry") {
      const rows = await retryDatabaseOperation(() =>
        findTopIndustriesGlobal(date, limit),
      );

      const industries = rows.map((i: IndustryRsGlobalRow) => ({
        industry: i.industry,
        sector: i.sector,
        avgRs: toNum(i.avg_rs),
        rsRank: i.rs_rank,
        groupPhase: i.group_phase,
        phase2Ratio: clampPercent(
          Number((toNum(i.phase2_ratio) * 100).toFixed(1)),
          `industry:${i.industry}:phase2Ratio`,
        ),
        change4w: i.change_4w != null ? toNum(i.change_4w) : null,
        change8w: i.change_8w != null ? toNum(i.change_8w) : null,
        change12w: i.change_12w != null ? toNum(i.change_12w) : null,
        sectorAvgRs: i.sector_avg_rs != null ? toNum(i.sector_avg_rs) : null,
        sectorRsRank: i.sector_rs_rank,
        divergence:
          i.sector_avg_rs != null
            ? Number((toNum(i.avg_rs) - toNum(i.sector_avg_rs)).toFixed(2))
            : null,
      }));

      return JSON.stringify({
        _note:
          "phase2Ratio는 이미 퍼센트(0~100). divergence = 업종RS - 섹터RS (양수 = 섹터 대비 업종 초과 강세)",
        date,
        mode: "industry",
        industries,
      });
    }

    // 섹터 RS 랭킹
    const sectorRows = await retryDatabaseOperation(() =>
      findTopSectors(date, limit),
    );

    // 각 상위 섹터의 상위 3개 업종
    const industryBySector = await fetchTopIndustries(date, sectorRows);

    if (mode === "daily") {
      // 전일 날짜 조회 → 전일 대비 RS/순위 비교
      const prevDayDateRow = await retryDatabaseOperation(() =>
        findPrevDayDate(date),
      );
      const prevDayDate = prevDayDateRow.prev_day_date ?? null;

      if (prevDayDate == null) {
        const sectors = sectorRows.map((s) =>
          mapSectorRow(s, industryBySector),
        );
        return JSON.stringify({
          _note: "phase2Ratio는 이미 퍼센트(0~100). 절대 ×100 하지 마세요",
          date,
          prevDayDate: null,
          sectors,
        });
      }

      const sectorNames = sectorRows.map((s) => s.sector);
      const prevDaySectorRows = await retryDatabaseOperation(() =>
        findSectorsByDateAndNames(prevDayDate, sectorNames),
      );

      const prevDayMap = new Map<string, { rank: number; avgRs: number }>();
      for (const row of prevDaySectorRows) {
        prevDayMap.set(row.sector, {
          rank: row.rs_rank,
          avgRs: toNum(row.avg_rs),
        });
      }

      const sectors = sectorRows.map((s) => {
        const base = mapSectorRow(s, industryBySector);
        const prev = prevDayMap.get(s.sector);
        return {
          ...base,
          prevDayRank: prev?.rank ?? null,
          rankChange: prev != null ? prev.rank - s.rs_rank : null,
          prevDayAvgRs: prev?.avgRs ?? null,
          rsChange:
            prev != null
              ? Number((toNum(s.avg_rs) - prev.avgRs).toFixed(2))
              : null,
        };
      });

      return JSON.stringify({
        _note: "phase2Ratio는 이미 퍼센트(0~100). 절대 ×100 하지 마세요",
        date,
        prevDayDate,
        sectors,
      });
    }

    // weekly: 전주 날짜 조회
    const prevDateRow = await retryDatabaseOperation(() =>
      findPrevWeekDate(date),
    );

    const prevWeekDate = prevDateRow.prev_week_date ?? null;

    if (prevWeekDate == null) {
      const sectors = sectorRows.map((s) =>
        mapSectorRow(s, industryBySector),
      );
      return JSON.stringify({
        _note: "phase2Ratio는 이미 퍼센트(0~100). 절대 ×100 하지 마세요",
        mode: "weekly",
        date,
        prevWeekDate: null,
        note: "이전 주 데이터 없음 — 전주 대비 비교 불가",
        newEntrants: [],
        exits: [],
        sectors,
      });
    }

    // 전주 섹터 랭킹 조회 — 현재 상위 섹터 + 전주 상위 섹터 모두 포함
    const currentSectorNames = sectorRows.map((s) => s.sector);
    const prevTopRows = await retryDatabaseOperation(() =>
      findSectorsByDate(prevWeekDate, limit),
    );
    const allSectorNames = [
      ...new Set([
        ...currentSectorNames,
        ...prevTopRows.map((s) => s.sector),
      ]),
    ];
    const prevSectorRows = await retryDatabaseOperation(() =>
      findSectorsByDateAndNames(prevWeekDate, allSectorNames),
    );

    const prevRankMap = new Map<string, { rank: number; avgRs: number }>();
    for (const row of prevSectorRows) {
      prevRankMap.set(row.sector, {
        rank: row.rs_rank,
        avgRs: toNum(row.avg_rs),
      });
    }

    const currentTopSectors = new Set(sectorRows.map((s) => s.sector));
    const prevTopSectors = new Set(prevTopRows.map((s) => s.sector));

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
      _note: "phase2Ratio는 이미 퍼센트(0~100). 절대 ×100 하지 마세요",
      mode: "weekly",
      date,
      prevWeekDate,
      newEntrants,
      exits,
      sectors,
    });
  },
};

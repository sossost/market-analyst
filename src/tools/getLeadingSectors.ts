import { retryDatabaseOperation } from "@/etl/utils/retry";
import {
  findTopSectors,
  findTopIndustries,
  findTopIndustriesGlobal,
  findIndustriesWeeklyChange,
  findPrevWeekDate,
  findPrevDayDate,
  findSectorsByDate,
  findSectorsByDateAndNames,
  findIndustryDrilldown,
} from "@/db/repositories/index.js";
import type {
  SectorRsRow,
  IndustryRsRow,
  IndustryRsGlobalRow,
  IndustryDrilldownRow,
  IndustryWeeklyChangeRow,
} from "@/db/repositories/index.js";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { clampPercent, validateDate, validateNumber } from "./validation";
import { applyIndustrySectorCap } from "@/lib/industryFilter.js";

/** DB에서 가져올 업종 상위 N개 (섹터당 제한 적용 전 후보군) */
const INDUSTRY_FETCH_LIMIT = 50;

/** 최종 반환할 업종 개수 */
const INDUSTRY_TOP_N = 10;

/** 섹터당 최대 허용 업종 개수 */
const INDUSTRY_SECTOR_CAP = 2;

/**
 * 섹터 쿼리 상한. GICS 11개 섹터를 모두 포함하는 안전 상한.
 * 섹터는 업종과 달리 전체 수가 적으므로 항상 전체를 반환한다.
 */
const SECTOR_QUERY_LIMIT = 50;

/** 주간 업종 RS 변화 Top 10 마크다운 테이블 생성 */
function buildWeeklyChangeTable(
  industries: {
    industry: string;
    sector: string;
    avgRs: number;
    groupPhase: number;
    phase2Ratio: number | null;
    changeWeek: number | null;
  }[],
): string {
  const header =
    "| # | 업종 | 섹터 | RS | 주간 변화 | Phase | P2 비율 |\n" +
    "|----|------|------|----|-----------|-------|---------|";
  const rows = industries.map((i, idx) => {
    const cw =
      i.changeWeek != null ? (i.changeWeek >= 0 ? `+${i.changeWeek.toFixed(1)}` : i.changeWeek.toFixed(1)) : "—";
    const p2 = i.phase2Ratio != null ? `${i.phase2Ratio}%` : "—";
    return `| ${idx + 1} | ${i.industry} | ${i.sector} | ${i.avgRs.toFixed(1)} | ${cw} | ${i.groupPhase} | ${p2} |`;
  });
  return `${header}\n${rows.join("\n")}`;
}

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

const MAX_RS_CHANGE_INDUSTRIES = 5;

/**
 * Phase 전환 섹터의 업종 드릴다운을 조립한다.
 * RS 변화 상위 업종, Phase 이상 업종, Phase2 비율을 포함.
 */
export function buildPhaseTransitionDrilldown(
  drilldownRows: IndustryDrilldownRow[],
): Record<string, {
  topRsChange: { industry: string; avgRs: number; rsChange: number; groupPhase: number }[];
  phaseAnomalies: { industry: string; avgRs: number; groupPhase: number; prevGroupPhase: number }[];
  phase2Ratio: { count: number; total: number; percent: number };
}> {
  const bySector = new Map<string, IndustryDrilldownRow[]>();
  for (const row of drilldownRows) {
    const arr = bySector.get(row.sector) ?? [];
    arr.push(row);
    bySector.set(row.sector, arr);
  }

  const result: Record<string, {
    topRsChange: { industry: string; avgRs: number; rsChange: number; groupPhase: number }[];
    phaseAnomalies: { industry: string; avgRs: number; groupPhase: number; prevGroupPhase: number }[];
    phase2Ratio: { count: number; total: number; percent: number };
  }> = {};

  for (const [sector, rows] of bySector) {
    // RS 변화 상위 업종 (이미 rs_change DESC로 정렬됨)
    const topRsChange = rows
      .filter((r) => r.rs_change != null)
      .slice(0, MAX_RS_CHANGE_INDUSTRIES)
      .map((r) => ({
        industry: r.industry,
        avgRs: Number(toNum(r.avg_rs).toFixed(2)),
        rsChange: Number(Number(r.rs_change!).toFixed(2)),
        groupPhase: r.group_phase,
      }));

    // Phase 이상 업종: RS 높지만 Phase가 악화 (prev < curr, 즉 숫자가 커짐)
    const phaseAnomalies = rows
      .filter(
        (r) =>
          r.prev_group_phase != null &&
          r.prev_group_phase !== r.group_phase &&
          r.group_phase > r.prev_group_phase,
      )
      .map((r) => ({
        industry: r.industry,
        avgRs: toNum(r.avg_rs),
        groupPhase: r.group_phase,
        prevGroupPhase: r.prev_group_phase!,
      }));

    // Phase2 업종 비율
    const phase2Count = rows.filter((r) => r.group_phase === 2).length;
    const total = rows.length;
    const percent = total > 0 ? Number(((phase2Count / total) * 100).toFixed(1)) : 0;

    result[sector] = {
      topRsChange,
      phaseAnomalies,
      phase2Ratio: { count: phase2Count, total, percent },
    };
  }

  return result;
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
          description:
            "반환할 항목 수. 섹터 모드(daily/weekly)에서는 전체 섹터를 반환하므로 무시됨. 업종 모드(industry)에서만 적용 (기본 10)",
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
    const industryLimit = validateNumber(input.limit, INDUSTRY_TOP_N);
    const mode =
      input.mode === "industry"
        ? "industry"
        : input.mode === "weekly"
          ? "weekly"
          : "daily";

    if (mode === "industry") {
      // 전주 날짜 조회 — changeWeek 계산용
      const prevWeekDateRow = await retryDatabaseOperation(() =>
        findPrevWeekDate(date),
      );
      const prevWeekDate = prevWeekDateRow.prev_week_date ?? null;

      // 전주 날짜가 있으면 주간 변화 포함 쿼리, 없으면 기존 글로벌 쿼리 사용
      let allIndustries: {
        industry: string;
        sector: string;
        avgRs: number;
        rsRank: number;
        groupPhase: number;
        phase2Ratio: number | null;
        change4w: number | null;
        change8w: number | null;
        change12w: number | null;
        sectorAvgRs: number | null;
        sectorRsRank: number | null;
        divergence: number | null;
        changeWeek: number | null;
      }[];

      if (prevWeekDate != null) {
        // changeWeek + divergence 계산을 위해 두 쿼리 병렬 조회
        const [weeklyRows, globalRows] = await Promise.all([
          retryDatabaseOperation(() =>
            findIndustriesWeeklyChange(date, prevWeekDate, INDUSTRY_FETCH_LIMIT),
          ),
          retryDatabaseOperation(() =>
            findTopIndustriesGlobal(date, INDUSTRY_FETCH_LIMIT),
          ),
        ]);
        const globalMap = new Map<string, IndustryRsGlobalRow>();
        for (const g of globalRows) {
          globalMap.set(g.industry, g);
        }

        allIndustries = weeklyRows.map((i: IndustryWeeklyChangeRow) => {
          const global = globalMap.get(i.industry);
          const sectorAvgRs =
            global?.sector_avg_rs != null ? toNum(global.sector_avg_rs) : null;
          return {
            industry: i.industry,
            sector: i.sector,
            avgRs: toNum(i.avg_rs),
            rsRank: i.rs_rank,
            groupPhase: i.group_phase,
            phase2Ratio: clampPercent(
              Number((toNum(i.phase2_ratio) * 100).toFixed(1)),
              `industry:${i.industry}:phase2Ratio`,
            ),
            change4w: global?.change_4w != null ? toNum(global.change_4w) : null,
            change8w: global?.change_8w != null ? toNum(global.change_8w) : null,
            change12w:
              global?.change_12w != null ? toNum(global.change_12w) : null,
            sectorAvgRs,
            sectorRsRank: global?.sector_rs_rank ?? null,
            divergence:
              sectorAvgRs != null
                ? Number((toNum(i.avg_rs) - sectorAvgRs).toFixed(2))
                : null,
            changeWeek:
              i.change_week != null
                ? Number(Number(i.change_week).toFixed(2))
                : null,
          };
        });
      } else {
        const globalRows = await retryDatabaseOperation(() =>
          findTopIndustriesGlobal(date, INDUSTRY_FETCH_LIMIT),
        );
        allIndustries = globalRows.map((i: IndustryRsGlobalRow) => ({
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
          sectorAvgRs:
            i.sector_avg_rs != null ? toNum(i.sector_avg_rs) : null,
          sectorRsRank: i.sector_rs_rank,
          divergence:
            i.sector_avg_rs != null
              ? Number((toNum(i.avg_rs) - toNum(i.sector_avg_rs)).toFixed(2))
              : null,
          changeWeek: null,
        }));
      }

      // changeWeek 경로(주간 변화 분석): 섹터당 제한 없음 — 한 섹터 집중은 강한 자금 유입 신호
      // prevWeekDate 없는 경로(일간 스냅샷): 섹터당 캡 적용
      const industries =
        prevWeekDate != null
          ? allIndustries.slice(0, industryLimit)
          : applyIndustrySectorCap(
              allIndustries,
              INDUSTRY_SECTOR_CAP,
              industryLimit,
            );

      if (prevWeekDate != null) {
        // 주간 변화 경로: JSON으로 반환하여 weeklyDataCollector가 industries를 캡처할 수 있게 한다.
        // weeklyChangeTable은 에이전트가 narrative 작성에 활용하도록 포함한다.
        const weeklyChangeTable = buildWeeklyChangeTable(industries);
        return JSON.stringify({
          _note: "phase2Ratio는 이미 퍼센트(0~100). weeklyChangeTable을 섹션 2에 그대로 사용하세요.",
          date,
          prevWeekDate,
          mode: "industry",
          industries,
          weeklyChangeTable,
        });
      }

      return JSON.stringify({
        _note: "일간 스냅샷 경로. phase2Ratio는 이미 퍼센트(0~100). 섹터당 최대 2개로 제한됨.",
        date,
        prevWeekDate: null,
        mode: "industry",
        industries,
      });
    }

    // 섹터 RS 랭킹 — 전체 섹터를 반환 (GICS 11개 섹터 모두 포함)
    const sectorRows = await retryDatabaseOperation(() =>
      findTopSectors(date, SECTOR_QUERY_LIMIT),
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

      // Phase 전환 섹터 드릴다운: 전환 발생 섹터만 조건부 조회
      const phaseTransitionSectors = sectorRows.filter(
        (s) =>
          s.prev_group_phase != null &&
          s.prev_group_phase !== s.group_phase,
      );

      let phaseTransitionDrilldown: ReturnType<typeof buildPhaseTransitionDrilldown> | undefined;
      if (phaseTransitionSectors.length > 0) {
        const drilldownRows = await retryDatabaseOperation(() =>
          findIndustryDrilldown(
            date,
            prevDayDate,
            phaseTransitionSectors.map((s) => s.sector),
          ),
        );
        phaseTransitionDrilldown = buildPhaseTransitionDrilldown(drilldownRows);
      }

      return JSON.stringify({
        _note: "phase2Ratio는 이미 퍼센트(0~100). 절대 ×100 하지 마세요",
        date,
        prevDayDate,
        sectors,
        ...(phaseTransitionDrilldown != null
          ? { phaseTransitionDrilldown }
          : {}),
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
      findSectorsByDate(prevWeekDate, SECTOR_QUERY_LIMIT),
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

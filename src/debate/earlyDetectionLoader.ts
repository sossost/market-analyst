import { logger } from "@/lib/logger";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import { findPhase1LateStocks } from "@/db/repositories/stockPhaseRepository.js";
import { findRisingRsStocks } from "@/db/repositories/stockPhaseRepository.js";
import { findFundamentalAcceleration } from "@/db/repositories/fundamentalRepository.js";
import { computeYoYGrowths, isAccelerating } from "@/tools/getFundamentalAcceleration";
import { scoreFundamentals } from "@/lib/fundamental-scorer";
import { periodEndDateToAsOfQ } from "@/lib/quarter-utils";
import { toNum as toNumForScorer } from "@/etl/utils/common";
import type { QuarterlyData, FundamentalGrade } from "@/types/fundamental.js";

/** 카테고리별 최대 종목 수 — 토큰 절약 */
const MAX_PER_CATEGORY = 10;
const RS_MIN = 30;
const RS_MAX = 70;
const MIN_RS_CHANGE = 5;
const ALLOWED_PHASES = [1, 2];

interface Phase1LateStock {
  symbol: string;
  rsScore: number | null;
  ma150Slope: number | null;
  volRatio: number | null;
  sector: string | null;
}

interface RisingRsStock {
  symbol: string;
  rsScore: number | null;
  rsChange: number | null;
  sector: string | null;
}

interface AcceleratingStock {
  symbol: string;
  sector: string | null;
  latestEpsGrowth: number | null;
  latestRevenueGrowth: number | null;
  isEpsAccelerating: boolean;
  isRevenueAccelerating: boolean;
  sepaGrade: FundamentalGrade;
}

export interface EarlyDetectionData {
  phase1Late: Phase1LateStock[];
  risingRs: RisingRsStock[];
  accelerating: AcceleratingStock[];
}

/**
 * 조기포착 도구 3종의 DB 데이터를 로드한다.
 * 각 카테고리별 상위 10개로 제한하여 토큰을 절약한다.
 * 개별 쿼리 실패는 격리 — 실패한 카테고리는 빈 배열로 처리.
 */
export async function loadEarlyDetectionData(date: string): Promise<EarlyDetectionData> {
  const [phase1Late, risingRs, accelerating] = await Promise.all([
    loadPhase1Late(date),
    loadRisingRs(date),
    loadAccelerating(),
  ]);

  return { phase1Late, risingRs, accelerating };
}

async function loadPhase1Late(date: string): Promise<Phase1LateStock[]> {
  try {
    const rows = await retryDatabaseOperation(() =>
      findPhase1LateStocks(date, MAX_PER_CATEGORY),
    );
    return rows.map((r) => ({
      symbol: r.symbol,
      rsScore: r.rs_score,
      ma150Slope: r.ma150_slope != null ? toNum(r.ma150_slope) : null,
      volRatio: r.vol_ratio != null ? toNum(r.vol_ratio) : null,
      sector: r.sector,
    }));
  } catch (err) {
    logger.warn(
      "EarlyDetection",
      `Phase1Late 로드 실패: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

async function loadRisingRs(date: string): Promise<RisingRsStock[]> {
  try {
    const rows = await retryDatabaseOperation(() =>
      findRisingRsStocks({
        date,
        rsMin: RS_MIN,
        rsMax: RS_MAX,
        limit: MAX_PER_CATEGORY,
        minRsChange: MIN_RS_CHANGE,
        allowedPhases: ALLOWED_PHASES,
      }),
    );
    return rows.map((r) => ({
      symbol: r.symbol,
      rsScore: r.rs_score,
      rsChange: r.rs_change,
      sector: r.sector,
    }));
  } catch (err) {
    logger.warn(
      "EarlyDetection",
      `RisingRS 로드 실패: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

async function loadAccelerating(): Promise<AcceleratingStock[]> {
  try {
    const rows = await retryDatabaseOperation(() =>
      findFundamentalAcceleration(),
    );

    const bySymbol = new Map<string, { sector: string | null; quarters: typeof rows }>();
    for (const row of rows) {
      const entry = bySymbol.get(row.symbol) ?? { sector: row.sector, quarters: [] };
      entry.quarters.push(row);
      bySymbol.set(row.symbol, entry);
    }

    const results: AcceleratingStock[] = [];
    const MIN_QUARTERS = 7; // YoY 비교 + 가속 판단에 필요

    for (const [symbol, data] of bySymbol) {
      if (data.quarters.length < MIN_QUARTERS) continue;

      const epsGrowths = computeYoYGrowths(data.quarters, "eps_diluted");
      const revenueGrowths = computeYoYGrowths(data.quarters, "revenue");
      const isEpsAcc = isAccelerating(epsGrowths);
      const isRevAcc = isAccelerating(revenueGrowths);

      if (!isEpsAcc && !isRevAcc) continue;

      // SEPA 등급 산출 — 이미 로드된 quarters 데이터 재활용 (추가 DB 쿼리 없음)
      const quarterlyData: QuarterlyData[] = data.quarters.map((q) => ({
        periodEndDate: q.period_end_date,
        asOfQ: periodEndDateToAsOfQ(q.period_end_date),
        revenue: q.revenue != null ? toNumForScorer(q.revenue) : null,
        netIncome: q.net_income != null ? toNumForScorer(q.net_income) : null,
        epsDiluted: q.eps_diluted != null ? toNumForScorer(q.eps_diluted) : null,
        netMargin: null, // ratio 데이터 미포함 — scorer 내부에서 optional 처리
        actualEps: null,
      }));
      const sepaScore = scoreFundamentals({ symbol, quarters: quarterlyData });

      // SEPA F등급 종목은 가속 리스트에서 제외 — 모순 신호 방지
      if (sepaScore.grade === "F") continue;

      results.push({
        symbol,
        sector: data.sector,
        latestEpsGrowth: epsGrowths[0]?.yoyGrowth ?? null,
        latestRevenueGrowth: revenueGrowths[0]?.yoyGrowth ?? null,
        isEpsAccelerating: isEpsAcc,
        isRevenueAccelerating: isRevAcc,
        sepaGrade: sepaScore.grade,
      });
    }

    results.sort((a, b) => (b.latestEpsGrowth ?? 0) - (a.latestEpsGrowth ?? 0));
    return results.slice(0, MAX_PER_CATEGORY);
  } catch (err) {
    logger.warn(
      "EarlyDetection",
      `FundamentalAcceleration 로드 실패: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

/**
 * EarlyDetectionData를 프롬프트용 텍스트로 포맷한다.
 * 3개 카테고리 모두 비어있으면 빈 문자열 반환.
 */
export function formatEarlyDetectionContext(data: EarlyDetectionData): string {
  const sections: string[] = [];

  if (data.phase1Late.length > 0) {
    const rows = data.phase1Late.map((s) => {
      const slope = s.ma150Slope != null ? s.ma150Slope.toFixed(4) : "—";
      const vol = s.volRatio != null ? `${s.volRatio.toFixed(1)}x` : "—";
      return `| ${s.symbol} | ${s.rsScore ?? "—"} | ${slope} | ${vol} | ${s.sector ?? "—"} |`;
    });
    sections.push([
      "### Phase 1 후기 — Phase 2 진입 직전 후보",
      "MA150 기울기 양전환 조짐 + 거래량 증가. 향후 1~3개월 내 Phase 2 전환 가능성.",
      "",
      "| 종목 | RS | MA150기울기 | 거래량비율 | 섹터 |",
      "|------|-----|-----------|----------|------|",
      ...rows,
    ].join("\n"));
  }

  if (data.risingRs.length > 0) {
    const rows = data.risingRs.map((s) => {
      const change = s.rsChange != null ? `+${s.rsChange}` : "—";
      return `| ${s.symbol} | ${s.rsScore ?? "—"} | ${change} | ${s.sector ?? "—"} |`;
    });
    sections.push([
      "### RS 상승 초기 — 시장 미주목 모멘텀",
      "RS 30~60 범위에서 4주 대비 RS 5p+ 상승 중. 초기 모멘텀 포착.",
      "",
      "| 종목 | RS | 4주 RS변화 | 섹터 |",
      "|------|-----|----------|------|",
      ...rows,
    ].join("\n"));
  }

  if (data.accelerating.length > 0) {
    const rows = data.accelerating.map((s) => {
      const eps = s.latestEpsGrowth != null ? `${s.latestEpsGrowth > 0 ? "+" : ""}${s.latestEpsGrowth}%` : "—";
      const rev = s.latestRevenueGrowth != null ? `${s.latestRevenueGrowth > 0 ? "+" : ""}${s.latestRevenueGrowth}%` : "—";
      const accel = [
        s.isEpsAccelerating ? "EPS" : null,
        s.isRevenueAccelerating ? "매출" : null,
      ].filter(Boolean).join("+");
      return `| ${s.symbol} | ${eps} | ${rev} | ${accel} | ${s.sepaGrade} | ${s.sector ?? "—"} |`;
    });
    sections.push([
      "### 펀더멘탈 가속 — 실적 전환 초기",
      "분기 YoY 성장률이 연속 가속하는 패턴 (예: +20% → +30% → +40%). SEPA F등급은 제외됨.",
      "",
      "| 종목 | EPS YoY | 매출 YoY | 가속항목 | SEPA | 섹터 |",
      "|------|---------|---------|---------|------|------|",
      ...rows,
    ].join("\n"));
  }

  if (sections.length === 0) return "";

  return sections.join("\n\n");
}

/**
 * 조기포착 데이터를 로드하고 프롬프트 텍스트로 변환한다.
 * 실패 시 빈 문자열 반환 (토론 중단 방지).
 */
export async function loadEarlyDetectionContext(date: string): Promise<string> {
  try {
    const data = await loadEarlyDetectionData(date);
    const context = formatEarlyDetectionContext(data);

    const totalCount = data.phase1Late.length + data.risingRs.length + data.accelerating.length;
    if (totalCount > 0) {
      logger.info(
        "EarlyDetection",
        `${totalCount}건 로드 (Phase1Late: ${data.phase1Late.length}, RisingRS: ${data.risingRs.length}, Accel: ${data.accelerating.length})`,
      );
    } else {
      logger.info("EarlyDetection", "조기포착 후보 없음");
    }

    return context;
  } catch (err) {
    logger.warn(
      "EarlyDetection",
      `조기포착 데이터 로드 실패 (토론 계속 진행): ${err instanceof Error ? err.message : String(err)}`,
    );
    return "";
  }
}

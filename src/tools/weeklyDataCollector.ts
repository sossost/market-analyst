/**
 * 주간 리포트 데이터 컬렉터.
 *
 * 에이전트가 도구를 호출할 때 반환값을 가로채어 WeeklyReportData를 구성한다.
 * agentLoop.ts는 수정하지 않는다 — 도구의 execute를 래핑하여 결과를 복사해둔다.
 *
 * 설계 결정:
 * - getLeadingSectors(mode: "industry")는 prevWeekDate 유무와 무관하게 항상 JSON을 반환한다.
 *   industries 배열을 캡처하여 industryTop10에 저장한다.
 * - getLeadingSectors(mode: "weekly")는 sectors 배열을 JSON으로 반환한다.
 * - getMarketBreadth(mode: "weekly")는 weeklyTrend + latestSnapshot을 JSON으로 반환한다.
 */

import type { AgentTool } from "./types";
import type {
  WeeklyReportData,
  IndexReturn,
  FearGreedData,
  MarketBreadthData,
  SectorDetail,
  IndustryItem,
  WatchlistStatusData,
  Phase2Stock,
  WatchlistChange,
} from "./schemas/weeklyReportSchema.js";
import { logger } from "@/lib/logger";

/**
 * 도구 실행 결과를 JSON으로 파싱한다.
 * 파싱 실패 시 null 반환.
 */
function tryParseJson(result: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(result) as unknown;
    if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // 텍스트 반환 경로 (industry 모드 등)
  }
  return null;
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * 주간 리포트 데이터 컬렉터.
 * 도구를 래핑하여 실행 결과를 캡처한다.
 */
export class WeeklyDataCollector {
  private readonly _data: Partial<WeeklyReportData> = {};

  /**
   * 도구를 래핑하여 실행 결과를 캡처하는 새 AgentTool을 반환한다.
   * 원본 도구의 name, description, input_schema는 그대로 유지된다.
   *
   * @param tool - 래핑할 원본 도구
   * @param captureAs - WeeklyReportData의 어느 필드에 저장할지
   */
  wrap(
    tool: AgentTool,
    captureAs: keyof WeeklyReportData,
  ): AgentTool {
    const collector = this;

    return {
      definition: tool.definition,
      async execute(input: Record<string, unknown>): Promise<string> {
        const result = await tool.execute(input);
        collector._capture(captureAs, result, input);
        return result;
      },
    };
  }

  /**
   * 캡처된 데이터를 WeeklyReportData로 변환한다.
   * 누락된 필드는 기본값으로 채운다.
   */
  toWeeklyReportData(): WeeklyReportData {
    const data = this._data;

    return {
      indexReturns: (data.indexReturns as IndexReturn[] | undefined) ?? [],
      fearGreed: (data.fearGreed as FearGreedData | null | undefined) ?? null,
      marketBreadth: (data.marketBreadth as MarketBreadthData | undefined) ?? {
        weeklyTrend: [],
        phase1to2Transitions: 0,
        latestSnapshot: {
          date: "",
          totalStocks: 0,
          phaseDistribution: { phase1: 0, phase2: 0, phase3: 0, phase4: 0 },
          phase2Ratio: 0,
          phase2RatioChange: 0,
          marketAvgRs: 0,
          advanceDecline: { advancers: 0, decliners: 0, unchanged: 0, ratio: null },
          newHighLow: { newHighs: 0, newLows: 0, ratio: null },
          breadthScore: null,
          divergenceSignal: null,
          topSectors: [],
        },
      },
      sectorRanking: (data.sectorRanking as SectorDetail[] | undefined) ?? [],
      industryTop10: (data.industryTop10 as IndustryItem[] | undefined) ?? [],
      watchlist: (data.watchlist as WatchlistStatusData | undefined) ?? {
        summary: { totalActive: 0, phaseChanges: [], avgPnlPercent: 0 },
        items: [],
      },
      gate5Candidates: (data.gate5Candidates as Phase2Stock[] | undefined) ?? [],
      watchlistChanges: (data.watchlistChanges as WeeklyReportData["watchlistChanges"] | undefined) ?? {
        registered: [],
        exited: [],
        pending4of5: [],
      },
    };
  }

  private _capture(
    captureAs: keyof WeeklyReportData,
    result: string,
    input: Record<string, unknown>,
  ): void {
    const parsed = tryParseJson(result);

    if (parsed == null) {
      // 텍스트 반환 경로 (industry 모드 등) — 캡처 불가
      logger.info("WeeklyDataCollector", `${String(captureAs)}: 텍스트 반환 — JSON 캡처 생략`);
      return;
    }

    if (typeof parsed.error === "string") {
      logger.warn("WeeklyDataCollector", `${String(captureAs)}: 도구 에러 — ${parsed.error}`);
      return;
    }

    switch (captureAs) {
      case "indexReturns":
        this._captureIndexReturns(parsed);
        break;
      case "marketBreadth":
        this._captureMarketBreadth(parsed);
        break;
      case "sectorRanking":
        // getLeadingSectors는 mode에 따라 섹터 또는 업종 데이터를 반환한다.
        // mode: "weekly" → sectorRanking 캡처
        // mode: "industry" → industryTop10 캡처 시도
        if (input.mode === "industry") {
          this._captureIndustryTop10(parsed, input);
        } else {
          this._captureSectorRanking(parsed, input);
        }
        break;
      case "watchlist":
        this._captureWatchlist(parsed);
        break;
      case "gate5Candidates":
        this._captureGate5Candidates(parsed);
        break;
      case "watchlistChanges":
        this._captureWatchlistChange(parsed, input);
        break;
      default:
        // fearGreed는 indexReturns 내부에서 처리
        break;
    }
  }

  private _captureIndexReturns(parsed: Record<string, unknown>): void {
    const indices = parsed.indices;
    if (!isArray(indices)) return;

    this._data.indexReturns = indices as IndexReturn[];
    logger.info("WeeklyDataCollector", `indexReturns: ${indices.length}개 캡처`);

    // fearGreed는 get_index_returns 반환값에 포함
    if (parsed.fearGreed != null) {
      this._data.fearGreed = parsed.fearGreed as FearGreedData;
      logger.info("WeeklyDataCollector", "fearGreed 캡처 완료");
    }
  }

  private _captureMarketBreadth(parsed: Record<string, unknown>): void {
    if (parsed.mode !== "weekly") return;

    const weeklyTrend = parsed.weeklyTrend;
    const phase1to2Transitions = parsed.phase1to2Transitions;
    const latestSnapshot = parsed.latestSnapshot;

    if (!isArray(weeklyTrend)) return;

    this._data.marketBreadth = {
      weeklyTrend: weeklyTrend as MarketBreadthData["weeklyTrend"],
      phase1to2Transitions:
        typeof phase1to2Transitions === "number" ? phase1to2Transitions : 0,
      latestSnapshot: (latestSnapshot as MarketBreadthData["latestSnapshot"]) ?? {
        date: "",
        totalStocks: 0,
        phaseDistribution: { phase1: 0, phase2: 0, phase3: 0, phase4: 0 },
        phase2Ratio: 0,
        phase2RatioChange: 0,
        marketAvgRs: 0,
        advanceDecline: { advancers: 0, decliners: 0, unchanged: 0, ratio: null },
        newHighLow: { newHighs: 0, newLows: 0, ratio: null },
        breadthScore: null,
        divergenceSignal: null,
        topSectors: [],
      },
    };

    logger.info("WeeklyDataCollector", `marketBreadth: ${weeklyTrend.length}일 추이 캡처`);
  }

  private _captureSectorRanking(
    parsed: Record<string, unknown>,
    input: Record<string, unknown>,
  ): void {
    // mode가 "weekly"인 경우에만 섹터 랭킹 캡처
    if (parsed.mode !== "weekly") return;
    if (input.mode !== "weekly") return;

    const sectors = parsed.sectors;
    if (!isArray(sectors)) return;

    this._data.sectorRanking = sectors as SectorDetail[];
    logger.info("WeeklyDataCollector", `sectorRanking: ${sectors.length}개 섹터 캡처`);
  }

  private _captureIndustryTop10(
    parsed: Record<string, unknown>,
    input: Record<string, unknown>,
  ): void {
    // mode가 "industry"인 경우에만 업종 데이터 캡처
    if (input.mode !== "industry") return;

    // prevWeekDate 유무와 무관하게 항상 JSON으로 industries 배열을 반환한다
    const industries = parsed.industries;
    if (!isArray(industries)) return;

    this._data.industryTop10 = industries as IndustryItem[];
    const path = parsed.prevWeekDate != null ? "주간 변화 경로" : "일간 스냅샷 경로";
    logger.info("WeeklyDataCollector", `industryTop10: ${industries.length}개 업종 캡처 (${path})`);
  }

  private _captureWatchlist(parsed: Record<string, unknown>): void {
    const summary = parsed.summary;
    const items = parsed.items;

    if (!isArray(items)) return;

    this._data.watchlist = {
      summary: (summary as WatchlistStatusData["summary"]) ?? {
        totalActive: 0,
        phaseChanges: [],
        avgPnlPercent: 0,
      },
      items: items as WatchlistStatusData["items"],
    };

    const totalActive =
      typeof (summary as Record<string, unknown>)?.totalActive === "number"
        ? (summary as Record<string, unknown>).totalActive
        : items.length;

    logger.info("WeeklyDataCollector", `watchlist: ${String(totalActive)}개 ACTIVE 종목 캡처`);
  }

  private _captureGate5Candidates(parsed: Record<string, unknown>): void {
    const stocks = parsed.stocks;
    if (!isArray(stocks)) return;

    this._data.gate5Candidates = stocks as Phase2Stock[];
    logger.info("WeeklyDataCollector", `gate5Candidates: ${stocks.length}개 Phase2 종목 캡처`);
  }

  private _captureWatchlistChange(
    parsed: Record<string, unknown>,
    input: Record<string, unknown>,
  ): void {
    const action = input.action as string | undefined;
    const symbol = input.symbol as string | undefined;

    if (symbol == null || action == null) return;

    // action 검증 — 명시적으로 허용된 값만 처리
    const validAction = action === 'register' || action === 'exit' ? action : null;
    if (validAction == null) {
      logger.warn('WeeklyDataCollector', `watchlistChanges: 알 수 없는 action — ${String(action)}`);
      return;
    }

    const isSuccess = parsed.success === true;
    const isBlocked = parsed.blocked === true;

    // gateFailures 배열에서 thesis만 실패했는지 확인
    const gateFailures = parsed.gateFailures;
    const isThesisOnlyBlock =
      isBlocked &&
      isArray(gateFailures) &&
      gateFailures.length === 1 &&
      typeof gateFailures[0] === 'string' && gateFailures[0] === "thesis";

    const reason =
      typeof parsed.reason === "string"
        ? parsed.reason
        : typeof parsed.message === "string"
        ? parsed.message
        : "";

    if (!this._data.watchlistChanges) {
      this._data.watchlistChanges = { registered: [], exited: [], pending4of5: [] };
    }

    const changes = this._data.watchlistChanges as WeeklyReportData["watchlistChanges"];

    const change: WatchlistChange = { symbol, action: validAction, reason };

    if (validAction === "register" && isSuccess) {
      this._data.watchlistChanges = {
        ...changes,
        registered: [...changes.registered, change],
      };
      logger.info("WeeklyDataCollector", `watchlistChanges: ${symbol} 등록 확정`);
    } else if (validAction === "exit" && isSuccess) {
      this._data.watchlistChanges = {
        ...changes,
        exited: [...changes.exited, change],
      };
      logger.info("WeeklyDataCollector", `watchlistChanges: ${symbol} 해제 확정`);
    } else if (validAction === "register" && isThesisOnlyBlock) {
      this._data.watchlistChanges = {
        ...changes,
        pending4of5: [...changes.pending4of5, change],
      };
      logger.info("WeeklyDataCollector", `watchlistChanges: ${symbol} 예비 (4/5 — thesis 미충족)`);
    } else {
      logger.info("WeeklyDataCollector", `watchlistChanges: ${symbol} 미분류 (action=${validAction}, success=${String(isSuccess)}, blocked=${String(isBlocked)})`);
    }
  }
}

/**
 * WeeklyDataCollector 인스턴스를 생성한다.
 * run-weekly-agent.ts에서 호출한다.
 */
export function createWeeklyDataCollector(): WeeklyDataCollector {
  return new WeeklyDataCollector();
}

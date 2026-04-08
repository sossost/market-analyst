/**
 * 일간 리포트 스키마 — 데이터 필드 / 해석 필드 분리
 *
 * DailyReportData  — run-daily-agent.ts가 도구 결과에서 직접 추출. LLM이 채우지 않음.
 * DailyReportInsight — LLM이 텍스트/판단만 작성. 숫자 계산 금지.
 *
 * ⚠️  phase2Ratio는 이미 퍼센트(0~100). 절대 ×100 하지 말 것.
 *     도구 반환값(_note 필드)에도 동일 경고가 포함되어 있음.
 */

// ─── 공통 서브타입 ────────────────────────────────────────────────────────────

/**
 * get_index_returns(mode: 'daily') 반환값의 indices 요소.
 * IndexQuote — 일간 등락률 스냅샷.
 */
export interface DailyIndexReturn {
  symbol: string;
  name: string;
  close: number;
  change: number;
  /** 퍼센트 (e.g. -2.34) */
  changePercent: number;
}

export interface FearGreedData {
  score: number;
  rating: string;
  previousClose: number | null;
  previous1Week: number | null;
  previous1Month: number | null;
}

interface DailyPhaseDistribution {
  phase1: number;
  phase2: number;
  phase3: number;
  phase4: number;
}

interface DailyAdvanceDecline {
  advancers: number;
  decliners: number;
  unchanged: number;
  ratio: number | null;
}

interface DailyNewHighLow {
  newHighs: number;
  newLows: number;
  ratio: number | null;
}

interface DailyBreadthTopSector {
  sector: string;
  avgRs: number;
  groupPhase: number;
}

/**
 * get_market_breadth(mode: 'daily') 반환값.
 * 단일 날짜 시장 브레드스 스냅샷.
 */
export interface DailyBreadthSnapshot {
  date: string;
  totalStocks: number;
  phaseDistribution: DailyPhaseDistribution;
  /** 이미 퍼센트(0~100). ×100 금지 */
  phase2Ratio: number;
  phase2RatioChange: number;
  marketAvgRs: number;
  advanceDecline: DailyAdvanceDecline;
  newHighLow: DailyNewHighLow;
  breadthScore: number | null;
  /** 전일 대비 Breadth Score 변화. null = 전일 데이터 없음 */
  breadthScoreChange: number | null;
  divergenceSignal: string | null;
  topSectors: DailyBreadthTopSector[];
  /** 당일 Phase 1→2 신규 진입 종목 수. null = 데이터 없음 */
  phase1to2Count1d: number | null;
  /** 당일 Phase 2→3 이탈 종목 수. null = 데이터 없음 */
  phase2to3Count1d: number | null;
  /** Phase 2 순유입 = 진입 - 이탈. null = 데이터 없음 */
  phase2NetFlow: number | null;
  /** 5일 일평균 진입 수 (phase1_to2_count_5d / 5). 하이라이트 기준 */
  phase2EntryAvg5d: number | null;
}

interface DailySectorTopIndustry {
  industry: string;
  avgRs: number;
  groupPhase: number;
  /** 이미 퍼센트(0~100). ×100 금지 */
  phase2Ratio: number;
}

/**
 * get_leading_sectors(mode: 'daily') 반환값의 sectors 요소.
 * 전일 대비 RS/순위 비교 포함.
 */
export interface DailySectorItem {
  sector: string;
  avgRs: number;
  rsRank: number;
  stockCount: number;
  change4w: number | null;
  change8w: number | null;
  change12w: number | null;
  groupPhase: number;
  prevGroupPhase: number | null;
  /** 이미 퍼센트(0~100). ×100 금지 */
  phase2Ratio: number;
  maOrderedRatio: number;
  phase1to2Count5d: number;
  topIndustries: DailySectorTopIndustry[];
  /** 전일 순위 (전일 데이터 없으면 null) */
  prevDayRank: number | null;
  /** 순위 변화 (양수=상승, 음수=하락) */
  rankChange: number | null;
  prevDayAvgRs: number | null;
  rsChange: number | null;
}

/**
 * get_leading_sectors(mode: 'industry') 반환값의 industries 요소.
 * 섹터 종속 없는 전체 업종 RS 랭킹 — 섹터당 최대 2개 제한 적용.
 */
export interface DailyIndustryItem {
  industry: string;
  sector: string;
  avgRs: number;
  rsRank: number;
  groupPhase: number;
  /** 이미 퍼센트(0~100). ×100 금지 */
  phase2Ratio: number | null;
  change4w: number | null;
  change8w: number | null;
  change12w: number | null;
  sectorAvgRs: number | null;
  sectorRsRank: number | null;
  divergence: number | null;
  changeWeek: number | null;
}

type UnusualCondition = "big_move" | "high_volume" | "phase_change";

/**
 * get_unusual_stocks 반환값의 stocks 요소.
 * 복합 조건(등락률 ±5%, 거래량 2배, Phase 전환) 중 2개 이상 충족 종목.
 */
export interface DailyUnusualStock {
  symbol: string;
  companyName: string | null;
  close: number;
  /** 퍼센트 (e.g. -6.31) */
  dailyReturn: number;
  volume: number;
  volRatio: number;
  phase: number;
  prevPhase: number | null;
  rsScore: number;
  sector: string | null;
  industry: string | null;
  conditions: UnusualCondition[];
  /** Phase 2 종목의 급락 플래그 */
  phase2WithDrop: boolean;
  /** 역분할/액분할 의심 플래그 */
  splitSuspect: boolean;
}

/**
 * get_rising_rs 반환값의 stocks 요소.
 * Phase 1/2 + RS 30~70 범위에서 가속 상승 중인 초기 모멘텀 종목.
 */
export interface DailyRisingRSStock {
  symbol: string;
  phase: number;
  rsScore: number;
  rsScore4wAgo: number | null;
  rsChange: number | null;
  ma150Slope: number | null;
  pctFromLow52w: number | null;
  isExtremePctFromLow: boolean;
  volRatio: number | null;
  sector: string | null;
  industry: string | null;
  sectorAvgRs: number | null;
  sectorChange4w: number | null;
  sectorGroupPhase: number | null;
  sepaGrade: string | null;
  marketCap: number | null;
}

interface DailyWatchlistPhaseChange {
  symbol: string;
  entryPhase: number;
  currentPhase: number | null;
  daysTracked: number;
}

interface DailyWatchlistSummary {
  totalActive: number;
  phaseChanges: DailyWatchlistPhaseChange[];
  avgPnlPercent: number;
}

interface DailyWatchlistTrajectoryPoint {
  date: string;
  phase: number;
  rsScore: number | null;
}

interface DailyWatchlistItem {
  symbol: string;
  entryDate: string;
  trackingEndDate: string | null;
  daysTracked: number;
  entryPhase: number;
  currentPhase: number | null;
  entryRsScore: number | null;
  currentRsScore: number | null;
  entrySector: string | null;
  entryIndustry: string | null;
  entrySepaGrade: string | null;
  priceAtEntry: number | null;
  currentPrice: number | null;
  pnlPercent: number | null;
  maxPnlPercent: number | null;
  sectorRelativePerf: number | null;
  /** 일간 리포트: 최근 7일 궤적만 포함 (include_trajectory: false) */
  phaseTrajectory: DailyWatchlistTrajectoryPoint[];
  entryReason: string | null;
  hasThesisBasis: boolean;
}

/**
 * get_watchlist_status(include_trajectory: false) 반환값.
 * 일간 리포트: 최근 7일 궤적만 포함.
 */
export interface DailyWatchlistData {
  summary: DailyWatchlistSummary;
  items: DailyWatchlistItem[];
}

// ─── 시장 환경 멀티게이트 ────────────────────────────────────────────────────

/**
 * 단일 시장 환경 게이트 결과.
 * passed: 조건 충족 여부. detail: 화면 표시용 수치 문자열.
 */
export interface MarketPositionGate {
  label: string;
  passed: boolean;
  detail: string;
}

/**
 * getMarketPosition 도구 반환값.
 * 4개 게이트(MA200, MA50, 신고가>신저가, A/D>1.0)의 집계.
 */
export interface MarketPositionData {
  gates: MarketPositionGate[];
  passCount: number;
  totalCount: number;
  date: string;
}

// ─── Thesis-Aligned Candidates ────────────────────────────────────────────────

/**
 * ACTIVE thesis/narrative_chain의 수혜 종목 중 기술적 준비 완료(Phase ≥ 2, RS ≥ 70) 종목.
 * narrative_chains.beneficiary_tickers × stock_phases 조인 결과.
 */
export interface ThesisAlignedCandidate {
  symbol: string;
  phase: number;
  rsScore: number;
  sepaGrade: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  megatrend: string;
  bottleneck: string;
  chainStatus: string;
}

// ─── 데이터 컨테이너 (도구 반환값 직접 매핑) ──────────────────────────────────

/**
 * 도구 실행 결과를 직접 수집한 구조화 데이터.
 * LLM이 절대 이 필드에 숫자를 작성하지 않는다.
 * run-daily-agent.ts가 도구 반환값에서 직접 추출하여 채운다.
 */
export interface DailyReportData {
  /** get_index_returns(mode: 'daily') 반환값 */
  indexReturns: DailyIndexReturn[];
  /** get_index_returns에 포함된 CNN Fear & Greed */
  fearGreed: FearGreedData | null;
  /** get_market_breadth(mode: 'daily') 반환값 */
  marketBreadth: DailyBreadthSnapshot;
  /** get_leading_sectors(mode: 'daily') 반환값 — 전체 섹터 */
  sectorRanking: DailySectorItem[];
  /** get_leading_sectors(mode: 'industry') 반환값 — 섹터당 최대 2개 제한 Top 10 */
  industryTop10: DailyIndustryItem[];
  /** get_unusual_stocks 반환값 */
  unusualStocks: DailyUnusualStock[];
  /** get_rising_rs 반환값 */
  risingRS: DailyRisingRSStock[];
  /** get_watchlist_status(include_trajectory: false) 반환값 */
  watchlist: DailyWatchlistData;
  /** getMarketPosition 반환값. 수집 실패 시 null */
  marketPosition: MarketPositionData | null;
  /** ACTIVE thesis 수혜주 중 기술적 준비 완료 종목. 수집 실패 시 빈 배열 */
  thesisAlignedCandidates: ThesisAlignedCandidate[];
}

// ─── 해석 컨테이너 (LLM 텍스트 전용) ─────────────────────────────────────────

type MarketTemperature = "bullish" | "neutral" | "bearish";

/**
 * LLM이 작성하는 해석 블록.
 * 숫자 계산, 테이블 렌더링, 카운팅 금지.
 * 텍스트 판단과 서사만 작성한다.
 */
export interface DailyReportInsight {
  /** 시장 온도 판정 — bullish / neutral / bearish */
  marketTemperature: MarketTemperature;
  /** 시장 온도 레이블 — e.g. "약세 — 하락 3일째" */
  marketTemperatureLabel: string;
  /** 시장 온도 판단 근거. 2~3문장. 데이터 나열 금지, 해석만. */
  marketTemperatureRationale: string;
  /** 특이종목 공통 테마 또는 이질적 패턴 해석. 2~3문장. 없으면 "해당 없음". */
  unusualStocksNarrative: string;
  /** RS 상승 초기 종목군의 공통 업종/테마 관찰. 1~2문장. 없으면 "해당 없음". */
  risingRSNarrative: string;
  /** ACTIVE 관심종목 서사 유효성. 1~2문장. 없으면 "해당 없음". */
  watchlistNarrative: string;
  /** 토론 인사이트가 있는 경우 2~3문장 핵심만. 없으면 "해당 없음". */
  todayInsight: string;
  /** 브레드스 추세 + 맥락 한줄 해석. 1~2문장. 없으면 "해당 없음". */
  breadthNarrative: string;
  /** thesis 수혜주 기술적 상태 종합 해석. 1~2문장. 없으면 "해당 없음". */
  thesisAlignedNarrative: string;
  /** Discord 핵심 요약. 3~5줄. 지수 변화 + Phase2 비율 + 특이종목 수 요약. 링크 금지. */
  discordMessage: string;
}

/**
 * 누락된 해석 필드를 기본값으로 채운다.
 * 에이전트가 일부 필드를 생략한 경우 안전 폴백용.
 */
export function fillInsightDefaults(
  raw: Record<string, unknown>,
): DailyReportInsight {
  const defaults: DailyReportInsight = {
    marketTemperature: "neutral",
    marketTemperatureLabel: "중립 — 관망",
    marketTemperatureRationale: "",
    unusualStocksNarrative: "해당 없음",
    risingRSNarrative: "해당 없음",
    watchlistNarrative: "해당 없음",
    todayInsight: "해당 없음",
    breadthNarrative: "해당 없음",
    thesisAlignedNarrative: "해당 없음",
    discordMessage: "",
  };

  const validTemperatures: MarketTemperature[] = ["bullish", "neutral", "bearish"];
  const temperature = raw["marketTemperature"];

  return {
    marketTemperature: validTemperatures.includes(temperature as MarketTemperature)
      ? (temperature as MarketTemperature)
      : defaults.marketTemperature,
    marketTemperatureLabel:
      typeof raw["marketTemperatureLabel"] === "string" && raw["marketTemperatureLabel"] !== ""
        ? raw["marketTemperatureLabel"]
        : defaults.marketTemperatureLabel,
    marketTemperatureRationale:
      typeof raw["marketTemperatureRationale"] === "string"
        ? raw["marketTemperatureRationale"]
        : defaults.marketTemperatureRationale,
    unusualStocksNarrative:
      typeof raw["unusualStocksNarrative"] === "string"
        ? raw["unusualStocksNarrative"]
        : defaults.unusualStocksNarrative,
    risingRSNarrative:
      typeof raw["risingRSNarrative"] === "string"
        ? raw["risingRSNarrative"]
        : defaults.risingRSNarrative,
    watchlistNarrative:
      typeof raw["watchlistNarrative"] === "string"
        ? raw["watchlistNarrative"]
        : defaults.watchlistNarrative,
    todayInsight:
      typeof raw["todayInsight"] === "string"
        ? raw["todayInsight"]
        : defaults.todayInsight,
    breadthNarrative:
      typeof raw["breadthNarrative"] === "string"
        ? raw["breadthNarrative"]
        : defaults.breadthNarrative,
    thesisAlignedNarrative:
      typeof raw["thesisAlignedNarrative"] === "string"
        ? raw["thesisAlignedNarrative"]
        : defaults.thesisAlignedNarrative,
    discordMessage:
      typeof raw["discordMessage"] === "string"
        ? raw["discordMessage"]
        : defaults.discordMessage,
  };
}

import type { ThesisAlignedData } from "@/lib/thesisAlignedCandidates.js";
import type { Phase2Segment } from "@/lib/phase2Segment.js";

/**
 * 주간 리포트 스키마 — 데이터 필드 / 해석 필드 분리
 *
 * WeeklyReportData  — run-weekly-agent.ts가 도구 결과에서 직접 추출. LLM이 채우지 않음.
 * WeeklyReportInsight — LLM이 텍스트/판단만 작성. 숫자 계산 금지.
 *
 * ⚠️  phase2Ratio는 이미 퍼센트(0~100). 절대 ×100 하지 말 것.
 *     도구 반환값(_note 필드)에도 동일 경고가 포함되어 있음.
 */

// ─── 공통 서브타입 ────────────────────────────────────────────────────────────

type ClosePosition = "near_high" | "near_low" | "mid";

export interface IndexReturn {
  symbol: string;
  name: string;
  weekStartClose: number;
  weekEndClose: number;
  weeklyChange: number;
  weeklyChangePercent: number;
  weekHigh: number;
  weekLow: number;
  closePosition: ClosePosition;
  tradingDays: number;
}

export interface FearGreedData {
  score: number;
  rating: string;
  previousClose: number | null;
  previous1Week: number | null;
  previous1Month: number | null;
}

interface WeeklyTrendPoint {
  date: string;
  /** 이미 퍼센트(0~100). ×100 금지 */
  phase2Ratio: number;
  marketAvgRs: number;
}

interface PhaseDistribution {
  phase1: number;
  phase2: number;
  phase3: number;
  phase4: number;
}

interface AdvanceDecline {
  advancers: number;
  decliners: number;
  unchanged: number;
  ratio: number | null;
}

interface NewHighLow {
  newHighs: number;
  newLows: number;
  ratio: number | null;
}

interface BreadthTopSector {
  sector: string;
  avgRs: number;
  groupPhase: number;
}

interface BreadthLatestSnapshot {
  date: string;
  totalStocks: number;
  phaseDistribution: PhaseDistribution;
  /** 이미 퍼센트(0~100). ×100 금지 */
  phase2Ratio: number;
  phase2RatioChange: number;
  marketAvgRs: number;
  advanceDecline: AdvanceDecline;
  newHighLow: NewHighLow;
  breadthScore: number | null;
  breadthScoreChange: number | null;
  divergenceSignal: string | null;
  topSectors: BreadthTopSector[];
}

export interface MarketBreadthData {
  weeklyTrend: WeeklyTrendPoint[];
  phase1to2Transitions: number;
  latestSnapshot: BreadthLatestSnapshot;
}

interface SectorTopIndustry {
  industry: string;
  avgRs: number;
  groupPhase: number;
  /** 이미 퍼센트(0~100). ×100 금지 */
  phase2Ratio: number;
}

export interface SectorDetail {
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
  topIndustries: SectorTopIndustry[];
  prevWeekRank: number | null;
  rankChange: number | null;
  prevWeekAvgRs: number | null;
  rsChange: number | null;
}

export interface IndustryItem {
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

interface TrajectoryPoint {
  date: string;
  phase: number;
  rsScore: number | null;
}

export interface WatchlistItem {
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
  phaseTrajectory: TrajectoryPoint[];
  entryReason: string | null;
  hasThesisBasis: boolean;
  /** Phase 2 연속 진입 시작일 (YYYY-MM-DD). Phase 2 아니면 null */
  phase2Since: string | null;
  /** Phase 2 경과일. null = Phase 2 아니거나 데이터 없음 */
  phase2SinceDays: number | null;
  /** Phase 2 구간 분류. 초입(1~5일)/진행(6~20일)/확립(21일+). null = 해당 없음 */
  phase2Segment: Phase2Segment | null;
  /** entry_date - phase2_since 일수. phase2_since 없으면 null */
  detectionLag?: number | null;
  /** phase_trajectory 최근 14일 중 뒤에서부터 연속 Phase 2 일수 */
  recentPhase2Streak?: number;
  /** 종목 티어 (standard/featured) */
  tier?: string;
  /** 종목 소스 (etl_auto/agent/thesis_aligned) */
  source?: string;
}

interface WatchlistPhaseChange {
  symbol: string;
  entryPhase: number;
  currentPhase: number | null;
  daysTracked: number;
}

interface WatchlistSummary {
  totalActive: number;
  phaseChanges: WatchlistPhaseChange[];
  avgPnlPercent: number;
}

export interface WatchlistStatusData {
  summary: WatchlistSummary;
  items: WatchlistItem[];
}

export interface Phase2Stock {
  symbol: string;
  phase: number;
  prevPhase: number | null;
  isNewPhase2: boolean;
  rsScore: number;
  ma150Slope: number | null;
  pctFromHigh52w: number | null;
  pctFromLow52w: number | null;
  isExtremePctFromLow: boolean;
  conditionsMet: string[];
  volRatio: number | null;
  volumeConfirmed: boolean;
  breakoutSignal: string;
  sector: string | null;
  industry: string | null;
  sepaGrade: 'S' | 'A' | 'B' | 'C' | 'F' | null;
}

export interface WatchlistChange {
  symbol: string;
  action: 'register' | 'exit';
  reason: string;
}

export interface PortfolioRegistration {
  symbol: string;
  reason: string;
  thesisId?: number | null;
}

export interface PortfolioExit {
  symbol: string;
  reason: string;
}

// ─── Phase 2 조기포착 신호 서브타입 ─────────────────────────────────────────

export interface VcpCandidate {
  symbol: string;
  bbWidthCurrent: number | null;
  bbWidthAvg60d: number | null;
  atr14Percent: number | null;
  bodyRatio: number | null;
  ma20Ma50DistancePercent: number | null;
  sector: string | null;
  industry: string | null;
  phase: number | null;
  rsScore: number | null;
}

export interface ConfirmedBreakout {
  symbol: string;
  breakoutPercent: number | null;
  volumeRatio: number | null;
  isPerfectRetest: boolean;
  ma20DistancePercent: number | null;
  sector: string | null;
  industry: string | null;
  phase: number | null;
  rsScore: number | null;
}

export interface SectorLagPattern {
  leaderEntity: string;
  followerEntity: string;
  entityType: string;
  transition: string;
  sampleCount: number;
  avgLagDays: number | null;
  medianLagDays: number | null;
  stddevLagDays: number | null;
  pValue: number | null;
  lastObservedAt: string | null;
  lastLagDays: number | null;
}

// ─── 데이터 컨테이너 (도구 반환값 직접 매핑) ──────────────────────────────────

/**
 * 도구 실행 결과를 직접 수집한 구조화 데이터.
 * LLM이 절대 이 필드에 숫자를 작성하지 않는다.
 * run-weekly-agent.ts가 도구 반환값에서 직접 추출하여 채운다.
 */
export interface WeeklyReportData {
  /** get_index_returns(mode: weekly) 반환값 */
  indexReturns: IndexReturn[];
  /** get_index_returns에 포함된 CNN Fear & Greed */
  fearGreed: FearGreedData | null;
  /** get_market_breadth(mode: weekly) 반환값 */
  marketBreadth: MarketBreadthData;
  /** get_leading_sectors(mode: weekly) 반환값 — 전체 섹터 */
  sectorRanking: SectorDetail[];
  /** get_leading_sectors(mode: industry) 반환값 — changeWeek 기준 Top 10 */
  industryTop10: IndustryItem[];
  /** get_watchlist_status 반환값 */
  watchlist: WatchlistStatusData;
  /** get_phase2_stocks 반환값 */
  gate5Candidates: Phase2Stock[];
  /** save_watchlist 결과 캡처 — 등록/해제 */
  watchlistChanges: {
    registered: WatchlistChange[];
    exited: WatchlistChange[];
  };
  /** LLM이 판단한 포트폴리오 승격 종목 (포스트-LLM 실행) */
  portfolioRegistrations: PortfolioRegistration[];
  /** LLM이 판단한 포트폴리오 탈락 종목 (포스트-LLM 실행) */
  portfolioExits: PortfolioExit[];
  /** buildThesisAlignedCandidates 반환값. 수집 실패 시 null */
  thesisAlignedCandidates: ThesisAlignedData | null;
  /** get_vcp_candidates 반환값. 수집 실패 시 null */
  vcpCandidates: VcpCandidate[] | null;
  /** get_confirmed_breakouts 반환값. 수집 실패 시 null */
  confirmedBreakouts: ConfirmedBreakout[] | null;
  /** get_sector_lag_patterns 반환값. 수집 실패 시 null */
  sectorLagPatterns: SectorLagPattern[] | null;
}

// ─── 해석 컨테이너 (LLM 텍스트 전용) ─────────────────────────────────────────

type MarketTemperature = "bullish" | "neutral" | "bearish";

/**
 * LLM이 작성하는 해석 블록.
 * 숫자 계산, 테이블 렌더링, 카운팅 금지.
 * 텍스트 판단과 서사만 작성한다.
 */
export interface WeeklyReportInsight {
  /** 시장 온도 판정 — bullish / neutral / bearish */
  marketTemperature: MarketTemperature;
  /** 시장 온도 레이블 — e.g. "중립 — 관망" */
  marketTemperatureLabel: string;
  /** 섹터 로테이션 해석: 구조적 상승 vs 일회성 반등 판단, 2주 연속 유지 섹터 */
  sectorRotationNarrative: string;
  /** 업종 RS 자금 흐름 해석: Top 10 업종의 의미, 섹터 내 집중도 */
  industryFlowNarrative: string;
  /** 관심종목 서사 유효성: Phase 궤적이 thesis를 지지하는지 */
  watchlistNarrative: string;
  /** 5중 게이트 결과 서술: 등록/해제 판단 근거 */
  gate5Summary: string;
  /** 리스크 요인: 다음 주 주의해야 할 매크로/기술적 리스크 */
  riskFactors: string;
  /** 다음 주 관전 포인트: 확인이 필요한 시그널과 지표 */
  nextWeekWatchpoints: string;
  /** Thesis 기반 시나리오: 다음 주 확인할 체크포인트 */
  thesisScenarios: string;
  /** 토론 인사이트: thesis 간 충돌/강화, 이번 주 데이터가 어느 thesis를 지지하는지 */
  debateInsight: string;
  /** 서사 체인 진화: narrative chain이 이번 주 어떻게 전개됐는지 (확장/약화/분기) */
  narrativeEvolution: string;
  /** Thesis 적중률: 과거 thesis 검증 결과가 현재 thesis 신뢰도에 미치는 영향 */
  thesisAccuracy: string;
  /** 레짐 맥락 해석: 현재 시장 레짐과 전략적 포지셔닝 */
  regimeContext: string;
  /** 브레드스 해석: Phase 2 비율 주간 궤적 + A/D + 신고가/저가 종합 → 확장/수축 판단 */
  breadthNarrative?: string;
  /** 서사 수혜 후보 도입부: 현재 어떤 서사가 활성화 중이고, 수혜 후보의 의미 해석 */
  thesisAlignedNarrative?: string;
  /** Discord 핵심 요약 (3~5줄). 텍스트 전용, 링크 금지 */
  discordMessage: string;
  /**
   * 이번 주 포트폴리오(source='agent') 신규 승격 목록.
   * 포스트-LLM 단계에서 save_tracked_stock을 통해 실제 DB에 등록된다.
   */
  portfolioRegistrations?: PortfolioRegistration[];
  /**
   * 이번 주 포트폴리오(source='agent') 탈락 목록.
   * 포스트-LLM 단계에서 save_tracked_stock을 통해 실제 DB에서 해제된다.
   */
  portfolioExits?: PortfolioExit[];
}

// ─── 런타임 유효성 검증 ────────────────────────────────────────────────────────

/**
 * WeeklyReportInsight의 필수 필드가 모두 채워졌는지 검증한다.
 * 에이전트 응답을 WeeklyReportInsight로 캐스팅하기 전에 호출한다.
 */
export function validateWeeklyReportInsight(
  raw: Record<string, unknown>,
): boolean {
  const requiredFields: (keyof WeeklyReportInsight)[] = [
    "marketTemperature",
    "marketTemperatureLabel",
    "sectorRotationNarrative",
    "industryFlowNarrative",
    "watchlistNarrative",
    "gate5Summary",
    "riskFactors",
    "nextWeekWatchpoints",
    "thesisScenarios",
    "debateInsight",
    "narrativeEvolution",
    "thesisAccuracy",
    "regimeContext",
    "discordMessage",
  ];

  for (const field of requiredFields) {
    if (raw[field] == null || raw[field] === "") return false;
  }

  const temperature = raw["marketTemperature"];
  const validTemperatures: MarketTemperature[] = ["bullish", "neutral", "bearish"];
  if (!validTemperatures.includes(temperature as MarketTemperature)) return false;

  return true;
}

/**
 * 누락된 해석 필드를 기본값으로 채운다.
 * 에이전트가 일부 필드를 생략한 경우 안전 폴백용.
 */
export function fillInsightDefaults(
  raw: Record<string, unknown>,
): WeeklyReportInsight {
  const defaults: WeeklyReportInsight = {
    marketTemperature: "neutral",
    marketTemperatureLabel: "중립 — 관망",
    sectorRotationNarrative: "",
    industryFlowNarrative: "",
    watchlistNarrative: "",
    gate5Summary: "",
    riskFactors: "",
    nextWeekWatchpoints: "",
    thesisScenarios: "",
    debateInsight: "",
    narrativeEvolution: "",
    thesisAccuracy: "",
    breadthNarrative: "",
    regimeContext: "",
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
    sectorRotationNarrative:
      typeof raw["sectorRotationNarrative"] === "string"
        ? raw["sectorRotationNarrative"]
        : defaults.sectorRotationNarrative,
    industryFlowNarrative:
      typeof raw["industryFlowNarrative"] === "string"
        ? raw["industryFlowNarrative"]
        : defaults.industryFlowNarrative,
    watchlistNarrative:
      typeof raw["watchlistNarrative"] === "string"
        ? raw["watchlistNarrative"]
        : defaults.watchlistNarrative,
    gate5Summary:
      typeof raw["gate5Summary"] === "string"
        ? raw["gate5Summary"]
        : defaults.gate5Summary,
    riskFactors:
      typeof raw["riskFactors"] === "string"
        ? raw["riskFactors"]
        : defaults.riskFactors,
    nextWeekWatchpoints:
      typeof raw["nextWeekWatchpoints"] === "string"
        ? raw["nextWeekWatchpoints"]
        : defaults.nextWeekWatchpoints,
    thesisScenarios:
      typeof raw["thesisScenarios"] === "string"
        ? raw["thesisScenarios"]
        : defaults.thesisScenarios,
    debateInsight:
      typeof raw["debateInsight"] === "string"
        ? raw["debateInsight"]
        : defaults.debateInsight,
    narrativeEvolution:
      typeof raw["narrativeEvolution"] === "string"
        ? raw["narrativeEvolution"]
        : defaults.narrativeEvolution,
    thesisAccuracy:
      typeof raw["thesisAccuracy"] === "string"
        ? raw["thesisAccuracy"]
        : defaults.thesisAccuracy,
    breadthNarrative:
      typeof raw["breadthNarrative"] === "string"
        ? raw["breadthNarrative"]
        : defaults.breadthNarrative,
    regimeContext:
      typeof raw["regimeContext"] === "string"
        ? raw["regimeContext"]
        : defaults.regimeContext,
    discordMessage:
      typeof raw["discordMessage"] === "string"
        ? raw["discordMessage"]
        : defaults.discordMessage,
    portfolioRegistrations: Array.isArray(raw["portfolioRegistrations"])
      ? (raw["portfolioRegistrations"] as PortfolioRegistration[])
      : [],
    portfolioExits: Array.isArray(raw["portfolioExits"])
      ? (raw["portfolioExits"] as PortfolioExit[])
      : [],
  };
}

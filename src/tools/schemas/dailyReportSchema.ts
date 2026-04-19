/**
 * 일간 리포트 스키마 — 데이터 필드 / 해석 필드 분리
 *
 * DailyReportData  — run-daily-agent.ts가 도구 결과에서 직접 추출. LLM이 채우지 않음.
 * DailyReportInsight — LLM이 텍스트/판단만 작성. 숫자 계산 금지.
 *
 * ⚠️  phase2Ratio는 이미 퍼센트(0~100). 절대 ×100 하지 말 것.
 *     도구 반환값(_note 필드)에도 동일 경고가 포함되어 있음.
 */

import type { DivergenceSignal } from "@/lib/utils";

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
  divergenceSignal: DivergenceSignal;
  /** MA50 이상 종목 비율 (%). null = 데이터 없음 */
  pctAboveMa50: number | null;
  topSectors: DailyBreadthTopSector[];
  /** 당일 Phase 1→2 신규 진입 종목 수. null = 데이터 없음 */
  phase1to2Count1d: number | null;
  /** 당일 Phase 2→3 이탈 종목 수. null = 데이터 없음 */
  phase2to3Count1d: number | null;
  /** Phase 2 순유입 = 진입 - 이탈. null = 데이터 없음 */
  phase2NetFlow: number | null;
  /** Phase 2 절대수량 변화 = 금일 phase2_count − 전일 phase2_count (스냅샷 차이). null = 전일 데이터 없음 */
  phase2CountChange: number | null;
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
  /** getMarketPosition 반환값. 수집 실패 시 null */
  marketPosition: MarketPositionData | null;
}

// ─── 해석 컨테이너 (LLM 텍스트 전용) ─────────────────────────────────────────

type MarketTemperature = "bullish" | "neutral" | "bearish";

/**
 * LLM 해석을 headline(핵심 판단 한줄) + detail(정량 근거)로 계층화한 블록.
 * headline: 투자자 눈높이 한줄 요약, 0.95rem 굵게 렌더링.
 * detail: 2~3문장 정량 근거, 0.82rem 연한 색 렌더링.
 */
export interface NarrativeBlock {
  headline: string;
  detail: string;
}

/**
 * 값이 NarrativeBlock 형태인지 타입 안전하게 검사한다.
 */
export function isNarrativeBlock(v: unknown): v is NarrativeBlock {
  return (
    typeof v === "object" &&
    v !== null &&
    "headline" in v &&
    "detail" in v &&
    typeof (v as Record<string, unknown>)["headline"] === "string" &&
    typeof (v as Record<string, unknown>)["detail"] === "string"
  );
}

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
  /** 시장 온도 판단 근거. headline: 핵심 판단 한줄. detail: 2~3문장 근거. */
  marketTemperatureRationale: NarrativeBlock;
  /** 특이종목 공통 테마 또는 이질적 패턴 해석. headline: 테마 요약. detail: 2~3문장 패턴 근거. */
  unusualStocksNarrative: NarrativeBlock;
  /** RS 상승 초기 종목군의 공통 업종/테마 관찰. headline: 업종/테마 방향. detail: 1~2문장 근거. */
  risingRSNarrative: NarrativeBlock;
  /** 토론 인사이트가 있는 경우 2~3문장 핵심만. 없으면 "해당 없음". */
  todayInsight: string;
  /** 브레드스 추세 + 맥락 한줄 해석. headline: 브레드스 판단. detail: 1~2문장 근거. */
  breadthNarrative: NarrativeBlock;
  /** Discord 핵심 요약. 3~5줄. 지수 변화 + Phase2 비율 + 특이종목 수 요약. 링크 금지. */
  discordMessage: string;
}

/**
 * unknown 값을 NarrativeBlock으로 변환한다.
 * - 이미 NarrativeBlock이면 그대로 반환
 * - string이면 { headline: string, detail: "" } 로 변환 (하위 호환 폴백)
 * - 그 외는 기본값 반환
 */
function parseNarrative(raw: unknown): NarrativeBlock {
  if (isNarrativeBlock(raw)) return raw;
  if (typeof raw === "string" && raw !== "") return { headline: raw, detail: "" };
  return { headline: "해당 없음", detail: "" };
}

/**
 * marketTemperatureRationale은 항상 렌더링되므로 "해당 없음" 대신 빈 블록 반환.
 * 다른 narrative 필드와 달리 헤드라인이 없으면 섹션 자체가 비어 보이는 문제를 방지한다.
 */
function parseRationale(raw: unknown): NarrativeBlock {
  const parsed = parseNarrative(raw);
  return parsed.headline === "해당 없음" ? { headline: "", detail: "" } : parsed;
}

/**
 * 누락된 해석 필드를 기본값으로 채운다.
 * 에이전트가 일부 필드를 생략한 경우 안전 폴백용.
 */
export function fillInsightDefaults(
  raw: Record<string, unknown>,
): DailyReportInsight {
  const NARRATIVE_DEFAULT: NarrativeBlock = { headline: "해당 없음", detail: "" };

  const validTemperatures: MarketTemperature[] = ["bullish", "neutral", "bearish"];
  const temperature = raw["marketTemperature"];

  return {
    marketTemperature: validTemperatures.includes(temperature as MarketTemperature)
      ? (temperature as MarketTemperature)
      : "neutral",
    marketTemperatureLabel:
      typeof raw["marketTemperatureLabel"] === "string" && raw["marketTemperatureLabel"] !== ""
        ? raw["marketTemperatureLabel"]
        : "중립 — 관망",
    marketTemperatureRationale: parseRationale(raw["marketTemperatureRationale"]),
    unusualStocksNarrative: parseNarrative(raw["unusualStocksNarrative"]),
    risingRSNarrative: parseNarrative(raw["risingRSNarrative"]),
    todayInsight:
      typeof raw["todayInsight"] === "string"
        ? raw["todayInsight"]
        : "해당 없음",
    breadthNarrative: parseNarrative(raw["breadthNarrative"]),
    discordMessage:
      typeof raw["discordMessage"] === "string"
        ? raw["discordMessage"]
        : "",
  };
}

/**
 * 정량 모델 기반 목표주가 산출 모듈.
 *
 * LLM 호출 없음, 외부 API 호출 없음.
 * 피어 멀티플 중앙값 기반 밸류에이션 + 월가 컨센서스 교차 검증만 수행한다.
 */

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/** P/E 가중치 */
const WEIGHT_PE = 0.5;
/** EV/EBITDA 가중치 */
const WEIGHT_EV_EBITDA = 0.3;
/** P/S 가중치 */
const WEIGHT_PS = 0.2;

/** 컨센서스 대비 괴리율 ALIGNED 임계값 (%) */
const ALIGNMENT_THRESHOLD_LOW = 20;
/** 컨센서스 대비 괴리율 LARGE_DIVERGENT 임계값 (%) */
const ALIGNMENT_THRESHOLD_HIGH = 50;

/** outlier 제거 기준: 중앙값 대비 이 배수 이상이면 제거 */
const OUTLIER_UPPER_RATIO = 3;
/** outlier 제거 기준: 중앙값의 이 분율 이하면 제거 */
const OUTLIER_LOWER_RATIO = 1 / 3;

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

export interface PeerMultiples {
  symbol: string;
  peRatio: number | null;
  evEbitda: number | null;
  psRatio: number | null;
}

export interface MedianMultiples {
  medianPe: number | null;
  medianEvEbitda: number | null;
  medianPs: number | null;
  peerCount: number;
  validPeerCounts: { pe: number; evEbitda: number; ps: number };
}

export interface CompanyMetrics {
  currentPrice: number;
  ttmEps: number | null;
  ttmEbitda: number | null;
  ttmRevenue: number | null;
  marketCap: number | null;
  sharesOutstanding: number | null;
}

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT_DATA';

export interface MultiplePriceTarget {
  targetPrice: number | null;
  upside: number | null;
  peerMedianPe: number | null;
  peerMedianEvEbitda: number | null;
  peerMedianPs: number | null;
  multiplesUsed: string[];
  confidence: ConfidenceLevel;
  note: string | null;
}

export interface ConsensusComparison {
  consensusMedian: number | null;
  consensusHigh: number | null;
  consensusLow: number | null;
  modelTarget: number | null;
  deviationPct: number | null;
  alignment: 'ALIGNED' | 'DIVERGENT' | 'LARGE_DIVERGENT' | 'NO_DATA';
}

export interface PriceTargetResult {
  multipleModel: MultiplePriceTarget;
  consensus: ConsensusComparison;
  finalTarget: number | null;
  finalUpside: number | null;
  generatedAt: string;
}

/** computeConsensusComparison 에 전달하는 컨센서스 입력 */
export interface ConsensusPriceInput {
  targetHigh: number | null;
  targetLow: number | null;
  targetMean: number | null;
  targetMedian: number | null;
}

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

/**
 * 숫자 배열의 중앙값을 반환한다.
 * 빈 배열이면 null을 반환한다.
 */
function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * 중앙값 대비 극단 outlier를 제거한다.
 * 중앙값의 OUTLIER_UPPER_RATIO 배 초과 또는 OUTLIER_LOWER_RATIO 배 미만인 값을 제거한다.
 */
function removeOutliers(values: number[]): number[] {
  const med = median(values);
  if (med == null) return values;

  return values.filter(
    (v) => v <= med * OUTLIER_UPPER_RATIO && v >= med * OUTLIER_LOWER_RATIO,
  );
}

/**
 * 발행주식수를 결정한다. sharesOutstanding이 없으면 marketCap / currentPrice로 근사한다.
 */
function resolveShares(
  sharesOutstanding: number | null,
  marketCap: number | null,
  currentPrice: number,
): number | null {
  if (sharesOutstanding != null) return sharesOutstanding;
  if (marketCap == null || currentPrice === 0) return null;
  return marketCap / currentPrice;
}

/**
 * upside(%)를 계산한다. currentPrice가 0이면 null을 반환한다.
 */
function calcUpside(targetPrice: number, currentPrice: number): number | null {
  if (currentPrice === 0) return null;
  return ((targetPrice - currentPrice) / currentPrice) * 100;
}

/**
 * confidence를 멀티플 사용 수에 따라 결정한다.
 */
function resolveConfidence(count: number): ConfidenceLevel {
  if (count >= 3) return 'HIGH';
  if (count === 2) return 'MEDIUM';
  if (count === 1) return 'LOW';
  return 'INSUFFICIENT_DATA';
}

// ---------------------------------------------------------------------------
// 공개 함수
// ---------------------------------------------------------------------------

/**
 * 피어 멀티플 배열에서 null을 제거하고 outlier를 걸러 중앙값을 산출한다.
 */
export function computeMedianPeerMultiples(peers: PeerMultiples[]): MedianMultiples {
  if (peers.length === 0) {
    return {
      medianPe: null,
      medianEvEbitda: null,
      medianPs: null,
      peerCount: 0,
      validPeerCounts: { pe: 0, evEbitda: 0, ps: 0 },
    };
  }

  const peValues = peers.map((p) => p.peRatio).filter((v): v is number => v != null);
  const evValues = peers.map((p) => p.evEbitda).filter((v): v is number => v != null);
  const psValues = peers.map((p) => p.psRatio).filter((v): v is number => v != null);

  const filteredPe = removeOutliers(peValues);
  const filteredEv = removeOutliers(evValues);
  const filteredPs = removeOutliers(psValues);

  return {
    medianPe: median(filteredPe),
    medianEvEbitda: median(filteredEv),
    medianPs: median(filteredPs),
    peerCount: peers.length,
    validPeerCounts: {
      pe: filteredPe.length,
      evEbitda: filteredEv.length,
      ps: filteredPs.length,
    },
  };
}

/**
 * 피어 중앙값 멀티플과 자사 TTM 지표를 사용해 멀티플 기반 적정가를 산출한다.
 *
 * - P/E 기반: peerMedianPe * ttmEps (ttmEps <= 0이면 제외)
 * - EV/EBITDA 기반: peerMedianEvEbitda * ttmEbitda / shares (ttmEbitda <= 0이면 제외)
 * - P/S 기반: peerMedianPs * ttmRevenue / shares
 * - 가중 평균: P/E 50%, EV/EBITDA 30%, P/S 20% (사용 불가 멀티플 빼고 재분배)
 */
export function computeMultiplePriceTarget(
  company: CompanyMetrics,
  peerMedians: MedianMultiples,
): MultiplePriceTarget {
  const { currentPrice, ttmEps, ttmEbitda, ttmRevenue, marketCap, sharesOutstanding } = company;
  const { medianPe, medianEvEbitda, medianPs } = peerMedians;

  const shares = resolveShares(sharesOutstanding, marketCap, currentPrice);

  const candidates: Array<{ label: string; price: number; weight: number }> = [];

  // P/E 기반
  if (medianPe != null && ttmEps != null && ttmEps > 0) {
    candidates.push({ label: 'P/E', price: medianPe * ttmEps, weight: WEIGHT_PE });
  }

  // EV/EBITDA 기반 (shares 필요)
  if (medianEvEbitda != null && ttmEbitda != null && ttmEbitda > 0 && shares != null) {
    candidates.push({
      label: 'EV/EBITDA',
      price: (medianEvEbitda * ttmEbitda) / shares,
      weight: WEIGHT_EV_EBITDA,
    });
  }

  // P/S 기반 (shares 필요)
  if (medianPs != null && ttmRevenue != null && ttmRevenue > 0 && shares != null) {
    candidates.push({
      label: 'P/S',
      price: (medianPs * ttmRevenue) / shares,
      weight: WEIGHT_PS,
    });
  }

  if (candidates.length === 0) {
    return {
      targetPrice: null,
      upside: null,
      peerMedianPe: medianPe,
      peerMedianEvEbitda: medianEvEbitda,
      peerMedianPs: medianPs,
      multiplesUsed: [],
      confidence: 'INSUFFICIENT_DATA',
      note: '사용 가능한 멀티플 없음 — 적자 또는 데이터 부재',
    };
  }

  // 사용된 멀티플 가중치 재분배
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  const targetPrice = candidates.reduce(
    (sum, c) => sum + c.price * (c.weight / totalWeight),
    0,
  );

  const isSharesApproximated = sharesOutstanding == null && shares != null;

  return {
    targetPrice,
    upside: calcUpside(targetPrice, currentPrice),
    peerMedianPe: medianPe,
    peerMedianEvEbitda: medianEvEbitda,
    peerMedianPs: medianPs,
    multiplesUsed: candidates.map((c) => c.label),
    confidence: resolveConfidence(candidates.length),
    note: isSharesApproximated ? '발행주식수 미확인 — 시총/현재가로 근사' : null,
  };
}

/**
 * 정량 모델 목표가와 월가 컨센서스를 비교하여 alignment를 판정한다.
 */
export function computeConsensusComparison(
  modelTarget: number | null,
  consensus: ConsensusPriceInput | null,
): ConsensusComparison {
  const noData: ConsensusComparison = {
    consensusMedian: null,
    consensusHigh: null,
    consensusLow: null,
    modelTarget,
    deviationPct: null,
    alignment: 'NO_DATA',
  };

  if (modelTarget == null || consensus == null) return noData;

  const { targetMedian, targetHigh, targetLow } = consensus;

  if (targetMedian == null || targetMedian === 0) {
    return { ...noData, consensusHigh: targetHigh, consensusLow: targetLow };
  }

  const deviationPct = ((modelTarget - targetMedian) / targetMedian) * 100;
  const absDeviation = Math.abs(deviationPct);

  const alignment =
    absDeviation <= ALIGNMENT_THRESHOLD_LOW
      ? 'ALIGNED'
      : absDeviation <= ALIGNMENT_THRESHOLD_HIGH
        ? 'DIVERGENT'
        : 'LARGE_DIVERGENT';

  return {
    consensusMedian: targetMedian,
    consensusHigh: targetHigh,
    consensusLow: targetLow,
    modelTarget,
    deviationPct,
    alignment,
  };
}

/**
 * 멀티플 기반 목표가 + 컨센서스 비교를 조합하는 진입점.
 */
export function computePriceTarget(
  company: CompanyMetrics,
  peers: PeerMultiples[],
  consensus: ConsensusPriceInput | null,
): PriceTargetResult {
  const peerMedians = computeMedianPeerMultiples(peers);
  const multipleModel = computeMultiplePriceTarget(company, peerMedians);
  const consensusComparison = computeConsensusComparison(multipleModel.targetPrice, consensus);

  return {
    multipleModel,
    consensus: consensusComparison,
    finalTarget: multipleModel.targetPrice,
    finalUpside: multipleModel.upside,
    generatedAt: new Date().toISOString(),
  };
}

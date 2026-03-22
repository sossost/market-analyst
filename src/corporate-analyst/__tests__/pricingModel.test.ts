import { describe, it, expect } from 'vitest';
import {
  computeMedianPeerMultiples,
  computeMultiplePriceTarget,
  computeConsensusComparison,
  computePriceTarget,
} from '../pricingModel.js';
import type {
  PeerMultiples,
  CompanyMetrics,
  ConsensusPriceInput,
} from '../pricingModel.js';

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

function makePeer(
  symbol: string,
  peRatio: number | null,
  evEbitda: number | null,
  psRatio: number | null,
): PeerMultiples {
  return { symbol, peRatio, evEbitda, psRatio };
}

function makeCompany(overrides: Partial<CompanyMetrics> = {}): CompanyMetrics {
  return {
    currentPrice: 100,
    ttmEps: 5,
    ttmEbitda: 1_000_000,
    ttmRevenue: 5_000_000,
    marketCap: 10_000_000,
    sharesOutstanding: 100_000,
    ...overrides,
  };
}

function makeConsensus(overrides: Partial<ConsensusPriceInput> = {}): ConsensusPriceInput {
  return {
    targetHigh: 130,
    targetLow: 90,
    targetMean: 110,
    targetMedian: 110,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeMedianPeerMultiples
// ---------------------------------------------------------------------------

describe('computeMedianPeerMultiples', () => {
  it('피어 3개 중 P/E null 1개인 경우 나머지 2개 중앙값으로 계산한다', () => {
    const peers: PeerMultiples[] = [
      makePeer('A', 20, 10, 3),
      makePeer('B', null, 12, 4),
      makePeer('C', 30, 14, 5),
    ];

    const result = computeMedianPeerMultiples(peers);

    // peRatio: [20, 30] → 중앙값 25
    expect(result.medianPe).toBe(25);
    expect(result.validPeerCounts.pe).toBe(2);
  });

  it('피어 전부 null인 경우 모든 중앙값이 null이고 INSUFFICIENT_DATA 수준이다', () => {
    const peers: PeerMultiples[] = [
      makePeer('A', null, null, null),
      makePeer('B', null, null, null),
    ];

    const result = computeMedianPeerMultiples(peers);

    expect(result.medianPe).toBeNull();
    expect(result.medianEvEbitda).toBeNull();
    expect(result.medianPs).toBeNull();
    expect(result.validPeerCounts).toEqual({ pe: 0, evEbitda: 0, ps: 0 });
  });

  it('피어 배열이 비어있으면 peerCount 0을 반환한다', () => {
    const result = computeMedianPeerMultiples([]);

    expect(result.peerCount).toBe(0);
    expect(result.medianPe).toBeNull();
  });

  it('outlier를 제거한 후 중앙값을 재계산한다', () => {
    // medianPe 기준값이 20이라면, 3배(60) 초과는 outlier
    // [10, 20, 20, 200] → 1차 중앙값 20 → 200은 3배(60) 초과 → 제거 → [10, 20, 20] → 중앙값 20
    const peers: PeerMultiples[] = [
      makePeer('A', 10, 10, 2),
      makePeer('B', 20, 12, 3),
      makePeer('C', 20, 14, 4),
      makePeer('D', 200, 16, 5),
    ];

    const result = computeMedianPeerMultiples(peers);

    // outlier(200) 제거 후 [10, 20, 20] → 중앙값 20
    expect(result.medianPe).toBe(20);
    expect(result.validPeerCounts.pe).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// computeMultiplePriceTarget
// ---------------------------------------------------------------------------

describe('computeMultiplePriceTarget', () => {
  it('3개 멀티플 모두 사용 가능하면 confidence HIGH를 반환한다', () => {
    const company = makeCompany();
    const peerMedians = computeMedianPeerMultiples([
      makePeer('A', 20, 10, 3),
      makePeer('B', 25, 12, 4),
    ]);

    const result = computeMultiplePriceTarget(company, peerMedians);

    expect(result.multiplesUsed).toContain('P/E');
    expect(result.multiplesUsed).toContain('EV/EBITDA');
    expect(result.multiplesUsed).toContain('P/S');
    expect(result.confidence).toBe('HIGH');
  });

  it('단일 멀티플만 사용 가능한 경우 multiplesUsed에 해당 멀티플만 포함된다', () => {
    const company = makeCompany({
      ttmEbitda: null,
      ttmRevenue: null,
      ttmEps: 5,
    });
    const peerMedians = {
      medianPe: 20,
      medianEvEbitda: null,
      medianPs: null,
      peerCount: 2,
      validPeerCounts: { pe: 2, evEbitda: 0, ps: 0 },
    };

    const result = computeMultiplePriceTarget(company, peerMedians);

    expect(result.multiplesUsed).toEqual(['P/E']);
    expect(result.confidence).toBe('LOW');
    expect(result.targetPrice).toBe(20 * 5); // 100
  });

  it('TTM EPS 음수(적자)이면 P/E를 제외하고 EV/EBITDA와 P/S만 사용한다', () => {
    const company = makeCompany({ ttmEps: -3 });
    const peerMedians = {
      medianPe: 20,
      medianEvEbitda: 10,
      medianPs: 3,
      peerCount: 3,
      validPeerCounts: { pe: 3, evEbitda: 3, ps: 3 },
    };

    const result = computeMultiplePriceTarget(company, peerMedians);

    expect(result.multiplesUsed).not.toContain('P/E');
    expect(result.multiplesUsed).toContain('EV/EBITDA');
    expect(result.multiplesUsed).toContain('P/S');
    expect(result.confidence).toBe('MEDIUM');
  });

  it('피어 전부 null이면 confidence INSUFFICIENT_DATA를 반환한다', () => {
    const company = makeCompany();
    const peerMedians = {
      medianPe: null,
      medianEvEbitda: null,
      medianPs: null,
      peerCount: 0,
      validPeerCounts: { pe: 0, evEbitda: 0, ps: 0 },
    };

    const result = computeMultiplePriceTarget(company, peerMedians);

    expect(result.confidence).toBe('INSUFFICIENT_DATA');
    expect(result.targetPrice).toBeNull();
    expect(result.upside).toBeNull();
  });

  it('사용 가능 멀티플이 0개이면 note에 설명 메시지를 포함한다', () => {
    // ttmEps 음수, ttmEbitda null, ttmRevenue null → 0개
    const company = makeCompany({ ttmEps: -1, ttmEbitda: null, ttmRevenue: null });
    const peerMedians = {
      medianPe: 20,
      medianEvEbitda: 10,
      medianPs: 3,
      peerCount: 3,
      validPeerCounts: { pe: 3, evEbitda: 3, ps: 3 },
    };

    const result = computeMultiplePriceTarget(company, peerMedians);

    expect(result.confidence).toBe('INSUFFICIENT_DATA');
    expect(result.note).not.toBeNull();
  });

  it('currentPrice가 0이면 upside를 null로 반환한다', () => {
    const company = makeCompany({ currentPrice: 0 });
    const peerMedians = {
      medianPe: 20,
      medianEvEbitda: null,
      medianPs: null,
      peerCount: 1,
      validPeerCounts: { pe: 1, evEbitda: 0, ps: 0 },
    };

    const result = computeMultiplePriceTarget(company, peerMedians);

    expect(result.upside).toBeNull();
  });

  it('sharesOutstanding null이면 marketCap/currentPrice 근사값을 사용한다', () => {
    // shares = 10_000_000 / 100 = 100_000
    const company = makeCompany({ sharesOutstanding: null });
    const peerMedians = {
      medianPe: 20,
      medianEvEbitda: 10,
      medianPs: 3,
      peerCount: 3,
      validPeerCounts: { pe: 3, evEbitda: 3, ps: 3 },
    };

    const result = computeMultiplePriceTarget(company, peerMedians);

    expect(result.targetPrice).not.toBeNull();
    expect(result.note).toContain('근사');
  });

  it('sharesOutstanding null이고 marketCap도 null이면 EV/EBITDA와 P/S를 제외하고 P/E만 사용한다', () => {
    const company = makeCompany({
      sharesOutstanding: null,
      marketCap: null,
      ttmEps: 5,
    });
    const peerMedians = {
      medianPe: 20,
      medianEvEbitda: 10,
      medianPs: 3,
      peerCount: 3,
      validPeerCounts: { pe: 3, evEbitda: 3, ps: 3 },
    };

    const result = computeMultiplePriceTarget(company, peerMedians);

    // shares를 계산할 수 없어 EV/EBITDA, P/S 제외
    expect(result.multiplesUsed).toEqual(['P/E']);
    expect(result.targetPrice).toBeCloseTo(20 * 5, 5);
  });

  it('2개 멀티플만 사용 시 가중치가 정확히 재분배된다 (P/E 50% + EV/EBITDA 30% → 62.5%:37.5%)', () => {
    // P/E only: 20 * 5 = 100
    // EV/EBITDA only: 10 * 1_000_000 / 100_000 = 100
    // → 두 값이 100으로 같으므로 targetPrice = 100 (가중치 관계없이)
    const company = makeCompany({ ttmRevenue: null });
    const peerMedians = {
      medianPe: 20,
      medianEvEbitda: 10,
      medianPs: 3,
      peerCount: 3,
      validPeerCounts: { pe: 3, evEbitda: 3, ps: 3 },
    };

    const result = computeMultiplePriceTarget(company, peerMedians);

    expect(result.multiplesUsed).toEqual(['P/E', 'EV/EBITDA']);
    expect(result.confidence).toBe('MEDIUM');

    // 재분배 검증: P/E weight=0.5, EV/EBITDA weight=0.3 → total=0.8
    // P/E 기여: 100 * (0.5/0.8) = 62.5
    // EV/EBITDA 기여: 100 * (0.3/0.8) = 37.5
    // 두 값 모두 100이므로 결과 = 100
    expect(result.targetPrice).toBeCloseTo(100, 5);
  });

  it('가중치 재분배 시 서로 다른 멀티플 목표가를 올바르게 합산한다', () => {
    // P/E: 20 * 10 = 200, EV/EBITDA: 10 * 2_000_000 / 100_000 = 200
    // P/S는 ttmRevenue=null로 제외 → P/E + EV/EBITDA만 사용
    // 재분배: P/E=0.5, EV/EBITDA=0.3, total=0.8
    // targetPrice = 200*(0.5/0.8) + 200*(0.3/0.8) = 200
    const company = makeCompany({
      ttmEps: 10,
      ttmEbitda: 2_000_000,
      ttmRevenue: null,
      marketCap: 10_000_000,
      sharesOutstanding: 100_000,
    });
    const peerMedians = {
      medianPe: 20,
      medianEvEbitda: 10,
      medianPs: 3,
      peerCount: 3,
      validPeerCounts: { pe: 3, evEbitda: 3, ps: 3 },
    };

    const result = computeMultiplePriceTarget(company, peerMedians);

    expect(result.targetPrice).toBeCloseTo(200, 5);
    expect(result.upside).toBeCloseTo(100, 5); // (200-100)/100*100 = 100%
  });
});

// ---------------------------------------------------------------------------
// computeConsensusComparison
// ---------------------------------------------------------------------------

describe('computeConsensusComparison', () => {
  it('컨센서스 없으면 alignment가 NO_DATA이다', () => {
    const result = computeConsensusComparison(120, null);

    expect(result.alignment).toBe('NO_DATA');
    expect(result.deviationPct).toBeNull();
  });

  it('modelTarget null이면 alignment가 NO_DATA이다', () => {
    const result = computeConsensusComparison(null, makeConsensus());

    expect(result.alignment).toBe('NO_DATA');
  });

  it('괴리 20% 이내이면 ALIGNED를 반환한다', () => {
    // consensusMedian=110, modelTarget=120 → deviation=(120-110)/110*100 ≈ 9.09%
    const result = computeConsensusComparison(120, makeConsensus({ targetMedian: 110 }));

    expect(result.alignment).toBe('ALIGNED');
    expect(result.deviationPct).toBeCloseTo(9.09, 1);
  });

  it('괴리 20~50% 사이이면 DIVERGENT를 반환한다', () => {
    // consensusMedian=100, modelTarget=135 → deviation=35%
    const result = computeConsensusComparison(135, makeConsensus({ targetMedian: 100 }));

    expect(result.alignment).toBe('DIVERGENT');
    expect(result.deviationPct).toBeCloseTo(35, 1);
  });

  it('괴리 50% 초과이면 LARGE_DIVERGENT를 반환한다', () => {
    // consensusMedian=100, modelTarget=165 → deviation=65%
    const result = computeConsensusComparison(165, makeConsensus({ targetMedian: 100 }));

    expect(result.alignment).toBe('LARGE_DIVERGENT');
    expect(result.deviationPct).toBeCloseTo(65, 1);
  });

  it('음의 괴리도 절대값으로 판정한다 (하방 35% 괴리 → DIVERGENT)', () => {
    // consensusMedian=100, modelTarget=65 → deviation=-35%
    const result = computeConsensusComparison(65, makeConsensus({ targetMedian: 100 }));

    expect(result.alignment).toBe('DIVERGENT');
    expect(result.deviationPct).toBeCloseTo(-35, 1);
  });

  it('consensusMedian이 null이면 alignment가 NO_DATA이다', () => {
    const result = computeConsensusComparison(120, makeConsensus({ targetMedian: null }));

    expect(result.alignment).toBe('NO_DATA');
  });
});

// ---------------------------------------------------------------------------
// computePriceTarget (통합 진입점)
// ---------------------------------------------------------------------------

describe('computePriceTarget', () => {
  it('정상 입력에서 PriceTargetResult 구조를 반환한다', () => {
    const company = makeCompany();
    const peers = [makePeer('A', 20, 10, 3), makePeer('B', 25, 12, 4)];
    const consensus = makeConsensus();

    const result = computePriceTarget(company, peers, consensus);

    expect(result.multipleModel).toBeDefined();
    expect(result.consensus).toBeDefined();
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.finalTarget).toBe(result.multipleModel.targetPrice);
    expect(result.finalUpside).toBe(result.multipleModel.upside);
  });

  it('피어 없으면 INSUFFICIENT_DATA와 NO_DATA를 함께 반환한다', () => {
    const company = makeCompany();
    const result = computePriceTarget(company, [], null);

    expect(result.multipleModel.confidence).toBe('INSUFFICIENT_DATA');
    expect(result.consensus.alignment).toBe('NO_DATA');
    expect(result.finalTarget).toBeNull();
  });
});

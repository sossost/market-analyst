/**
 * 통계 검정 라이브러리.
 * 학습 승격 시 자기확증편향을 방지하기 위한 이항분포 검정 제공.
 */

export interface BinomialTestResult {
  pValue: number;
  cohenH: number;
  isSignificant: boolean; // p < 0.05 && |h| >= 0.3
}

const SIGNIFICANCE_LEVEL = 0.05;
const MIN_EFFECT_SIZE = 0.3;

/**
 * 로그 이항계수: ln(C(n, k)) = ln(n!) - ln(k!) - ln((n-k)!)
 * 로그 감마 함수(Stirling 근사 대신 직접 합산)로 오버플로 방지.
 */
function lnBinomCoeff(n: number, k: number): number {
  if (k === 0 || k === n) return 0;
  if (k === 1 || k === n - 1) return Math.log(n);

  // ln(C(n, k)) = Σ(i=1..k) ln(n - k + i) - ln(i)
  let result = 0;
  const effectiveK = Math.min(k, n - k);
  for (let i = 1; i <= effectiveK; i++) {
    result += Math.log(n - effectiveK + i) - Math.log(i);
  }
  return result;
}

/**
 * 정확 이항분포 P(X = k) (로그 스케일).
 */
function lnBinomPmf(k: number, n: number, p: number): number {
  if (p === 0) return k === 0 ? 0 : -Infinity;
  if (p === 1) return k === n ? 0 : -Infinity;
  return lnBinomCoeff(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p);
}

/**
 * 정확 이항분포 CDF: P(X <= k) = Σ(i=0..k) P(X=i)
 * 로그-합 트릭(log-sum-exp)으로 수치 안정성 확보.
 */
function binomCdf(k: number, n: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;

  const logTerms: number[] = [];
  for (let i = 0; i <= k; i++) {
    logTerms.push(lnBinomPmf(i, n, p));
  }

  // log-sum-exp trick
  const maxLog = Math.max(...logTerms);
  const sumExp = logTerms.reduce((sum, lt) => sum + Math.exp(lt - maxLog), 0);
  return Math.exp(maxLog + Math.log(sumExp));
}

/**
 * Cohen's h 효과 크기.
 * h = 2 * arcsin(sqrt(observed)) - 2 * arcsin(sqrt(expected))
 */
function cohenH(observed: number, expected: number): number {
  return 2 * Math.asin(Math.sqrt(observed)) - 2 * Math.asin(Math.sqrt(expected));
}

/**
 * 정규분포 상측 꼬리 확률: P(Z > z).
 * 표준 정규분포 CDF의 유리 근사(Abramowitz & Stegun).
 */
function normalSurvival(z: number): number {
  // Φ(z) 근사 후 1 - Φ(z) 반환
  if (z < -8) return 1;
  if (z > 8) return 0;

  const isNegative = z < 0;
  const absZ = Math.abs(z);

  // Abramowitz & Stegun 26.2.17
  const p = 0.2316419;
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;

  const t = 1 / (1 + p * absZ);
  const pdf = Math.exp(-0.5 * absZ * absZ) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - pdf * t * (b1 + t * (b2 + t * (b3 + t * (b4 + t * b5))));

  // P(Z > z) = 1 - Φ(z)
  return isNegative ? cdf : 1 - cdf;
}

/**
 * 이항분포 검정 (one-sided, greater).
 *
 * 귀무가설: 실제 적중률 <= p0 (기본 0.5)
 * 대립가설: 실제 적중률 > p0
 *
 * small n (<=30): 정확 이항분포 (cumulative binomial probability)
 * large n (>30): 정규 근사 (normal approximation with continuity correction)
 */
export function binomialTest(
  hits: number,
  total: number,
  p0: number = 0.5,
): BinomialTestResult {
  // 입력 검증
  if (hits < 0 || total < 0 || hits > total || p0 <= 0 || p0 >= 1) {
    throw new Error(`binomialTest: invalid input — hits=${hits}, total=${total}, p0=${p0}`);
  }

  // 엣지 케이스: 관측 없음
  if (total === 0) {
    return { pValue: 1.0, cohenH: 0, isSignificant: false };
  }

  const observedRate = hits / total;
  const h = cohenH(observedRate, p0);

  let pValue: number;

  if (total <= 30) {
    // 정확 이항분포: P(X >= hits) = 1 - P(X <= hits - 1)
    pValue = 1 - binomCdf(hits - 1, total, p0);
  } else {
    // 정규 근사 (continuity correction)
    const mean = total * p0;
    const stdDev = Math.sqrt(total * p0 * (1 - p0));
    const z = (hits - 0.5 - mean) / stdDev;
    pValue = normalSurvival(z);
  }

  // 부동소수점 보정
  pValue = Math.max(0, Math.min(1, pValue));

  return {
    pValue,
    cohenH: h,
    isSignificant: pValue < SIGNIFICANCE_LEVEL && Math.abs(h) >= MIN_EFFECT_SIZE,
  };
}

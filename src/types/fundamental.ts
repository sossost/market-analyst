/**
 * Minervini SEPA 기반 펀더멘탈 검증 타입.
 */

/** 펀더멘탈 등급 — S는 A급 중 상위 3개 */
export type FundamentalGrade = "S" | "A" | "B" | "C" | "F";

/** SEPA 개별 기준 판정 결과 */
export interface SEPACriteria {
  /** 필수: EPS YoY 성장률 > 25% */
  epsGrowth: CriteriaResult;
  /** 필수: 매출 YoY 성장률 > 25% */
  revenueGrowth: CriteriaResult;
  /** 가점: EPS 성장률이 분기마다 증가 */
  epsAcceleration: CriteriaResult;
  /** 가점: 이익률(net margin) 확대 추세 */
  marginExpansion: CriteriaResult;
  /** 가점: ROE > 17% */
  roe: CriteriaResult;
}

export interface CriteriaResult {
  passed: boolean;
  value: number | null;
  detail: string;
}

/** 펀더멘탈 스코어링 최종 결과 */
export interface FundamentalScore {
  symbol: string;
  grade: FundamentalGrade;
  totalScore: number;
  /** A급 내 랭킹용 — 실적 강도 기반 (높을수록 강함) */
  rankScore: number;
  requiredMet: number; // 0~2
  bonusMet: number; // 0~2 (ROE 미확보로 실질 최대 2)
  criteria: SEPACriteria;
}

/** DB에서 로드한 분기 실적 데이터 (스코어러 입력) */
export interface QuarterlyData {
  periodEndDate: string;
  asOfQ: string; // e.g. "Q1 2025"

  // quarterly_financials
  revenue: number | null;
  netIncome: number | null;
  epsDiluted: number | null;

  // quarterly_ratios
  netMargin: number | null;
}

/** 스코어러 입력: 종목 + 최근 8분기 데이터 */
export interface FundamentalInput {
  symbol: string;
  quarters: QuarterlyData[]; // newest first, up to 8
}

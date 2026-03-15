export type StockPhase = 1 | 2 | 3 | 4

export type SepaGrade = 'S' | 'A' | 'B' | 'C' | 'F'

export interface StockBasicInfo {
  symbol: string
  companyName: string
  sector: string
  industry: string
  marketCap: number | null
}

export interface StockTechnical {
  phase: StockPhase | null
  ma150Slope: number | null
  rsScore: number | null
  pctFromHigh52w: number | null
  pctFromLow52w: number | null
  close: number | null
  priceDate: string | null
  ma20: number | null
  ma50: number | null
  ma100: number | null
  ma200: number | null
}

export interface StockProfile extends StockBasicInfo, StockTechnical {}

export interface SectorContext {
  avgRs: number | null
  rsRank: number | null
  groupPhase: StockPhase | null
  phase2Ratio: number | null
  change4w: number | null
  change8w: number | null
  change12w: number | null
  stockCount: number | null
  /** 섹터 내 해당 종목 RS 순위 (1-based) */
  stockRsRank: number | null
  /** 섹터 내 전체 종목 수 */
  stockTotalInSector: number | null
}

export interface IndustryContext {
  avgRs: number | null
  rsRank: number | null
  groupPhase: StockPhase | null
  phase2Ratio: number | null
  change4w: number | null
  change8w: number | null
  /** 산업 내 해당 종목 RS 순위 (1-based) */
  stockRsRank: number | null
  /** 산업 내 전체 종목 수 */
  stockTotalInIndustry: number | null
}

export interface FundamentalScore {
  grade: SepaGrade | null
  totalScore: number | null
  scoredDate: string | null
  criteria: Record<string, unknown> | null
}

export interface QuarterlyFinancial {
  periodEndDate: string
  epsDiluted: number | null
  revenue: number | null
}

export interface FundamentalData {
  score: FundamentalScore | null
  quarterlyFinancials: QuarterlyFinancial[]
}

export type RecommendationStatus = 'active' | 'closed'

export interface RecommendationRecord {
  recommendationDate: string
  entryPrice: number | null
  currentPrice: number | null
  pnlPercent: number | null
  maxPnlPercent: number | null
  status: RecommendationStatus
  closeDate: string | null
  closeReason: string | null
  entryPhase: number | null
}

export interface StockSearchResult {
  symbol: string
  companyName: string
  sector: string | null
}

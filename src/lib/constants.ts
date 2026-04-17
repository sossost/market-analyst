/**
 * 추천/시그널 경로에서 사용하는 최소 시가총액 기준.
 * $300M 미만 초소형주는 유동성 부족으로 Phase 판정이 노이즈 수준이므로 제외.
 */
export const MIN_MARKET_CAP = 300_000_000;

/**
 * Shell Companies (SPAC) 업종명.
 * RS 계산·Phase 판정·심볼 수집 전반에서 이 업종을 제외한다.
 * IS DISTINCT FROM 으로 비교해 industry=NULL인 종목은 결과에 포함시킨다.
 */
export const SHELL_COMPANIES_INDUSTRY = "Shell Companies";

/**
 * CNN Fear & Greed Index 비공식 API 엔드포인트.
 * build-market-breadth.ts 와 marketDataLoader.ts 에서 공유.
 */
export const CNN_FEAR_GREED_URL =
  "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";

export const CNN_FEAR_GREED_REFERER =
  "https://edition.cnn.com/markets/fear-and-greed";

# Wiki Activity Log

> Append-only. 가장 최근이 위에.

## 2026-04-14

- **[업데이트]** `architecture/data-pipeline.md` — tracked_stocks 통합(PR #773) 반영.
  - `getWatchlistStatus` → `getTrackedStocks` 도구 참조 교체 (`watchlist_tracking` 테이블 제거)
  - `readRecommendationPerformance` → `readTrackedStocksPerformance` 참조 교체
  - Signal Scan 출력 대상: `recommendations` → `tracked_stocks (source='etl_auto')`
  - DB 스키마 섹션 C: `tracked_stocks` 신규 primary 테이블 추가, `recommendations` / `recommendation_factors` / `watchlist_stocks` @deprecated 마킹
  - DAG: `scan_recommendation_candidates` → `tracked_stocks` 경로 업데이트
  - LLM 출력 필드: `watchlistSummary` → `trackedStocksSummary`

## 2026-04-06

- **[생성]** `architecture/report-layouts.md` -- 일간/주간 리포트 레이아웃 문서. 8개/10개 섹션 구성, 각 섹션별 데이터 필드/도구 매핑, UI 컴포넌트 라이브러리(8종), 색상 체계, 데이터 타입 구조, 일간 vs 주간 차이점 비교.
- **[생성]** `architecture/data-pipeline.md` -- 전체 데이터 파이프라인 문서. ETL -> Feature Eng -> Signal Scan -> Agent -> Debate -> Learning -> Report 7단계 흐름, 37개 DB 테이블 도메인 맵, DAG, 실행 스케줄, 임계값 참조 포함.
- **[생성]** `index.md` -- 위키 인덱스 초기 구성. Architecture/Concepts/Entities/Operations 4개 카테고리.
- **[생성]** `log.md` -- 활동 로그 시작.
- **[설정]** `.gitignore`에 `wiki/` 추가. 로컬 전용 지식 베이스.

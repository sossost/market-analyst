# Plan: 토론 엔진 뉴스/실적 서프라이즈 근거 주입

**이슈**: #460
**트랙**: Lite (기존 아키텍처 확장, 새 의사결정 불필요)
**골 정렬**: SUPPORT — thesis 논거 품질 향상 → 섹터 강세 판단 신뢰도 증가

## 문제 정의

토론 엔진의 thesis 근거가 RS/Phase 등 가격 기반 기술적 지표에 집중되어 있어,
"왜 지금 이 섹터가 강한가"에 대한 촉매(catalyst) 설명이 부재하다.

#456에서 `stock_news`, `earning_calendar`, `eps_surprises` ETL이 추가되었으나,
토론 엔진 프롬프트에는 아직 반영되지 않은 상태.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| thesis 근거 | RS/Phase/SEPA 정량 지표만 | + 종목 뉴스 헤드라인 + 실적 서프라이즈 비트율 + 실적 발표 일정 |
| 섹터 강세 설명 | "Technology RS 75" (수치만) | "Technology RS 75 + 섹터 내 실적 비트율 83% + NVDA 실적 서프라이즈" |
| 이벤트 리스크 인식 | 없음 | 향후 2주 내 실적 발표 종목 리스트 제공 |

## 변경 사항

### 1. `src/debate/catalystLoader.ts` (신규)

3가지 데이터를 로드하여 `<catalyst-data>` XML 블록으로 포맷:

**a) Phase 2 종목 최근 뉴스 (stock_news)**
- 대상: Phase 2 종목 (newPhase2Stocks + topPhase2Stocks)
- 범위: 최근 5일 이내, 종목당 최대 3건
- 출력: 종목별 헤드라인 + 출처 (본문 제외 — 프롬프트 인젝션 방지)
- sanitization: XML 태그 제거

**b) 섹터별 실적 서프라이즈 비트율 (eps_surprises + symbols)**
- 대상: Phase 2 종목이 속한 섹터
- 범위: 최근 1분기 (90일 이내)
- 출력: "Technology: 5/6 비트 (83%)" 형식
- JOIN: eps_surprises → symbols (sector 매핑)

**c) 임박한 실적 발표 (earning_calendar)**
- 대상: Phase 2 종목
- 범위: 향후 14일
- 출력: "NVDA 2026-04-15 (bmo)" 형식

### 2. `src/debate/debateEngine.ts` — DebateConfig에 `catalystContext?: string` 추가

### 3. `src/agent/run-debate-agent.ts` — 파이프라인 연결
- `loadCatalystContext(snapshot, debateDate)` 호출
- fundamental/earlyDetection과 병렬 로드
- `catalystContext`를 `runDebate()` config에 전달

### 4. Round 1/2/3 프롬프트 주입
- 기존 `fundamental-data`, `early-detection`과 동일한 패턴
- `<catalyst-data>` XML 태그로 래핑
- Round 1: 전문가 분석 시 촉매 근거로 활용
- Round 2: 교차검증 시 촉매 근거 검증
- Round 3: 종합 시 촉매 근거 반영 (섹션 4 "왜 지금 이 섹터인지" 보강)

## 작업 계획

| 단계 | 작업 | 파일 |
|------|------|------|
| 1 | catalystLoader.ts 생성 (쿼리 + 포맷) | `src/debate/catalystLoader.ts` |
| 2 | DebateConfig 타입 확장 | `src/debate/debateEngine.ts` |
| 3 | 파이프라인 연결 | `src/agent/run-debate-agent.ts` |
| 4 | Round 1/2/3 프롬프트 주입 | `src/debate/round1-independent.ts`, `round2-crossfire.ts`, `round3-synthesis.ts` |
| 5 | 테스트 작성 | `src/debate/__tests__/catalystLoader.test.ts` |

## 리스크

| 리스크 | 대응 |
|--------|------|
| stock_news 데이터 미축적 | 빈 데이터 시 빈 문자열 반환 — graceful degradation |
| 뉴스 본문 프롬프트 인젝션 | 헤드라인만 사용 + XML 태그 sanitize |
| 토큰 예산 초과 | 종목당 3건, 헤드라인만 → 최대 ~1500자 예상 |
| DB 쿼리 실패 | try-catch 격리 — 토론 계속 진행 |

## 무효 판정

해당 없음. 기존 아키텍처 패턴(XML 블록 주입)을 그대로 따르며, DB 쿼리 추가만으로 구현 가능.

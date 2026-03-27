# Plan: 추천 종목 펀더멘탈 게이트 추가 (#449)

## 골 정렬: ALIGNED
Phase 2 주도주 초입 포착이 시스템의 존재 이유. 현재 포착 후 생존율 14%(12건 중 2건 ACTIVE).
기술적 Phase 2 판정만으로는 진입 품질이 부족 — 펀더멘탈 교차 검증이 필수.

## 무효 판정: 해당 없음
LLM 백테스트 아님. DB에 저장된 정량 SEPA 등급을 게이트 조건으로 사용하는 규칙 기반 로직.

## 문제 정의

90일 추천 성과 분석 결과:
- Phase Exit 6건 (avg 2일, -15%) — 기술적 Phase 2지만 펀더멘탈 뒷받침 없는 종목
- Stop Loss 3건 (avg max PnL -0.28%) — 진입 시점부터 역행, 한 번도 수익 미기록
- Trailing Stop 1건 (+10.9%→-33%) — 수익 구간에서 환수

**근본 원인**: `saveRecommendations` 게이트에 펀더멘탈 등급 검증이 없음.
Phase 2 기술적 조건(MA 정렬, RS 등) 통과만으로 추천되어, F등급(펀더멘탈 기준 전부 미충족) 종목이 진입.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 펀더멘탈 검증 | 없음 (Bear 예외 경로에서만 확인) | F등급 종목 추천 차단 |
| 게이트 응답 | blockedByFundamental 없음 | 차단 건수 집계 |
| 차단 기준 | — | SEPA grade = "F" → 차단 |

## 변경 사항

### 1. `src/db/repositories/fundamentalRepository.ts`
- `findFundamentalGrades(symbols: string[], date: string)` 추가: 복수 종목의 최신 SEPA 등급을 일괄 조회
- 기존 `findLatestFundamentalGrade`는 단건용 — 배치 조회 함수 신규 추가

### 2. `src/tools/saveRecommendations.ts`
- Phase 2 안정성 게이트(Phase 3.5) 이후, INSERT 이전에 **펀더멘탈 게이트** 추가
- `findFundamentalGrades`를 기존 병렬 쿼리 블록(activeRows, cooldownRows, persistenceRows, stabilityRows)에 추가
- SEPA grade = "F" 종목 차단, `blockedByFundamental` 카운터 추가
- 응답 메시지에 차단 건수 포함

### 3. 테스트
- `saveRecommendations.test.ts`에 펀더멘탈 게이트 테스트 추가
- `fundamentalRepository` mock 추가
- F등급 차단, C등급 이상 통과, 등급 없음(데이터 부족) 통과 케이스

## 설계 결정

1. **차단 기준: F등급만 차단** — C등급(SEPA 기준 1개라도 충족)이면 통과.
   근거: 시스템이 "기술적 Phase 2 + 최소한의 펀더멘탈"을 요구하는 것이 목적.
   너무 높은 기준(B 이상)은 추천 풀을 과도하게 축소.

2. **등급 없음 = 통과** — fundamental_scores 테이블에 데이터가 없는 종목은 차단하지 않음.
   근거: ETL 타이밍 이슈로 스코어링이 아직 안 된 신규 종목을 일괄 차단하면 false negative 증가.

3. **배치 쿼리** — 종목별 개별 쿼리 대신 `WHERE symbol = ANY($1)` 일괄 조회.
   근거: N+1 방지, 기존 persistenceRows/stabilityRows 패턴과 동일.

## 리스크

- **False positive 감소 vs 추천 풀 축소 트레이드오프**: F등급만 차단하므로 영향 최소화.
  모니터링 후 B등급 이상으로 강화 가능.
- **fundamental_scores 테이블 데이터 지연**: 스코어링 ETL이 실행 안 된 종목은 통과시킴 (fail-open).

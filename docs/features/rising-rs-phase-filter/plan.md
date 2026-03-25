# Plan: getRisingRS Phase 필터 추가 + RS 상한 확대

**이슈**: #426
**트랙**: Lite (버그픽스 + 파라미터 조정)
**골 정렬**: ALIGNED — Phase 2 주도섹터/주도주 초입 포착 도구의 구조적 false positive 제거

## 문제 정의

`findRisingRsStocks` SQL에 Phase 필터가 없어 Phase 3/4(하락) 종목이 일시적 RS 반등으로 결과에 포함된다.
RS 상한 60은 Phase 2 초입에서 RS가 빠르게 상승하는 종목을 조기 탈락시켜 포착 목적과 모순.

### Before
- SQL: Phase 조건 없음 → Phase 4 종목 false positive 유입
- RS 범위: 30~60 → RS 60+ 초기 모멘텀 종목 즉시 탈락
- 전략 브리핑: 추천 성과 승률 10%, Phase 4 반등 종목 오염 확인됨

### After
- SQL: `sp.phase IN (1, 2)` 조건 추가 → Phase 3/4 종목 완전 차단
- RS 범위: 30~70 → 시장 주목 시작 구간(60-70) 포착 가능
- false positive 구조적 제거, 초기 모멘텀 포착 범위 확대

## 변경 사항

### 1. `src/db/repositories/stockPhaseRepository.ts` — findRisingRsStocks
- SQL WHERE 절에 `sp.phase IN (1, 2)` 추가
- 새 파라미터 `allowedPhases: number[]` 추가 (유연성 확보)

### 2. `src/tools/getRisingRS.ts`
- `RS_MAX` 60 → 70으로 변경
- `findRisingRsStocks` 호출 시 `allowedPhases: [1, 2]` 전달
- `rsRange` 출력 및 description 업데이트

### 3. 테스트 작성
- `__tests__/agent/tools/getRisingRS.test.ts` 신규 생성
- Phase 필터링, RS 범위, 에러 처리 검증

## 리스크

- **낮음**: Phase 필터 추가는 순수 WHERE 조건 추가. 기존 쿼리 구조 변경 없음.
- **낮음**: RS 상한 70은 보수적 확대. 75 이상은 Phase 2 후반부 진입이므로 70이 적정.

## 무효 판정

해당 없음 — LLM 백테스트/회귀분석이 아닌, SQL 필터 추가와 상수 조정. 코드 레벨 확인 가능.

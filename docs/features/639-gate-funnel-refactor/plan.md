# Plan: 5중 게이트 퍼널 구조 개편 — thesis 독립 축 + 게이트별 충족 시각화 (#639)

## 선행 맥락

- **#636 (refactor/636-weekly-report-data-llm-split)**: 데이터/인사이트 분리. 현재 브랜치. WeeklyDataCollector, weekly-html-builder, weeklyReportSchema 등 핵심 렌더링 아키텍처가 이미 이 브랜치에서 정리됨.
- **#638 (데이터 정확성 교정)**: 같은 브랜치에서 weekStartClose 버그, VIX 렌더링 개선, F&G 방향 표시 구현 완료.
- **업종RS 프로그래밍 판정**: `weekly-html-builder.ts`의 `renderGate5Block`에 `industryChangeMap`이 이미 구현되어 있음 (changeWeek > 0 → ✓). #636에서 이미 반영됨.
- **현재 gate5 흐름**: `getPhase2Stocks` → SQL 3중 필터(Phase2 + RS60+ + SEPA S/A + 시총$300M+, LIMIT 30) → `gate5Candidates` 배열 캡처 → `renderGate5Block`에서 카드 렌더링. 업종RS(g4)는 industryTop10 데이터로 판정, thesis(g5)는 항상 `?` 표시.

## 골 정렬

ALIGNED — 5중 게이트 결과를 "후보 22개"가 아닌 "등록/예비/해제" 3단 구조로 바꾸는 것은 리포트의 정보 밀도를 높이고 포착 판단을 명확히 한다. "어떤 종목이 등록됐고 왜"가 핵심 알파 정보인데, 현재는 그것이 묻혀 있다.

## 문제

현재 5중 게이트가 SQL WHERE 필터로 직렬 적용되어 22개 후보 테이블이 생성된다. 이 테이블은:
1. thesis 연결 여부를 판정하지 못한 채 `?`로 남겨둠 (가장 중요한 게이트가 미판정)
2. Phase 1인 thesis 수혜 종목은 후보 자체에 올라오지 않음
3. 22개 전부 비슷한 패턴 — 에이전트가 차별화 없이 선택하게 됨
4. 리포트 독자(CEO)에게 "22개 후보 중 에이전트가 판단한 것"이 아닌, "에이전트의 최종 결론"이 보여야 함
5. 22개 후보풀 테이블 자체는 에이전트 작업 데이터이므로 리포트에 노출할 필요 없음

## Before → After

**Before**:
- `getPhase2Stocks` → SQL 3+2 중 필터(Phase2 + RS60+ + SEPA + 시총 + LIMIT 30)
- → `gate5Candidates` 배열에 22개 저장
- → 리포트에 22개 후보 테이블 렌더링 (thesis 게이트는 항상 `?`)
- → LLM이 22개 중에서 판단해 save_watchlist 호출

**After**:
- `getPhase2Stocks` → WHERE 필터 완화(Phase2 + RS60+ + 시총$300M+), SEPA/LIMIT 제거 → 더 넓은 풀 반환, 게이트별 pass/fail 컬럼 추가
- → 에이전트가 기술적 4개 게이트를 직접 확인 가능 (Phase2 ✓, RS60+ ✓, SEPA ✓/✗, 업종RS ✓/✗)
- → LLM이 thesis 게이트를 독립적으로 평가 (narrative_chains/theses 컨텍스트 활용)
- → `save_watchlist` 결과(등록/해제 확정 종목)를 `WeeklyDataCollector`가 캡처
- → 리포트에 "등록(5/5)", "예비(4/5, thesis 미충족)", "해제" 3단 구조로 표시
- → 22개 후보 테이블 제거

## 변경 사항

### 1. `src/db/repositories/stockPhaseRepository.ts` — `findPhase2Stocks` SQL 수정

**변경 내용**:
- SEPA `fs.grade IN ('S', 'A')` JOIN 조건 제거 → WHERE에서 개별 컬럼으로 반환
- LIMIT 파라미터 제거 (또는 상한 확장: 200으로)
- SEPA 등급을 SELECT 컬럼으로 추가: `fs.grade AS sepa_grade`
- INNER JOIN → LEFT JOIN으로 변경 (SEPA 미측정 종목도 포함)

**결과**: Phase2 + RS60+ + 시총$300M+ 충족 종목 전체 반환. SEPA 등급은 각 row에 포함.

**주의**: `findAllPhase2Stocks`(ETL 자동 스캔용)는 별도로 존재하므로 건드리지 않음.

### 2. `src/tools/getPhase2Stocks.ts` — 도구 레이어 수정

**변경 내용**:
- `DEFAULT_LIMIT = 30` 상수 제거 (또는 200으로 변경)
- `limit` input_schema 파라미터 제거 (또는 기본값 200)
- 반환 객체에 `sepaGrade` 필드 추가
- `Phase2Stock` 타입에 `sepaGrade: string | null` 추가 (weeklyReportSchema.ts)

**결과**: 각 종목의 SEPA 등급이 포함된 더 넓은 후보풀 반환.

### 3. `src/tools/weeklyDataCollector.ts` — `save_watchlist` 결과 캡처 추가

**변경 내용**:
- `WeeklyReportData`에 `watchlistChanges` 필드 추가:
  ```ts
  watchlistChanges: {
    registered: WatchlistChange[];  // 등록 확정
    exited: WatchlistChange[];      // 해제 확정
    pending4of5: WatchlistChange[]; // thesis 미충족 예비 (4/5)
  }
  ```
- `saveWatchlist` 도구를 `wrap`으로 감싸서 결과 캡처
  - `action: 'register'` + `success: true` → `registered`에 추가
  - `action: 'exit'` + `success: true` → `exited`에 추가
  - `action: 'register'` + `blocked: true` + gateFailures에 thesis만 포함 → `pending4of5`에 추가

**근거**: `save_watchlist`는 현재 `비캡처 도구`로 분류. 결과를 HTML 렌더링에 반영하려면 캡처가 필요.

**주의**: `pending4of5` 캡처는 에이전트가 능동적으로 save_watchlist를 호출해야 수집 가능. 에이전트가 "4/5 종목도 save_watchlist로 시도하라"는 지시가 필요함 (프롬프트 변경 포함).

### 4. `src/tools/schemas/weeklyReportSchema.ts` — 타입 확장

**변경 내용**:
- `Phase2Stock`에 `sepaGrade: string | null` 추가
- `WatchlistChange` 인터페이스 신규 추가:
  ```ts
  export interface WatchlistChange {
    symbol: string;
    action: 'register' | 'exit';
    reason: string;
    gateResults?: {
      phase2: boolean;
      rs60: boolean;
      sepa: boolean;
      industryRs: boolean;
      thesis: boolean;
    };
  }
  ```
- `WeeklyReportData`에 `watchlistChanges` 필드 추가

### 5. `src/lib/weekly-html-builder.ts` — 리포트 렌더링 재구성

**변경 내용**:

**제거**:
- `renderGate5Block` 함수 (22개 후보 테이블) 완전 제거
- `buildWeeklyHtml`에서 `gate5Html` 렌더링 및 `gate5Candidates` 사용 제거

**추가**:
- `renderWatchlistChanges(changes: WatchlistChanges)` 신규 함수:
  - 등록 종목 카드: symbol + 5/5 게이트 배지 + 등록 근거 요약
  - 예비 종목 리스트: symbol + "thesis 미충족" 사유 + 4/5 게이트 표시
  - 해제 종목 리스트: symbol + 해제 사유
  - 빈 케이스: "이번 주 등록/해제 없음" 메시지

**섹션 4 HTML 구조 변경**:
```
Before: <5중 게이트 후보 (22종목)> + gate5SummaryHtml
After:  <renderWatchlistChanges(data.watchlistChanges)> + gate5SummaryHtml
```

**CSS**: gate5 관련 스타일은 새 렌더링에 맞게 조정 (기존 카드 스타일 일부 재활용 가능)

### 6. `src/agent/prompts/weekly.ts` — 섹션 4 프롬프트 수정

**변경 내용**:

**섹션 4 워크플로우 7번 수정**:
```
Before: Phase 2 종목 조회 (get_phase2_stocks) — RS 60 이상, 업종 RS 동반 상승 여부 확인

After:  Phase 2 종목 조회 (get_phase2_stocks) — RS 60 이상 종목 전체 반환.
        각 종목에 sepaGrade 필드 포함.
        기술적 4개 게이트는 반환 데이터로 직접 확인:
        - Phase 2: ✓ (이미 필터링됨)
        - RS 60+: ✓ (이미 필터링됨)
        - SEPA: sepaGrade가 'S' 또는 'A'이면 ✓
        - 업종RS: get_leading_sectors(mode: "industry") 결과에서 해당 업종 changeWeek > 0이면 ✓
```

**thesis 독립 평가 지시 추가**:
```
thesis 게이트는 기술적 4개 게이트와 완전히 독립적으로 평가한다.
- 기술적 4개 게이트를 모두 충족 → save_watchlist(register) 호출 + thesis_id 포함
- thesis 미충족만 제외하고 기술적 4개 충족 → save_watchlist(register) 시도.
  게이트가 차단하면 그 종목은 "예비 관심종목"으로 기록됨.
- Phase 1 종목이더라도 thesis 연결이 강하다면 gate5Summary에 "예비 워치리스트"로 언급
```

**save_watchlist 호출 지시 명확화**:
```
Before: 5중 게이트 통과 종목: action: "register"
After:  기술적 4개 게이트 통과 + thesis 확인된 종목: action: "register" (thesis_id 포함)
        기술적 4개 게이트 통과 + thesis 불명확한 종목: action: "register" 시도 (시스템이 thesis 게이트 차단)
```

### 7. `src/agent/run-weekly-agent.ts` — saveWatchlist 래핑 추가

**변경 내용**:
- `saveWatchlist`를 `dataCollector.wrap(saveWatchlist, "watchlistChanges")`로 변경
- 현재: `saveWatchlist` (비캡처 도구)
- 변경 후: `dataCollector.wrap(saveWatchlist, "watchlistChanges")` (캡처 도구)

## 작업 계획

### Phase 1: 데이터 레이어 확장 (독립)
**담당**: 구현팀
**파일**: `stockPhaseRepository.ts`, `getPhase2Stocks.ts`, `weeklyReportSchema.ts`

1. `findPhase2Stocks` SQL 수정
   - SEPA JOIN → LEFT JOIN, `fs.grade AS sepa_grade` SELECT 추가
   - LIMIT 200으로 변경 (30 → 200)
   - SEPA WHERE 조건 제거
   - 완료 기준: `SELECT ... sepa_grade` 컬럼이 rows에 포함, Phase2 + RS60+ + 시총 충족 종목 전체 반환

2. `getPhase2Stocks.ts` 도구 레이어 반영
   - `sepaGrade` 필드 매핑 추가
   - limit 기본값 200, input_schema 파라미터 제거
   - 완료 기준: 반환 JSON에 `sepaGrade` 필드 포함

3. `weeklyReportSchema.ts` 타입 확장
   - `Phase2Stock`에 `sepaGrade` 추가
   - `WatchlistChange` 인터페이스 추가
   - `WeeklyReportData`에 `watchlistChanges` 추가
   - `WeeklyDataCollector.toWeeklyReportData()`에 `watchlistChanges` 기본값 추가

---

### Phase 2: 컬렉터 확장 (Phase 1 완료 후)
**담당**: 구현팀
**파일**: `weeklyDataCollector.ts`, `run-weekly-agent.ts`

4. `WeeklyDataCollector._capture` 분기 추가
   - `captureAs === "watchlistChanges"` 케이스 구현
   - register 성공 → `registered` 배열
   - exit 성공 → `exited` 배열
   - register + blocked + thesis 게이트만 실패 → `pending4of5` 배열
   - 완료 기준: save_watchlist 호출 시 결과가 분류되어 캡처됨

5. `run-weekly-agent.ts` 래핑 변경
   - `saveWatchlist` → `dataCollector.wrap(saveWatchlist, "watchlistChanges")`
   - 완료 기준: 에이전트 루프 실행 후 `dataCollector.toWeeklyReportData().watchlistChanges`에 데이터 존재

---

### Phase 3: 렌더링 재구성 (Phase 2 완료 후)
**담당**: 구현팀
**파일**: `weekly-html-builder.ts`

6. `renderGate5Block` 함수 제거, `renderWatchlistChanges` 신규 구현
   - 등록 카드: symbol + 5/5 게이트 배지 + reason
   - 예비 리스트: symbol + "4/5 (thesis 미충족)" + gateResults
   - 해제 리스트: symbol + exitReason
   - 빈 상태: "이번 주 신규 등록/해제 없음"
   - 완료 기준: 기존 gate5 테이블 없음. 3단 구조 정확히 렌더링.

7. `buildWeeklyHtml`에서 `gate5Html` → `watchlistChangesHtml` 교체
   - `data.gate5Candidates` 참조 제거
   - `data.watchlistChanges` 참조 추가
   - 완료 기준: HTML 생성 정상 동작. TypeScript 컴파일 에러 없음.

---

### Phase 4: 프롬프트 수정 (Phase 1 완료 후, Phase 2, 3과 병렬 가능)
**담당**: 구현팀
**파일**: `prompts/weekly.ts`

8. 섹션 4 프롬프트 수정
   - get_phase2_stocks 설명에 sepaGrade 필드 활용 지시 추가
   - thesis 독립 평가 지시 추가
   - save_watchlist 4/5 시도 지시 추가
   - 완료 기준: 프롬프트가 "기술적 4개 게이트를 데이터로 직접 확인, thesis는 독립 판단"을 명확히 지시함

---

### Phase 5: 테스트 업데이트 (Phase 3, 4 완료 후)
**담당**: 구현팀
**파일**: `src/lib/__tests__/weekly-html-builder.test.ts`

9. `renderGate5Block` 관련 테스트 제거
10. `renderWatchlistChanges` 테스트 추가
    - 등록 1건: 카드 렌더링 검증
    - 예비 1건: 4/5 배지 표시 검증
    - 해제 1건: 해제 사유 표시 검증
    - 빈 케이스: "등록/해제 없음" 메시지 검증
    - 완료 기준: `yarn test` 통과

## 리스크

1. **`pending4of5` 캡처 신뢰성**: 에이전트가 "thesis 미충족 종목도 save_watchlist를 시도하라"는 지시를 따르지 않으면 `pending4of5` 배열이 비어 있음. 이 케이스는 "예비 종목 없음"으로 처리하면 되므로 치명적이지 않음. 리포트 품질 열화는 있지만 시스템 오류는 아님.

2. **LIMIT 제거 후 데이터 볼륨**: Phase2 + RS60+ + 시총$300M+ 기준으로 실제 몇 건이 반환되는지 확인 필요. 이슈 기준 991개(RS 60+)인데, 시총 필터 적용 시 대폭 감소 예상. 에이전트 컨텍스트 윈도우 영향 고려해 200 상한 유지.

3. **save_watchlist 래핑**: 기존에 비캡처 도구였던 saveWatchlist를 wrap으로 변경해도 에이전트 동작 자체는 바뀌지 않음. 캡처 로직은 execute 완료 후 result를 분석하는 순수 함수 수준이므로 부작용 없음.

4. **HTML 테스트 업데이트 범위**: `weekly-html-builder.test.ts`에서 `gate5Candidates`를 직접 사용하는 테스트가 있을 수 있음. Phase 3 구현 시 동시에 파악하여 업데이트.

## 의사결정 필요

없음 — 바로 구현 가능

## 메모

- `gate5Candidates: Phase2Stock[]` 필드는 `WeeklyReportData`에서 **제거하지 않는다**. 에이전트가 여전히 get_phase2_stocks를 호출하고 결과를 캡처하므로, 필드 자체는 유지. 다만 HTML 렌더링에서만 사용하지 않게 됨. 향후 별도 이슈로 정리.
- 브랜치: `refactor/636-weekly-report-data-llm-split`에 이어서 커밋.

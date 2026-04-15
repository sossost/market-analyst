# 일간 리포트 관심종목 섹션 노이즈 제거

**GitHub 이슈**: #815
**작성일**: 2026-04-15

---

## 선행 맥락

메모리 검색 결과 이 주제에 대한 선행 결정 기록 없음.

관련 컨텍스트:
- F11(인사이트 브리핑 전환, #390)에서 90일 트래킹 윈도우 도입. 대부분의 날에 ACTIVE 전체 목록이 변하지 않는다는 구조적 특성이 이때부터 내재됨.
- feedback_data_programmatic_llm_insight.md — 데이터 테이블은 프로그래밍으로, LLM은 해석만. 이번 변경이 이 원칙에 부합함.

---

## 골 정렬

**ALIGNED** — 노이즈를 줄여 "변화가 일어난 종목"에만 집중하게 만든다. 90일 트래킹 구조에서 Phase 전이는 실제 시장 신호다. 이걸 매일 반복되는 테이블 속에 묻히게 두는 것은 포착 선행성을 방해한다.

---

## 문제

일간 리포트 관심종목 섹션이 ACTIVE 전체 종목을 9컬럼 상세표로 매일 반복 출력한다. 90일 트래킹 특성상 대부분의 날에는 전날과 동일한 데이터가 그대로 출력되어, CEO가 실제로 봐야 할 변화 이벤트가 노이즈에 묻힌다.

---

## Before → After

**Before**
- stat-row: ACTIVE 수 / 평균 P&L / Phase 변화 수 (1행)
- 9컬럼 상세표: 전체 ACTIVE 종목 × [종목, 섹터, 진입일, 추적일, Phase, 궤적(최근7일), P&L, RS, P2 구간]
- watchlistNarrative: 항상 출력

**After**
- stat-row: ACTIVE 수 / 평균 P&L / 오늘 이벤트 수 (1행, 유지)
- 상세표: 제거
- 이벤트 테이블: 오늘 변화 이벤트만 표시 (신규 진입 / Phase 전이 / 만료 임박)
  - 이벤트 없는 날: "오늘 변화 없음" 한 줄 + 섹션 축소
- watchlistNarrative: 이벤트 있을 때만 표시, 없으면 미출력

LLM 프롬프트도 전체 목록 대신 이벤트 목록만 주입.

---

## 변화 이벤트 정의

### 1. 신규 진입 (new_entry)

**감지 조건**: `item.daysTracked <= 1`

`daysTracked`는 DB의 `days_tracked` 컬럼으로, 최초 진입일을 기준으로 매일 ETL이 증가시킨다. 오늘 처음 등록된 종목은 1이다.

표시 내용: 종목 / 섹터 / source(etl_auto·agent·thesis_aligned) / Phase / RS / P2 구간 / entryReason(있으면)

### 2. Phase 전이 (phase_change)

**감지 조건**: `phaseTrajectory`의 마지막 2개 포인트 비교

```typescript
const lastTwo = item.phaseTrajectory.slice(-2);
const isPhaseChangedToday = lastTwo.length === 2 && lastTwo[0].phase !== lastTwo[1].phase;
```

`DailyWatchlistItem.phaseTrajectory`에 최근 7일 궤적(`{ date, phase, rsScore }[]`)이 이미 포함되어 있으므로 데이터 수집 변경 불필요.

**주의**: `summary.phaseChanges`(진입 Phase ≠ 현재 Phase)는 누적이므로 사용하지 않는다. 이를 사용하면 20일 전에 Phase가 바뀐 종목이 남은 70일간 매일 표시되어 노이즈 제거 목적을 달성하지 못한다.

세부 구분:
- 긍정 전이: Phase 1→2, Phase 4→1, Phase 3→2 (상승 방향)
- 경고 전이: Phase 2→3, Phase 3→4, Phase 2→1 (하락 방향)

표시 내용: 종목 / 직전 Phase → 현재 Phase (방향 표시) / 추적일 / P&L / RS

### 3. 만료 임박 (expiring_soon)

**감지 조건**: `item.daysTracked >= 80` (90일 윈도우에서 10일 이내)

만료 임박은 포트폴리오 리뷰 관점의 시그널. 실제 만료(tracking_end_date 도래)는 DB에서 ACTIVE → 비활성으로 전환되므로 리포트에 나타나지 않는다. 따라서 "80일 이상 추적 중" = "곧 윈도우 종료"를 사전 경고로 표시한다.

표시 내용: 종목 / 추적일 / P&L / source

---

## 변경 파일 목록

### 파일 1: `src/lib/daily-html-builder.ts`

**변경 대상**: `renderWatchlistSection()` 함수 (1272~1371줄)

변경 내용:
1. **9컬럼 상세표 제거** — `itemRows` 생성 + `<table>` 블록 전체 삭제
2. **이벤트 감지 로직 추가** — `data.items`에서 new_entry / phase_change / expiring_soon 분류
3. **이벤트 테이블 렌더링** — 이벤트 타입별 색상 배지 + 간결 행 (종목 / 이벤트 / 핵심 수치)
4. **변화 없는 날 처리** — 이벤트 0건이면 `<p class="muted">오늘 변화 없음 — ACTIVE ${n}개 추적 중</p>` 한 줄
5. **narrative 조건부 표시** — 이벤트 > 0인 경우에만 `narrativeHtml` 출력

stat-row 구조 변경:
- "Phase 변화 종목 N건" → "오늘 이벤트 N건" (phaseChanges.length 대신 전체 이벤트 수)

### 파일 2: `src/agent/run-daily-agent.ts`

**변경 대상**: 284~318줄 (LLM 프롬프트 데이터 주입 블록)

변경 전:
```
const trackedStocksItemLines = data.watchlist.items
  .map((w) => `${w.symbol}: Phase ${...}, RS ${...}, P&L ${...}`)
  .join("\n") || "없음";
```

변경 후:
```
const trackedStocksEventLines = buildTrackedStocksEventSummary(data.watchlist);
```

`buildTrackedStocksEventSummary()` 헬퍼를 동일 파일(또는 별도 lib)에 추출:
- 신규 진입 종목 목록
- Phase 전이 종목 목록 (방향 포함)
- 만료 임박 종목 목록
- 이벤트 없으면 "오늘 변화 없음"

프롬프트에서 `${trackedStocksItemLines}` → `${trackedStocksEventLines}` 교체.

### 파일 3: `src/agent/prompts/daily.ts`

**변경 대상**: 50줄, 64줄 (`watchlistNarrative` 작성 지침)

변경 전:
```
"watchlistNarrative": "1~2문장. ACTIVE 추적 종목 서사 유효성. Phase 전이 종목이 있으면 방향 언급. 없으면 '해당 없음'."
```

변경 후:
```
"watchlistNarrative": "1~2문장. 오늘 발생한 이벤트(신규 진입/Phase 전이/만료 임박)의 의미 해석. 이벤트 없으면 반드시 '해당 없음'."
```

64줄 필드별 작성 지침도 동일하게 조정. "ACTIVE 추적 종목 전체 유효성 평가" 문구 제거.

---

## 작업 계획

### 커밋 1: HTML 렌더링 변경 (daily-html-builder.ts)

담당: 구현팀
완료 기준:
- `renderWatchlistSection()`에서 9컬럼 상세표 제거 확인
- 신규 진입 / Phase 전이 / 만료 임박 이벤트 타입별 행 렌더링 확인
- 이벤트 0건 시 "오늘 변화 없음" 단일 행 출력 확인
- stat-row 레이블 "Phase 변화 종목" → "오늘 이벤트" 변경 확인
- narrative 조건부 출력 확인
- 기존 테스트 통과

### 커밋 2: LLM 프롬프트 조정 (run-daily-agent.ts, prompts/daily.ts)

담당: 구현팀
완료 기준:
- `buildTrackedStocksEventSummary()` 헬퍼 구현 및 단위 테스트 작성
- 프롬프트에 전체 목록 대신 이벤트 요약만 주입되는 것 확인
- prompts/daily.ts watchlistNarrative 지침 수정 확인
- 이벤트 없는 날 프롬프트에 "오늘 변화 없음" 전달 확인

두 커밋은 순차적으로 실행한다 (HTML 먼저, 프롬프트 조정 후).

---

## 리스크

1. **source 미표시 누락**: 현재 DailyWatchlistItem 타입에 `source` 필드가 없음. `DailyWatchlistData.items`의 타입 인터페이스(`dailyReportSchema.ts`)에 `source: string` 추가가 필요한지 확인 필요. `getTrackedStocks.ts`가 반환하는 raw data에는 source가 있으므로 타입 선언만 보완하면 됨.

2. **phaseChanges 누적 문제 (해결됨)**: `summary.phaseChanges`는 "진입 Phase ≠ 현재 Phase" 누적이므로 사용하지 않는다. 대신 `phaseTrajectory`의 마지막 2일 비교로 "오늘 실제로 바뀐 종목"만 감지한다. 이 방식이면 데이터 수집 변경 없이 정확한 당일 이벤트만 표시할 수 있다.

3. **만료 임박 임계값**: 80일은 임의적이다. 90일 윈도우에서 10일 전 경고는 합리적이나, 실제 운영 후 CEO 판단에 따라 조정 가능. 기준값을 상수로 분리해 쉽게 조정할 수 있게 구현할 것.

4. **이벤트가 모두 0건인 날 LLM 처리**: "오늘 변화 없음"을 받은 LLM이 watchlistNarrative에 억지로 내용을 생성하지 않도록 프롬프트 지침이 명확해야 함. "이벤트 없으면 반드시 '해당 없음'" 강제 문구 필수.

---

## 의사결정 필요

**없음 — 바로 구현 가능**

단, 구현 중 `source` 필드 타입 보완 여부(리스크 1)는 구현팀이 코드 확인 후 자체 판단하여 처리한다.

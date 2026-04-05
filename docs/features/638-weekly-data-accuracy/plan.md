# Plan: 주간 리포트 데이터 정확성 교정 (#638)

## 골 정렬

SUPPORT — 데이터 오류가 리포트 품질을 직접 훼손한다. Phase 2 포착 판단의 근거가 되는 지수 컨텍스트가 잘못 계산된 채로 LLM에 전달되면 인사이트 품질이 저하된다.

## 선행 맥락

없음. 이 버그는 PR #636(weekly-report-data-llm-split) 리팩터링 과정에서 코드 구조가 정리되면서 로직이 드러난 케이스다.

## 버그 분석

### 버그 1: weekStartClose 오류 (getIndexReturns.ts)

`computeWeeklyQuote`가 `DB_QUERY_LIMIT_WEEKLY = 10`개 rows를 가져와 chronological 정렬 후 `closes[0]`을 weekStartClose로 사용한다.

문제: 10개 rows는 이번주 거래일(월~금) + 지난주 거래일을 포함한다. `closes[0]`은 **10거래일 전 데이터**로, 이번주 월요일(첫 거래일)이 아니라 약 2주 전 날짜다.

실제 데이터 검증 (^IXIC, 2026-04-02 기준):
- DB rows 10개 중 chronological[0] = 2026-03-20 (21647.61)
- chronological[last] = 2026-04-02 (21879.18)
- 현재 계산: (21879.18 - 21647.61) / 21647.61 = **+1.07%** (약 2주 변화)
- 올바른 계산: 전주 금요일(2026-03-27, 20948.36) 기준 = **+4.44%**

올바른 `weekStartClose`는 이번주 첫 거래일 이전의 마지막 row, 즉 **전주 마지막 거래일 close**여야 한다.

수정 방향: chronological 배열에서 이번주 첫 거래일(Monday 또는 실제 첫 거래일) 이전의 close를 찾는다. 가장 단순하고 안전한 방법은: weekEnd 날짜를 파싱해 해당 주 월요일(UTC)을 계산하고, 그 이전 날짜의 row를 `weekStartClose`로 사용한다.

### 버그 2: VIX 카드 — 스냅샷만 표시 (weekly-html-builder.ts)

`renderIndexTable`은 모든 지수를 동일한 카드 구조로 렌더링한다. VIX는 `^VIX` symbol로 indices 배열에 포함되어 동일한 `weeklyChangePercent` 계산을 받는다.

문제:
- weeklyChangePercent 자체가 버그 1과 동일한 오류를 가짐
- VIX 변화율(%)은 주간 컨텍스트에서 의미가 약하다. 중요한 것은 **주간 레인지와 방향**
- "VIX 23.87 (-10.87%)" 같은 표현은 방향성을 오해시킨다 (VIX 하락 = 시장 안도)

VIX 전용 렌더링이 필요하다:
- 주간 high/low 레인지 (데이터 이미 있음: weekHigh, weekLow)
- 전주 종가 대비 방향 (상승=경계/불안, 하락=안도)
- VIX 25+ 도달 여부 (공포 임계선)
- VIX는 역방향 컬러 적용 (상승=경고색, 하락=안도색)

### 버그 3: Fear & Greed — 방향 표시 부재 (weekly-html-builder.ts)

`renderFearGreed`에서 `previous1Week` 필드를 단순 숫자(`| 1주전 31.2`)로 표시한다.

문제: 숫자만 보여서 방향(공포 확대/축소)을 즉각 파악하기 어렵다. `previous1Week`은 이미 getIndexReturns에서 가져오고 있으므로 추가 데이터 수집 없이 개선 가능하다.

수정 방향:
- `score`와 `previous1Week` 비교로 방향 화살표 + 레이블 표시
- 예: "32.1 → 45.2 (공포 완화)" 또는 "45.2 → 28.3 (공포 확대)"

## 변경 대상 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/tools/getIndexReturns.ts` | `computeWeeklyQuote` — weekStartClose를 전주 마지막 거래일 close로 교정 |
| `src/lib/weekly-html-builder.ts` | `renderIndexTable` — VIX 전용 카드 렌더링 분기 추가 |
| `src/lib/weekly-html-builder.ts` | `renderFearGreed` — previous1Week 방향 표시 추가 |
| `src/tools/schemas/weeklyReportSchema.ts` | (확인 필요) VIX 렌더링에 필요한 타입 필드 누락 시 추가 |
| `src/lib/__tests__/weekly-html-builder.test.ts` | 변경된 렌더링 로직 테스트 업데이트 |

## 구현 단계

### Phase 1: getIndexReturns.ts — weekStartClose 교정

**목표**: weekly 모드에서 weekStartClose = 전주 마지막 거래일 종가

**로직**:
```
1. rows(desc 정렬)에서 weekEndDate = rows[0].date 파싱
2. weekEndDate의 주 월요일(UTC 기준) 계산
3. chronological 배열에서 weekMonday 이전 날짜 중 가장 최근 row를 weekPrevClose로 선택
4. 해당 row가 없으면 null 반환 (데이터 부족)
5. weekStartClose = weekPrevClose.close
6. weeklyChange / weeklyChangePercent 재계산
```

**완료 기준**:
- ^IXIC 2026-04-02 기준: weekStartClose = 20948.36 (2026-03-27), weeklyChangePercent ≈ +4.44%
- 주 경계(월요일이 거래일이 아닌 경우)에서도 올바르게 동작

**주의사항**: `DB_QUERY_LIMIT_WEEKLY = 10`은 이번주(최대 5일) + 전주(최대 5일)를 커버하기에 충분하다. 다만 공휴일 연속으로 10거래일 이상 필요한 극단 케이스는 현실적으로 발생하지 않으므로 현행 유지.

---

### Phase 2: VIX 카드 렌더링 개선 (weekly-html-builder.ts)

**목표**: `renderIndexTable`에서 `^VIX` symbol을 감지해 전용 카드 렌더링

**렌더링 내용**:
- 현재 VIX 값 (weekEndClose)
- 주간 레인지: `고 {weekHigh} / 저 {weekLow}`
- 전주 종가 대비 방향: weekStartClose(교정 후) vs weekEndClose
  - 상승 = "▲ 경계" (경고색)
  - 하락 = "▼ 안도" (안도색)
- VIX 25 이상 도달 여부: weekHigh >= 25 이면 "주중 공포 임계선 도달" 배지

**컬러 규칙**:
- VIX 상승 → 한국식 하락색(파랑, `down` 클래스) — 시장 불안
- VIX 하락 → 한국식 상승색(빨강, `up` 클래스) — 시장 안도
- 기존 `colorClass(weeklyChangePercent)` 사용 불가. VIX 전용 반전 함수 필요.

**완료 기준**:
- VIX 카드가 다른 지수 카드와 시각적으로 구분됨
- 주간 레인지와 방향이 명확히 표시됨

---

### Phase 3: Fear & Greed 방향 표시 추가 (weekly-html-builder.ts)

**목표**: `renderFearGreed`에서 `previous1Week`을 단순 숫자 나열 대신 방향+레이블로 표시

**렌더링 내용**:
- 현재 점수 + rating (기존 유지)
- 주간 변화: `1주전 {previous1Week} → 현재 {score} ({방향 레이블})`
  - 점수 상승 + 현재 >= 50: "탐욕 심화"
  - 점수 상승 + 현재 < 50: "공포 완화"
  - 점수 하락 + 현재 < 50: "공포 심화"
  - 점수 하락 + 현재 >= 50: "탐욕 약화"
- `previous1Week`이 null이면 기존 방식 fallback

**완료 기준**:
- previous1Week 데이터가 있을 때 방향 레이블이 표시됨
- null 케이스에서 기존 표시로 graceful fallback

---

### Phase 4: 전체 수치 의미 검증

이슈 요건: "주간 리포트에 표시하는 모든 수치에 주간 맥락에서 의미 있는가? 검증"

검증 대상 및 판정:

| 수치 | 현재 표시 | 주간 맥락 적합성 | 조치 |
|------|----------|-----------------|------|
| 지수 weeklyChangePercent | 2주 변화 (버그) | 교정 필요 | Phase 1에서 해결 |
| 지수 weekHigh/weekLow | 주간 고저 | 적합 | 현행 유지 |
| 지수 closePosition | 주간 레인지 내 위치 | 적합 | 현행 유지 |
| VIX weeklyChangePercent | 주간 변화율 | 맥락 약함 | Phase 2에서 전용 렌더링 |
| VIX weekHigh/weekLow | 주간 레인지 | 적합, 미활용 | Phase 2에서 표시 추가 |
| F&G score | 금요일 스냅샷 | 적합 (현재값) | 현행 유지 |
| F&G previous1Week | 1주전 숫자 | 방향 표시 필요 | Phase 3에서 해결 |
| F&G previousClose | 전일 숫자 | 주간 맥락에서 불필요 | 제거 검토 (선택) |
| tradingDays | 이번주 거래일 수 | 공휴일 유무 파악 가능 | 현행 유지 |

`previousClose`(전일 F&G)는 주간 리포트에서 의미가 약하다. 제거할 경우 `FearGreedData` 타입과 `getIndexReturns` 반환값에도 영향이 있어 범위가 커진다. 이번 버그픽스 범위에서는 **제거하지 않고 단순 표시 유지**한다. 별도 이슈로 추적.

## 테스트 계획

### 단위 테스트 (Vitest)

**getIndexReturns.ts — computeWeeklyQuote**:
- 정상 케이스: 10개 rows에서 weekStartClose = 전주 마지막 거래일 종가
- 이번주 거래일이 1일(월요일)뿐인 케이스: 전주 금요일을 weekStartClose로 사용
- 데이터 부족 (5개 미만): null 반환
- 공휴일로 월요일이 없는 주: 다음 첫 거래일 기준으로 전주 마지막 거래일 산출

**weekly-html-builder.ts — renderIndexTable**:
- VIX 카드가 일반 지수 카드와 다른 HTML 구조를 가짐
- VIX 상승 시 `down` 컬러 클래스 (반전)
- VIX weekHigh >= 25일 때 경고 배지 포함
- VIX weekHigh < 25일 때 경고 배지 없음

**weekly-html-builder.ts — renderFearGreed**:
- previous1Week null: 기존 방식으로 렌더링
- score > previous1Week + score >= 50: "탐욕 심화" 레이블
- score > previous1Week + score < 50: "공포 완화" 레이블
- score < previous1Week + score < 50: "공포 심화" 레이블
- score < previous1Week + score >= 50: "탐욕 약화" 레이블

### 수동 검증

`scripts/preview-weekly-html.ts`(현재 브랜치에 이미 존재)로 실제 리포트 렌더링 후 확인:
- 지수 변화율이 이슈 기술의 기댓값(+4.44%)과 일치하는지
- VIX 카드에 주간 레인지와 방향이 표시되는지
- Fear & Greed에 방향 레이블이 표시되는지

## 리스크

- **weekStartClose 로직**: 주 경계 계산을 날짜 연산으로 처리할 때 타임존 오류 가능성. UTC 기준으로 일관되게 처리해야 함 (기존 코드도 UTC 사용 확인됨).
- **VIX 반전 컬러**: 기존 `colorClass` 함수를 VIX에 그대로 쓰면 의미가 반전된다. 별도 함수 또는 파라미터 추가 필요.
- **타입 변경 없음**: `IndexReturn` 인터페이스는 변경하지 않는다. weekStartClose는 이미 존재하는 필드이고, 값만 올바르게 교정한다.

## 의사결정 필요

없음 — 바로 구현 가능

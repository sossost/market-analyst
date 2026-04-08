# 일간 리포트 브레드스 섹션 개편 — 중복 제거·Breadth Score 맥락 추가

이슈: #692

## 선행 맥락

- **시장 환경 멀티게이트** (#678): 4개 게이트(S&P>200MA, S&P>50MA, 신고가>신저가, A/D>1.0)가 최근 일간 리포트에 추가됨. 게이트 추가 당시 브레드스 섹션과의 중복 문제는 인지되지 않았음.
- **일간 리포트 데이터-LLM 분리** (#649): 데이터는 프로그래밍으로 렌더링, LLM은 해석만 담당하는 구조가 확립됨. 이번 기획은 해당 원칙 위에서 진행.
- **일간 리포트 가독성 개선** (#679): 브레드스 섹션에 stat-chip 기반 지표 표시 구조가 수립됨. 이번 기획은 해당 구조를 수정함.

## 골 정렬

ALIGNED — 리포트 가독성·판단력 직접 개선. 모순으로 보이는 숫자(Phase 2 비율 감소 vs 순유입 증가)와 맥락 없는 점수(56.5)는 독자의 판단 속도를 늦춘다. Phase 2 초입 포착이 핵심인 이 시스템에서 리포트 해석 마찰을 제거하는 것은 직접 기여다.

## 문제

일간 리포트에서 A/D 비율·신고가/신저가가 시장 환경 게이트와 브레드스 섹션에 이중으로 표시되고, Breadth Score는 숫자만 있어 판단 불가하며, Phase 2 비율 변화와 순유입 건수가 상충하는 것처럼 보이는 설명 부재 문제가 있다.

## Before → After

**Before**
- 브레드스 stat-chip: Phase 2 비율 / A/D Ratio / 신고가/신저가 / Breadth Score / Phase 2 진입·이탈·순유입
- 시장 환경 게이트: S&P>200MA / S&P>50MA / 신고가>신저가(수치 포함) / A/D>1.0(수치 포함)
- Breadth Score: 숫자 하나(56.5), 전일 변화 없음, 스케일 설명 없음
- Phase 2 비율 변화(%p)와 순유입(건) 개념 구분 없음

**After**
- 브레드스 stat-chip에서 A/D Ratio·신고가/신저가 chip을 제거 (게이트 섹션에서 이미 표시)
- Breadth Score chip: 현재값 + 전일 대비 변화 + "252일 퍼센타일" 레이블 추가
- Phase 2 비율 chip에 인라인 설명 추가: "비율 −0.32%p / 순유입 +13건" 형태로 단일 chip에 두 수치 통합, 각 수치 옆에 `(비중)` / `(절대)` 미니 레이블 부여
- 게이트 섹션은 변경 없음

## 변경 사항

### 1. `getMarketBreadth.ts` — 전일 breadthScore 추가 조회 (DB 스키마 변경 불필요)

`executeDailyMode`에서 스냅샷 히트 경로와 폴백 경로 모두에서 전일 `breadth_score`를 조회한다.
`market_breadth_daily` 테이블에 `breadth_score` 컬럼이 이미 존재하므로, 서브쿼리로 전일 값을 가져오는 것으로 충분하다.

```sql
-- 기존 findMarketBreadthSnapshot 쿼리에 추가하거나 별도 쿼리
SELECT breadth_score
FROM market_breadth_daily
WHERE date < $1
ORDER BY date DESC
LIMIT 1
```

반환 타입에 `breadthScoreChange: number | null` 필드 추가.
계산: `breadthScore - prevBreadthScore` (둘 다 non-null일 때만)

### 2. `daily-html-builder.ts` → `renderPhaseDistribution` 수정

#### 2-a. A/D Ratio chip 제거
```
// 제거 대상
<div class="stat-chip">
  <span class="stat-label">A/D Ratio</span>
  ...
```

#### 2-b. 신고가/신저가 chip 제거
```
// 제거 대상
<div class="stat-chip">
  <span class="stat-label">신고가/신저가</span>
  ...
```

#### 2-c. Phase 2 비율 chip 개편 — 비율(%p)과 순유입(건) 통합 표시
현재:
- Phase 2 비율 chip (비율%p 변화만)
- 순유입 chip (건수만, 별도 행)

변경 후 Phase 2 비율 chip 내부:
```
Phase 2 비율
28.3%  +0.15%p  /  순유입 +13건
       (비중 변화)    (절대 수량)
```
두 수치가 다른 개념임을 인라인 레이블로 명시. 순유입 chip은 Phase 2 비율 chip에 통합되므로 별도 행(stat-row)에서 제거.

Phase 2 진입·이탈 chip은 기존 위치 유지.

#### 2-d. Breadth Score chip 개편
현재: `56.5`
변경 후:
```
Breadth Score (252일 퍼센타일)
56.5  +2.3
      (전일 대비)
```
- 레이블에 `(252일 퍼센타일)` 설명 추가
- 값 옆에 변화 표시: `+2.3` / `-1.5` / `보합` (±0.5 미만이면 보합)
- 색상: 상승=up 클래스(빨강), 하락=down 클래스(파랑)

### 3. `DailyBreadthSnapshot` 타입 확장

`src/lib/daily-html-builder.ts`의 `DailyBreadthSnapshot` 인터페이스 또는 공유 타입에 `breadthScoreChange: number | null` 추가.

### 4. `run-daily-agent.ts` — 프롬프트 변경 없음

A/D와 신고가/신저가는 이미 `breadthLines`에 포함되어 있으므로 LLM이 해석 가능. 프롬프트 수정 불필요.

Breadth Score 전일 변화는 LLM 해석 맥락에 추가 가능하지만, 우선순위 낮음. 이번 범위에서 제외.

## 작업 계획

### Step 1 — DB 조회 확장 (구현팀)
**파일**: `src/tools/getMarketBreadth.ts`

- `executeDailyMode`에서 스냅샷 히트 경로: 전일 `breadth_score` 조회 쿼리 추가
- 폴백 경로(집계 쿼리 사용 시): 동일하게 전일 `breadth_score` 조회
- `breadthScoreChange` 계산 후 반환 JSON에 포함
- 완료 기준: `breadthScoreChange` 필드가 반환 JSON에 포함됨. `breadthScore`가 null이면 `breadthScoreChange`도 null.

### Step 2 — 타입 확장 (구현팀, Step 1과 병렬 가능)
**파일**: `src/lib/daily-html-builder.ts` (DailyBreadthSnapshot 인터페이스)

- `breadthScoreChange: number | null` 필드 추가
- 완료 기준: 타입 오류 없음

### Step 3 — HTML 렌더링 수정 (구현팀, Step 2 완료 후)
**파일**: `src/lib/daily-html-builder.ts` → `renderPhaseDistribution`

3-a. A/D Ratio chip 제거
3-b. 신고가/신저가 chip 제거
3-c. Phase 2 비율 chip 개편 (비율%p + 순유입 건수 통합)
  - 순유입 netFlow chip을 Phase 2 비율 chip에 인라인 흡수
  - `stat-sub` 클래스 활용하여 보조 수치 표시
  - 인라인 설명 레이블: `(비중)`, `(절대 수량)` — font-size 0.75rem
3-d. Breadth Score chip 개편 (252일 퍼센타일 레이블 + 전일 변화)
  - BREADTH_SCORE_FLAT_THRESHOLD = 0.5 상수 정의
- 완료 기준: 리포트 HTML에서 A/D Ratio, 신고가/신저가 chip이 브레드스 섹션에 없음. Breadth Score chip에 변화 표시. Phase 2 비율 chip에 순유입 수치 통합.

### Step 4 — 테스트 수정 (구현팀, Step 3 완료 후)
**파일**: `src/lib/__tests__/daily-html-builder.test.ts`

영향 범위 테스트:
- `renderPhaseDistribution`에서 `A/D Ratio` / `신고가/신저가` chip 미표시 확인 테스트 추가
- `breadthScore` 있고 `breadthScoreChange` non-null이면 변화 표시 확인
- `breadthScoreChange` null이면 변화 미표시 확인
- Phase 2 비율 chip에 `비중`, `절대 수량` 인라인 레이블 확인

기존 테스트 수정:
- `"A/D Ratio"` / `"신고가/신저가"` 텍스트 검증 테스트 제거 또는 수정
- `"Breadth Score"` 표시 테스트는 유지 (내부 포맷만 수정)

### Step 5 — 코드 리뷰 (code-reviewer 에이전트)
완료 기준: CRITICAL/HIGH 이슈 없음.

## 리스크

| 리스크 | 내용 | 대응 |
|--------|------|------|
| 전일 breadthScore 없음 | DB 히스토리가 2025-09-25 이전으로 없거나 첫 날인 경우 | `breadthScoreChange: null`로 처리 → chip에서 변화 미표시. 기존 `breadthScoreStr === "—"` 패턴과 동일하게 처리. |
| 폴백 경로 데이터 일관성 | 스냅샷 미존재 시 집계 쿼리 경로에서도 전일 breadthScore 조회 필요 | Step 1에서 두 경로 모두 처리. |
| 테스트 오탐 | A/D, 신고가/신저가 chip 제거로 기존 테스트에서 해당 텍스트를 기대하는 테스트 존재 | Step 4에서 사전에 식별·수정. |
| stat-row 레이아웃 변화 | chip 제거 후 stat-row가 너무 비어 보일 수 있음 | Phase 2 비율 chip 폭을 `flex-grow`로 조정하거나 기존 레이아웃 유지. 별도 CSS 수정 최소화. |

## 의사결정 필요

없음 — 바로 구현 가능.

단, 아래 미세 결정은 구현 팀이 자율 판단:
- Phase 2 비율 chip에서 순유입 수치를 몇 pt 크기로 표시할지 (stat-sub 기존 클래스 활용 권장)
- Breadth Score 변화 "보합" 임계값: ±0.5 (제안값, 조정 가능)

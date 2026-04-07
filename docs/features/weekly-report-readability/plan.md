# 주간 리포트 가독성 개선

## 문제 정의

주간 리포트에서 4가지 가독성 문제가 확인됨:
1. 상단 지표 그리드가 5칸 auto-fit + 공포탐욕 별도 행으로 비균일
2. 브레드스 섹션 타이틀이 "Phase 분포"로 의미 불명확
3. 브레드스 데이터에 LLM 해석(narrative)이 없어 숫자만 나열
4. weeklyTrend 5일 추이 데이터가 있으나 시각화되지 않음

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 상단 그리드 | 5개 지수 auto-fit + 공포탐욕 별도 `.fear-greed-row` | 4×2 균일 그리드 (Row1: S&P/NASDAQ/DOW/Russell, Row2: VIX/10Y/DXY/공포탐욕) |
| 브레드스 타이틀 | `<h3>Phase 분포</h3>` 단독 | 섹션 `<h2>시장 브레드스</h2>` + `<h3>Phase 분포</h3>` 서브타이틀 |
| 브레드스 해석 | 없음 | `breadthNarrative` LLM 해석 블록 추가 |
| weeklyTrend | 차이 계산에만 사용 | 5일 추이 mini-table 시각화 |

## 변경 사항

### 1. 지표 4×2 그리드 (`weekly-html-builder.ts`)
- `renderUs10yCard(idx: IndexReturn)` 함수 추가 — 주간 데이터 기반 (yield %, bp 변화)
- `renderDxyCard(idx: IndexReturn)` 함수 추가 — 포인트 + % 변화
- `renderFearGreedCard(fg: FearGreedData)` 함수 추가 — `.index-card` 형태로 그리드 내 배치
- `renderIndexTable()` 수정: 심볼별 분기(`^TNX` → 10Y, `DX-Y.NYB` → DXY) + 공포탐욕을 그리드 내부로
- CSS `.index-grid`를 `repeat(4, 1fr)` 고정, 모바일에서 `repeat(2, 1fr)`

### 2. 브레드스 섹션 타이틀 (`weekly-html-builder.ts`)
- `buildWeeklyHtml()`의 섹션 1에서 `phase2TrendHtml`을 별도 `<section>`으로 분리
- 메인 타이틀: `<h2>📊 시장 브레드스</h2>`
- Phase 분포 바 위에 서브타이틀 `<h3>Phase 분포</h3>` (이미 존재)

### 3. breadthNarrative (`weeklyReportSchema.ts` + `weekly.ts` + `captureWeeklyInsight.ts`)
- `WeeklyReportInsight`에 `breadthNarrative?: string` 추가 (optional — 기존 리포트 호환)
- `validateWeeklyReportInsight`: breadthNarrative는 optional이므로 필수 검증에 추가하지 않음
- `fillInsightDefaults`: breadthNarrative 기본값 `""` 추가
- `captureWeeklyInsight.ts`: input_schema에 breadthNarrative 필드 추가
- `weekly.ts` 프롬프트: breadthNarrative 작성 가이드 추가
- `buildWeeklyHtml`: breadthNarrative → mdToHtml → content-block 렌더링

### 4. weeklyTrend 5일 추이 mini-table (`weekly-html-builder.ts`)
- `renderWeeklyTrendTable(trend: WeeklyTrendPoint[])` 함수 추가
- 날짜 | Phase 2 비율 | 전일 대비 변화 (색상 적용)
- 데이터 부족(< 2일) 시 graceful degradation

## 작업 계획

1. `weeklyReportSchema.ts` — breadthNarrative 필드 추가
2. `captureWeeklyInsight.ts` — breadthNarrative 스키마 추가
3. `weekly.ts` — 프롬프트 보강
4. `weekly-html-builder.ts` — 4건 렌더링 변경
5. 테스트 업데이트 — 두 테스트 파일
6. 빌드 확인

## 리스크

- **기존 리포트 호환성**: breadthNarrative를 optional로 처리하여 기존 데이터와 호환
- **weeklyTrend 데이터 부족**: 주초 등 5일 미만 데이터 시 graceful degradation
- **CSS 모바일**: 4열 그리드 → 모바일에서 2열로 반응형 처리 (기존 breakpoint 활용)

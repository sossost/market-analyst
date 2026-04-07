# Plan: 일간 리포트 가독성 개선

**이슈**: #679
**트랙**: Lite (UI/레이아웃 개선, 아키텍처 변경 없음)
**골 정렬**: SUPPORT — Phase 2 주도섹터/주도주 포착 목표 직접 기여는 아니나, 리포트 가독성 개선으로 CEO 의사결정 속도 향상

## 문제 정의

2026-04-06 일간 리포트 리뷰에서 CEO 피드백 3건:
1. 상단 지표 그리드가 3칸+별도행으로 불균일
2. 브레드스 섹션에 LLM 해석 없이 숫자만 표시
3. 특이종목이 필터 전수 표시되어 노이즈 과다 (15건)

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 지표 그리드 | 7칸 auto-fit + 공포탐욕 별도행 | 4×2 균일 그리드 (공포탐욕을 카드로 승격) |
| 브레드스 타이틀 | "Phase 분포" | "시장 브레드스" (서브타이틀 "Phase 분포") |
| 브레드스 해석 | 없음 | LLM breadthNarrative 한줄 해석 |
| 특이종목 수 | 전수 (최대 15+) | 상한 8건, 정렬: Phase전환 > 거래량비 > 수익률 |

## 변경 사항

### 1. 상단 지표 그리드 4×2 재배치
- `renderIndexTable`: Fear&Greed를 `index-card` 형태로 변환하여 그리드 내부에 배치
- CSS: `.index-grid`를 `repeat(4, 1fr)`로 변경 (900px 컨테이너에서 4열 고정)
- `renderFearGreed` → `renderFearGreedCard`로 리팩터 (compact card format)
- Row 1: S&P 500 | NASDAQ | DOW 30 | Russell 2000
- Row 2: VIX | 10Y | DXY | 공포탐욕

### 2. 브레드스 섹션 리뉴얼
- `DailyReportInsight`에 `breadthNarrative` 필드 추가
- `fillInsightDefaults`에 기본값 추가 ("해당 없음")
- `buildDailySystemPrompt`: JSON 스키마에 `breadthNarrative` 필드 추가 + 작성 지침
- `renderPhaseDistribution(data, narrative)`: 서브타이틀 "Phase 분포" 추가 + narrative 블록 렌더
- `buildDailyHtml`: 섹션 타이틀 "Phase 분포" → "시장 브레드스", narrative 전달

### 3. 특이종목 노이즈 제한
- `MAX_UNUSUAL_STOCKS = 8` 상수 추가
- `buildDailyHtml`에서 정렬 + 슬라이스 후 `renderUnusualStocksSection`에 전달
- 정렬: Phase 전환 우선 → 거래량비 내림차순 → 수익률 절대값 내림차순
- 상한 초과 시 "(외 N건)" 표시

## 작업 계획

1. 스키마 변경 (`dailyReportSchema.ts`)
2. 프롬프트 변경 (`daily.ts`)
3. HTML 빌더 변경 (`daily-html-builder.ts`)
4. 테스트 업데이트 (`daily-html-builder.test.ts`)
5. 타입 체크 + 테스트 실행

## 의사결정

| 항목 | 결정 | 근거 |
|------|------|------|
| 특이종목 상한 | 8건 | 2행×4열 그리드 기준 최적. 15건 → 8건으로 약 47% 감소 |
| 정렬 우선순위 | Phase전환 > 거래량비 > 수익률 | Phase 전환이 주도주 포착에 가장 핵심 시그널 |
| 공포탐욕 카드 | compact index-card | 기존 넓은 행은 공간 낭비. 핵심 정보(점수/등급/방향)만 유지 |
| breadthNarrative | LLM 인사이트 필드 | 기존 패턴(unusualStocksNarrative 등)과 동일 구조 |

## 리스크

- `renderPhaseDistribution` 시그니처 변경 → 호출부 1곳(`buildDailyHtml`) + 테스트만 영향
- `DailyReportInsight`에 필드 추가 → `fillInsightDefaults`가 폴백 처리하므로 하위호환

## 검증

- 골 정렬: **SUPPORT** — 리포트 품질 개선으로 의사결정 지원
- 무효 판정: **해당 없음** — 렌더링/UI 변경이므로 LLM 백테스트 대상 아님

# Plan: HCI 리포트 분기별 이익률 컬럼 데이터 오류 수정

## 문제 정의

분기별 실적 테이블의 이익률이 3000~4000%로 표시되는 버그.
원인: 이익률 값이 두 곳에서 ×100 적용되어 이중 변환됨.

### 데이터 흐름 (현재 — 버그)

```
DB (decimal 0.3966)
→ normalizeMargin(0.3966) → 39.66 (percent)  ← 1차 ×100
→ stockReport: 39.66 * 100 → 3966%           ← 2차 ×100 (버그)
```

### 영향 범위

1. `stockReport.ts:93` — 분기별 실적 테이블 이익률 표시
2. `fundamentalAgent.ts:150` — LLM 프롬프트 내 분기별 데이터 마진 표시
3. `fundamental-scorer.ts:189` — 이익률 확대 판정 상세 (정상 — ×100 없음)

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 리포트 이익률 | `3965.8%` | `39.7%` |
| LLM 프롬프트 마진 | `마진 3965.8%` | `마진 39.7%` |
| scorer 이익률 | `39.66%` (정상) | `39.66%` (변경 없음) |

## 변경 사항

### 1. 이익률 표시 이중 변환 제거

- `stockReport.ts:93` — `q.netMargin * 100` → `q.netMargin` (이미 percent)
- `fundamentalAgent.ts:150` — `q.netMargin * 100` → `q.netMargin` (이미 percent)

### 2. QA 안전장치 추가 (재발 방지)

- `stockReportQA.ts` — `MARGIN_OVERFLOW` 체크 추가: 이익률이 100% 초과 시 경고
- 기존 `MARGIN_RAW_DECIMAL`과 함께 상/하한 모두 커버

### 3. 테스트 픽스처 정합성

- `fundamentalAgent.test.ts` — `netMargin` 값을 percent 단위로 변경 (0.253 → 25.3)
  - 테스트 데이터가 실제 데이터 로더 출력과 일치하도록

## 작업 계획

1. `stockReport.ts` — `* 100` 제거
2. `fundamentalAgent.ts` — `* 100` 제거
3. `stockReportQA.ts` — `MARGIN_OVERFLOW` 체크 추가
4. `fundamentalAgent.test.ts` — 테스트 픽스처 netMargin 값 수정
5. `stockReportQA.test.ts` — `MARGIN_OVERFLOW` 테스트 추가
6. 전체 테스트 실행 + 커버리지 확인

## 골 정렬

- **판정: SUPPORT**
- 리포트 데이터 정확성은 "주도섹터/주도주 초입 포착" 판단의 기반. 이익률이 3000%로 표시되면 펀더멘탈 검증이 불가능.
- 직접적인 신규 기능은 아니지만, 기존 시스템의 신뢰도를 복구하는 필수 수정.

## 무효 판정

- **해당 없음** — 데이터 표시 버그 수정이므로 LLM 백테스트/과최적화 패턴과 무관.

## 리스크

- **낮음** — 표시 로직만 변경. `normalizeMargin`이나 scorer 로직은 건드리지 않음.
- 기존 QA 체크(`MARGIN_RAW_DECIMAL`)와 새 체크(`MARGIN_OVERFLOW`)가 상호 보완.

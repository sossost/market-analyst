# Plan: sentiment VIX 하락 편향 수정 + geopolitics RS 예측 보정

## 문제 정의

90일간 thesis 적중률 분석 결과:
- **sentiment**: 50% (4/8) — VIX 하락 방향 예측 4회 연속 실패. 고변동성 구간에서 "곧 안정될 것"이라는 낙관 편향 반복.
- **geopolitics**: 40% (2/5) — 같은 섹터에 상반된 방향의 thesis를 제출하고 둘 다 실패. RS score 절대값 예측 과신.

## 골 정렬

**SUPPORT** — Phase 2 주도섹터/주도주 초입 포착의 기반은 정확한 시장 판단.
sentiment/geopolitics 적중률이 macro/tech 수준(100%)에 근접하면 토론 품질이 직접 개선됨.

## 무효 판정

해당 없음 — LLM 백테스트가 아닌 프롬프트 가이드라인 수정. 실제 데이터 기반 패턴 분석에서 도출된 개선.

## Before → After

### sentiment-analyst.md
- **Before**: VIX 고변동성 구간에서의 행동 지침 없음. 하락 예측에 제약 없음.
- **After**: 분석 규칙에 VIX 고변동성 구간(25+) 가이드라인 추가. 레벨 예측 → 레인지 예측 전환 유도.

### geopolitics.md
- **Before**: 규칙 7에서 RS 절대값 예측 금지가 이미 존재하나, 상반된 방향 thesis 동시 제출 방지 룰 없음.
- **After**: 상반된 방향 thesis 동시 제출 방지 규칙 추가 (규칙 8).

## 변경 사항

### 1. `.claude/agents/sentiment-analyst.md` — 분석 규칙 추가

규칙 7 추가:
```
7. **VIX 고변동성 구간 규칙**: VIX 25 이상일 때 "VIX가 곧 하락할 것"이라는 방향 예측을 하지 마라.
   - 역사적으로 VIX > 25 해소에 평균 2-3주 소요. 단기 하락 예측은 낙관 편향.
   - VIX 방향 예측 대신 **레인지 전망**으로 전환: "VIX 20 이하" 대신 "VIX 22-28 레인지 유지 가능성".
   - VIX > 25 구간에서 하락 방향 thesis의 confidence는 반드시 'low'로 제한.
```

### 2. `.claude/agents/geopolitics.md` — 분석 규칙 추가

규칙 8 추가:
```
8. **상반된 thesis 동시 제출 금지**: 같은 섹터/지표에 대해 상반된 방향의 thesis를 동시에 제출하지 마라.
   - 예: "Energy RS 상승" + "Energy RS 하락"을 동시 제출하면 하나는 반드시 실패 — 적중률을 인위적으로 희석.
   - 불확실하면 thesis 제출을 보류하고 "판단 유보"로 명시하라.
```

## 작업 계획

1. sentiment-analyst.md 수정 — 규칙 7 추가
2. geopolitics.md 수정 — 규칙 8 추가
3. 기존 테스트 통과 확인
4. 커밋 및 PR

## 리스크

- **낮음**: 프롬프트 텍스트만 수정. 코드 로직 변경 없음.
- geopolitics.md의 규칙 7(RS 절대값 예측 금지)은 이미 존재하므로, 이번 변경은 보완적.

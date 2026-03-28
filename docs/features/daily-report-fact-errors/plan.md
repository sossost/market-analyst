# Plan: 일간 리포트 팩트 오류 방지 (#479)

## 문제 정의

2026-03-27 일간 리포트에서 팩트 일관성 5/10점. 4개 감점 항목:

1. **전일 종목 상태 오기재 (-2점)**: UGRO, AXTI를 "전일 강세"로 기재했으나 실제로는 약세 특이종목
2. **VIX 등락률 불일치 (-1점)**: 실제 +9.72%인데 +13.16%로 오기재 (LLM이 직접 산술 계산)
3. **역분할 종목 미필터링 (-1점)**: ADV 1:25 역분할을 강세 특이종목으로 오분류
4. **공포탐욕지수 전일 수치 불일치 (-0.5점)**: 직전 리포트 18.2 vs 금일 리포트 "전일 17.5"

## 근본 원인

| 항목 | 근본 원인 |
|------|-----------|
| 1, 4 | `previousReportContext`가 종목의 강세/약세 분류를 구조화하지 않아 LLM이 추론에 의존 |
| 2 | LLM에게 산술 연산 위임. VIX 등락률을 직접 계산하여 오산 |
| 3 | Corporate action(역분할/액분할) 감지 로직 부재 |

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 전일 종목 분류 | `AXTI (Phase 2, RS 85, Technology)` — 강세/약세 불명 | `AXTI (Phase 2, RS 85, Technology) [약세 -13.13%]` — 명시적 분류 |
| VIX 등락률 | LLM이 전일 종가와 금일 종가로 직접 계산 | 프롬프트 규칙으로 `get_index_returns` 결과의 `changePercent` 직접 인용 강제 |
| 역분할 종목 | 강세 특이종목으로 오분류 | `splitSuspect: true` 플래그 + 프롬프트 규칙으로 자동 제외/경고 |
| 공포탐욕지수 전일 값 | 컨텍스트에 포함되지만 LLM이 CNN API previousClose 우선 사용 | 컨텍스트에 **⚠️ 전일 확정값** 강조 표기 |

## 변경 사항

### 1. `src/lib/previousReportContext.ts` — 강세/약세 분류 추출 & 주입

- `extractBullBearClassification(fullContent)` 함수 추가
  - 🔥/⭐ 섹션 → bullish, ⚠️ 섹션 → bearish 분류
  - 티커 + 일간수익률(있으면) 추출
- `formatPreviousReportContext` 수정
  - 특이종목 목록에 `[강세]`/`[약세]` 태그 추가
  - 공포탐욕지수에 "⚠️ 전일 확정값" 강조

### 2. `src/agent/systemPrompt.ts` — 프롬프트 규칙 강화

- VIX 등락률 직접 계산 금지 규칙 추가
- 역분할 의심 종목(`splitSuspect: true`) 처리 규칙 추가
- 전일 종목 분류 참조 시 `<previous-report>` 내 `[강세]`/`[약세]` 태그 우선 규칙

### 3. `src/tools/getUnusualStocks.ts` — 역분할/액분할 의심 플래그

- `splitSuspect` 필드 추가: 일간 수익률 > +90% 또는 < -60% 이면 true
- 기존 필터링은 변경하지 않음 (LLM에게 판단 위임, 프롬프트로 가이드)

### 4. 테스트

- `previousReportContext.test.ts`: `extractBullBearClassification` 테스트 추가
- `getUnusualStocks.test.ts`: `splitSuspect` 플래그 테스트 추가

## 작업 계획

1. `previousReportContext.ts` 수정 + 테스트
2. `getUnusualStocks.ts` 수정 + 테스트
3. `systemPrompt.ts` 프롬프트 규칙 추가
4. 전체 테스트 실행 확인

## 리스크

- fullContent 파싱은 마크다운 형식에 의존 — 형식이 바뀌면 추출 실패 (기존 extractReserveStocks/extractKeyInsights와 동일 패턴, fail-open)
- splitSuspect 임계값(+90%/-60%)은 휴리스틱 — 일부 진성 급등/급락도 잡힐 수 있으나, 프롬프트에서 "의심" 수준으로만 처리하므로 false positive 비용 낮음

## 골 정렬

- **ALIGNED** — 리포트 품질 향상은 프로젝트 핵심 목표(자율 시장 분석 품질)에 직결
- 무효 판정: 해당 없음 (팩트 오류 재발 방지는 명확한 가치)

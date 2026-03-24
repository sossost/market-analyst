# Plan: 일간 QA 섹터 비교 개수 불일치 수정

## 문제 정의

시스템 프롬프트는 LLM에게 RS 상위 **2개** 섹터만 리포트에 포함하도록 지시한다.
그러나 QA(`dailyQA.ts`)는 DB에서 상위 **5개** 섹터를 가져와 Jaccard 유사도로 비교한다.

리포트 2개 vs DB 5개를 비교하면:
- 리포트가 정확해도 intersection=2, union=5, overlap=0.4 < 0.5 → **BLOCK** (거짓 양성)

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| `compareSectors` | DB 전체 vs 리포트 전체를 Jaccard 비교 | DB를 리포트 개수만큼 trim 후 비교 |
| 거짓 양성 | 리포트가 정확해도 개수 차이로 BLOCK | 동일 개수 비교로 거짓 양성 제거 |
| 진짜 오분류 | 감지 | 감지 (변화 없음) |

## 변경 사항

### 1. `src/lib/factChecker.ts` — `compareSectors()`

DB 목록이 리포트보다 길면, DB 목록을 리포트 개수만큼 slice하여 동일 개수로 비교한다.
DB 목록은 이미 `avg_rs DESC` 순서로 정렬되어 있으므로, slice(0, N)이 상위 N개를 정확히 반영한다.

### 2. `src/lib/__tests__/factChecker.test.ts`

비대칭 개수 비교 테스트 케이스 추가:
- DB 5개 vs 리포트 2개, 리포트가 DB 상위 2개와 일치 → OK
- DB 5개 vs 리포트 2개, 리포트가 DB 상위 2개와 불일치 → BLOCK

## 작업 계획

1. `factChecker.ts`의 `compareSectors()` 수정
2. 테스트 케이스 추가 및 실행
3. 전체 테스트 통과 확인

## 골 정렬

- **판정: SUPPORT** — Phase 2 주도섹터/주도주 초입 포착 목표의 인프라 품질 개선. QA 거짓 양성 제거로 실제 오분류만 감지.

## 무효 판정

- **해당 없음** — LLM 백테스트가 아닌 순수 로직 버그 수정.

## 리스크

- **낮음** — 순수 함수 수정. DB 쿼리, 시스템 프롬프트 변경 없음. 기존 동일 개수 비교 동작은 그대로 유지.

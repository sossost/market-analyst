# Plan: isValidTicker U 접미사 필터 정밀화

## 문제 정의

`isValidTicker()`의 `!symbol.endsWith("U")` 규칙이 SPAC 유닛(XXXXU)뿐 아니라 MU(Micron), VU 등 정상 1-2글자 티커를 일괄 제거하고 있음. 동일 패턴이 W 접미사에도 존재하여 W(Wayfair), AW 등 정상 티커도 누락 가능.

현재 DB에 U로 끝나는 티커가 **0건** — 전수 누락.

## 골 정렬 — ALIGNED (직접적)

MU(Micron)는 Semiconductors 업종 대장주. 누락은 업종 RS 계산 왜곡 + Phase 2 초입 종목 탈락으로 직결되며, 프로젝트 골인 '주도주 초입 포착'을 직접 훼손하는 데이터 품질 버그.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| `isValidTicker("MU")` | `false` (누락) | `true` (통과) |
| `isValidTicker("W")` | `false` (누락) | `true` (통과) |
| `isValidTicker("IPOFU")` | `false` (차단) | `false` (차단 유지) |
| `isValidTicker("SPACW")` | `false` (차단) | `false` (차단 유지) |

## 변경 사항

### 1. `src/etl/utils/common.ts` — `isValidTicker()` 수정

U/W 접미사 필터에 길이 조건 추가:
- `U` 접미사: `symbol.length >= 4`일 때만 필터링 (SPAC 유닛은 기본 3자 이상 + U)
- `W` 접미사: `symbol.length >= 4`일 때만 필터링 (워런트는 기본 3자 이상 + W)

X, WS 필터는 현재 이슈 범위 외이므로 유지.

**이중 방어 유지**: Shell Companies 업종 필터(`EXCLUDED_INDUSTRIES`)가 ETL에 별도 적용되어 있으므로, 길이 조건 완화로 SPAC이 유입되더라도 2차 필터에서 차단됨.

### 2. 단위 테스트 신규 작성

`isValidTicker` 전용 단위 테스트 파일 생성. 현재 `load-us-symbols.test.ts`에서는 mock 처리되어 있어 실제 로직 검증이 안 됨.

## 무효 판정

해당 없음. 데이터 품질 버그 수정으로 side effect 없음.

## 리스크

1. **SPAC 유닛 재유입**: 3글자 이하 SPAC 유닛(예: ABU)이 통과할 수 있으나, Shell Companies 업종 필터가 2차 방어로 작동.
2. **ETL 재실행 필요**: 코드 수정만으로는 기존 누락 데이터가 복구되지 않음. 머지 후 symbols ETL 재실행 필요.

# Plan: 섹터 RS 전일 변화를 4주 변화로 교체

## 문제 정의

섹터 RS 테이블의 "RS변화(전일)" 컬럼이 전일 대비 변화를 표시하고 있어 노이즈가 크다.
업종 RS 테이블은 이미 4주 변화(`changeWeek`)를 사용 중이므로 설계 불일치.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 헤더 | `RS변화(전일)` | `RS변화(4주)` |
| 데이터 | `s.rsChange` (전일 avgRs 차이) | `s.change4w` (4주 변화) |
| 포맷 | `.toFixed(2)` | `.toFixed(1)` (업종 테이블과 동일) |

## 변경 사항

### 1. `src/lib/daily-html-builder.ts` — `renderSectorTable()`

- **헤더** (L845): `RS변화(전일)` → `RS변화(4주)`
- **바디** (L816-820): `s.rsChange` → `s.change4w`, `.toFixed(2)` → `.toFixed(1)`

### 2. `src/lib/__tests__/daily-html-builder.test.ts`

- L483-487: 테스트를 `change4w` 기준으로 수정

## 변경하지 않는 것

- `getLeadingSectors.ts` 전일 비교 로직 (순위변동 계산에 필요)
- `DailySectorItem` 인터페이스의 `rsChange` 필드 (순위변동 산출 근거)
- Rising RS 종목 테이블의 `rsChange` (이건 종목별 4주 RS 변화로 별개)

## 리스크

- `change4w`가 null인 경우: 기존 `rsChange` null 처리 패턴과 동일하게 "—" 표시
- 소수점: `.toFixed(1)` — 업종 테이블 `changeWeek`과 일관성 유지

## 골 정렬

- **SUPPORT** — 리포트 품질 개선. 노이즈 제거로 섹터 RS 판단 정확도 향상.

## 무효 판정

- **유효** — 데이터(`change4w`)는 이미 파이프라인에 존재. 표시 레이어만 변경.

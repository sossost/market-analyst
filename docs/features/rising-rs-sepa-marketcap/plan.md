# Plan: RS 상승 초기 종목에 SEPA 등급 + 시가총액 표시

## 문제 정의

RS 상승 초기 종목 섹션이 프로젝트 골(Phase 2 초입 포착)에 가장 직접적인 섹션이지만,
SEPA 등급과 시가총액이 누락되어 최고 시그널(Phase 2 + RS 상승 + SEPA S) 판별이 불가능하다.
시가총액 없이는 소형주 유동성 리스크 판단도 안 된다.

## 골 정렬: ALIGNED

Phase 2 초입 포착이 프로젝트 핵심 골. RS 상승 초기 종목에 SEPA/시총 추가는 골에 직접 기여.

## 무효 판정: VALID

데이터가 DB에 이미 존재(fundamental_scores.grade, symbols.market_cap).
SQL에서 이미 JOIN 중이나 SELECT 절에서 누락된 상태. 구현 비용 극소.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| SEPA 등급 | 미표시 (WHERE 필터만 존재) | 테이블에 S/A 배지 표시 |
| 시가총액 | 미표시 | Large/Mid/Small 구간 레이블 표시 |

## 변경 사항

### 1. SQL SELECT 확장 (`stockPhaseRepository.ts`)
- `findRisingRsStocks` SELECT 절에 `fs.grade AS sepa_grade`, `s.market_cap` 추가
- 이미 JOIN된 테이블이므로 추가 JOIN 불필요

### 2. Row 타입 확장 (`types.ts`)
- `RisingRsStockRow`에 `sepa_grade: string | null`, `market_cap: string | null` 추가

### 3. Tool 반환값 매핑 (`getRisingRS.ts`)
- `.map()` 반환 객체에 `sepaGrade`, `marketCap` 필드 추가
- `market_cap`은 숫자 변환 후 반환 (number | null)

### 4. 스키마 확장 (`dailyReportSchema.ts`)
- `DailyRisingRSStock`에 `sepaGrade: string | null`, `marketCap: number | null` 추가

### 5. HTML 렌더링 (`daily-html-builder.ts`)
- `renderRisingRSSection` 테이블에 SEPA 등급, 시총 컬럼 추가
- 시총 구간: Large(≥$10B), Mid($2B~$10B), Small(<$2B)
- SEPA는 기존 weekly-html-builder 패턴(plain text) 따름

### 6. 테스트 업데이트
- `getRisingRS.test.ts`: makeRow에 새 필드 추가, 매핑 검증
- `daily-html-builder.test.ts`: createMockRisingRSStock에 새 필드 추가, 렌더링 검증

## 작업 계획

1. types.ts → RisingRsStockRow 확장
2. stockPhaseRepository.ts → SQL SELECT 확장
3. getRisingRS.ts → 매핑 추가
4. dailyReportSchema.ts → DailyRisingRSStock 확장
5. daily-html-builder.ts → 렌더링 추가
6. 테스트 업데이트
7. 빌드/테스트 검증

## 리스크

- **낮음**: WHERE 절에 `fs.grade IN ('S', 'A')` 필터가 이미 존재하므로, 모든 결과가 S 또는 A 등급만 표시됨. 이는 의도된 동작(SEPA S/A만 포착 대상).
- **낮음**: `market_cap`이 symbols 테이블에 text로 저장되어 있으나, 이미 `::numeric` 캐스팅으로 필터에 사용 중. SELECT에서도 동일 패턴 사용.

# 업종 RS 독립 랭킹 조회 기능 (industry-rs-ranking)

## 선행 맥락

섹터 vs 업종 해상도 문제 사건 (2026-03-26):
- Technology 섹터 RS 44.25(전체 최하위)지만 내부에 Semiconductors RS 64.48, Communication Equipment RS 63.33 존재
- 당시 watchlist 게이트를 섹터→업종으로 교체하여 종목 탈락 문제는 해결
- 그러나 에이전트가 실시간 분석 중 전체 업종 RS 랭킹을 독립적으로 조회할 도구가 여전히 없음
- `getLeadingSectors`는 섹터 상위 N개 → 각 섹터 내 상위 3개 업종 top-down 구조로 고정됨

현재 실증된 갭:
- Technology 섹터 RS: 42.86 (11위 = 최하위) → `getLeadingSectors`로 Semiconductors(62.42, 25위), Communication Equipment(61.3, 29위) 불가시
- Consumer Defensive 섹터(47.93) → Food Confectioners(75.75) → 에이전트가 못 봄

## 골 정렬

**ALIGNED** — Phase 2 초입 포착의 핵심 도구.
섹터 RS에 가로막혀 강한 업종을 놓치는 구조적 맹점 제거. 에이전트가 전체 업종 RS 상위 목록을 직접 조회함으로써 "섹터 약세 속 업종 강세" 패턴을 포착할 수 있게 된다.

## 문제

`getLeadingSectors`의 top-down 구조상 섹터 RS 하위 섹터에 속한 강한 업종은 에이전트에게 불가시 영역이다. 전체 업종 RS 독립 랭킹 조회 수단이 없어 섹터 경계를 넘는 업종 강세 발굴이 불가능하다.

## Before → After

**Before**: 에이전트가 "Technology 섹터 RS 최하위라 관심 제외"로 판단 → Semiconductors 업종 RS 62.42 포착 실패
**After**: `get_leading_sectors` with `mode: 'industry'` → 전체 135개 업종 RS 상위 N개 + 소속 섹터 RS + 섹터-업종 괴리(divergence) 반환

## 변경 사항

### 1. `src/db/repositories/types.ts`
- `IndustryRsGlobalRow` 인터페이스 추가
  - 기존 `IndustryRsRow` 필드 전체 포함 (sector, industry, avg_rs, rs_rank, group_phase, phase2_ratio)
  - 추가 필드: `change_4w`, `change_8w`, `change_12w` (업종 RS 모멘텀 포함)
  - 추가 필드: `sector_avg_rs` (소속 섹터 RS, JOIN으로 획득)
  - 추가 필드: `sector_rs_rank` (소속 섹터 순위)

### 2. `src/db/repositories/sectorRepository.ts`
- `findTopIndustriesGlobal(date: string, limit: number): Promise<IndustryRsGlobalRow[]>` 추가
  - `industry_rs_daily` LEFT JOIN `sector_rs_daily` ON sector + date
  - 섹터 필터 없음 — 전체 업종 대상
  - `ORDER BY i.avg_rs::numeric DESC LIMIT $2`
  - JOIN으로 sector_avg_rs, sector_rs_rank 함께 반환

### 3. `src/db/repositories/index.ts`
- `findTopIndustriesGlobal` + `IndustryRsGlobalRow` export 추가

### 4. `src/tools/getLeadingSectors.ts`
- input_schema `mode` enum에 `'industry'` 추가
- description 업데이트: industry 모드 설명 포함
- `execute` 분기 추가:
  - `mode === 'industry'`일 때 `findTopIndustriesGlobal(date, limit)` 호출
  - 각 업종 row를 `mapIndustryGlobalRow`로 변환하여 반환
  - `divergence` 필드 = `industry_avg_rs - sector_avg_rs` (양수 = 섹터 대비 업종 초과 강세)
  - 반환 구조: `{ date, mode: 'industry', industries: [...] }`

## 작업 계획

### Step 1 — 타입 정의 (sectorRepository.ts + types.ts)
에이전트: 실행팀
완료 기준:
- `IndustryRsGlobalRow` 타입에 모든 필드 포함
- `findTopIndustriesGlobal` SQL이 sector_rs_daily JOIN 포함하여 올바른 데이터 반환
- `findTopIndustries` 기존 시그니처 변경 없음 (하위 호환 유지)

### Step 2 — index.ts export 추가
에이전트: 실행팀
완료 기준:
- `findTopIndustriesGlobal`, `IndustryRsGlobalRow` export 정상 작동

### Step 3 — getLeadingSectors.ts industry 모드 추가
에이전트: 실행팀
완료 기준:
- `mode: 'industry'` 입력 시 `findTopIndustriesGlobal` 호출
- `divergence` 필드 = industry avgRs - sector avgRs, 소수점 2자리
- `_note` 필드 포함 (phase2Ratio 퍼센트 주의)
- 기존 `daily` / `weekly` 모드 동작 변경 없음

### Step 4 — 테스트
에이전트: 실행팀
완료 기준:
- `findTopIndustriesGlobal` 단위 테스트: 섹터 필터 없이 전체 업종 반환 확인
- `mode: 'industry'` 통합 테스트: divergence 필드 계산 정확성 확인
- 기존 `daily` / `weekly` 모드 회귀 없음

## 리스크

- `industry_rs_daily`에 `change_4w/8w/12w` 컬럼이 없을 수 있음 — `findTopIndustries`의 기존 SELECT에 없는 컬럼이므로 실제 스키마 확인 필요. 없으면 타입에서 제외하고 모멘텀 필드 생략.
- `sector_rs_daily`의 해당 날짜 데이터가 없는 경우 → LEFT JOIN이므로 sector_avg_rs = null 처리 필요. divergence도 null.
- `limit` 기본값: 기존 DEFAULT_LIMIT = 10이 섹터용. 업종은 135개 전체 중 상위라 20~25개가 더 유용할 수 있음 → 기본값은 변경하지 않고 호출자가 limit 파라미터로 조정하도록 유지.

## 의사결정 필요

없음 — 바로 구현 가능

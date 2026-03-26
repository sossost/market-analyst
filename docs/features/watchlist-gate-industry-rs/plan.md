# Plan: 관심종목 게이트 섹터 RS → 업종 RS 교체

## 문제 정의

5중 교집합 게이트의 2번 조건(섹터 RS >= 50)이 11개 섹터 단위로 평가되어,
업종(industry) 단위 강세가 섹터 약세에 묻히는 문제.

**예시**: Semiconductors 업종 RS 64.48이지만 Technology 섹터 RS 44.25 → 게이트 탈락.
같은 Technology 섹터 내 Software-Application RS 33.40이 평균을 끌어내림.

F11 전환(2025-12) 이후 `watchlist_stocks` 테이블 0건. 실질적으로 게이트가 막혀 있음.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 게이트 조건 | 섹터 RS >= 50 (11개 섹터) | 업종 RS >= 50 (135개 업종) |
| WatchlistGateInput 필드 | `sectorRs` | `industryRs` |
| GateCondition 타입 | `"sectorRs"` | `"industryRs"` |
| saveWatchlist 입력 스키마 | `sector_rs` | `industry_rs` |
| 에이전트 프롬프트 게이트 표 | "섹터 RS 동반 상승" | "업종 RS 동반 상승" |
| DB 컬럼 `entry_sector_rs` | 변경 없음 | 변경 없음 (값만 업종 RS로 저장) |

## 변경 사항

### 1. `src/lib/watchlistGate.ts`
- `MIN_SECTOR_RS` → `MIN_INDUSTRY_RS` (값 50 유지)
- `WatchlistGateInput.sectorRs` → `industryRs`
- `GateCondition`: `"sectorRs"` → `"industryRs"`
- `evaluateSectorRsCondition()` → `evaluateIndustryRsCondition()`
- 메시지: "섹터" → "업종"

### 2. `src/tools/saveWatchlist.ts`
- `WatchlistRegisterInput.sector_rs` → `industry_rs`
- 입력 스키마 `sector_rs` → `industry_rs`, description 업종으로 변경
- `sectorRs` 매핑 → `industryRs`
- tool description 업데이트

### 3. `src/agent/systemPrompt.ts`
- 5중 게이트 표: "섹터 RS 동반 상승" → "업종 RS 동반 상승"
- 게이트 관련 참조만 변경. 섹터 RS 일반 참조(레짐, 리포트, 섹터 랭킹)는 유지.

### 4. 테스트
- `watchlistGate.test.ts`: 함수명, 조건명, 상수명 업데이트
- `saveWatchlist.test.ts`: `sector_rs` → `industry_rs`

### 수정하지 않는 것
- DB 컬럼명 `entry_sector_rs` — 마이그레이션 비용 대비 효과 미미, 값만 업종 RS로 변경
- 섹터 RS 수집 (`sector_rs_daily`) — 레짐, 토론, 리포트에서 계속 사용
- 나머지 4개 게이트 조건 — 합리적 기준, 유지
- 임계값 50 — 업종 단위에서 적절

## 골 정렬

**ALIGNED** — "Phase 2 주도섹터/주도주 초입 포착" 목표에 직결.
업종 단위 RS 평가로 섹터 내부 강세 업종 종목이 게이트를 통과할 수 있게 되어,
관심종목 적재가 재개된다.

## 무효 판정

해당 없음. LLM 백테스트, 과최적화 패턴 아님.
`industry_rs_daily` 테이블이 이미 매일 수집 중이므로 추가 인프라 불필요.

## 리스크

- **낮음**: DB 컬럼명(`entry_sector_rs`)과 실제 저장 값(업종 RS)의 의미 불일치.
  향후 DB 마이그레이션으로 정리 가능. 현재는 주석으로 명시.
- **낮음**: 에이전트가 기존 `sector_rs` 파라미터를 보낼 수 있음.
  → 도구 스키마가 `industry_rs`로 변경되므로 에이전트는 새 스키마를 따름.

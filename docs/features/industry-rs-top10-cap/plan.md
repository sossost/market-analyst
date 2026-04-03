# Plan: 업종 RS Top 10 — 섹터당 2개 제한 + HTML 렌더링

## 선행 맥락

**industry-rs-ranking (2026-03)**: `get_leading_sectors` mode=industry 추가.
전체 135개 업종 RS 상위 N개 + divergence(업종RS - 섹터RS) 반환 구현 완료.
이미 divergence 필드가 계산되어 반환되고 있다.

**4/2 리포트 문제**: mode=industry Top 10 결과 10개 중 7개가 Energy 섹터.
섹터당 제한 없이 RS 순위만으로 뽑으면 강세 섹터가 독식하는 구조적 결함.

**의도한 인사이트**: "Technology 섹터 RS 최하위인데 Semiconductors가 Top 10" —
이런 divergence가 높은 업종이 실질적인 알파 시그널이다.

## 골 정렬

**ALIGNED** — 섹터 독식 문제를 제거하여 섹터와 다른 시그널을 내는 업종을 발굴.
Phase 2 초입 포착의 정밀도를 높이는 직접 기여.

## 문제

`get_leading_sectors` mode=industry Top 10이 RS 순위만으로 정렬되어
특정 강세 섹터(Energy 등)가 10자리를 독식한다. 에이전트와 HTML 리포트 모두
"섹터간 다양성"을 전제로 설계되었으나 실제 출력은 단일 섹터 집중.
또한 업종 테이블 전용 HTML 렌더러가 없어 섹터 테이블 폴백으로 렌더링된다.

## Before → After

**Before**: Top 10 = [Energy×7, Health Care×2, Materials×1]. divergence 높은 업종은
해당 섹터 RS가 중간이면 Top 10 진입 불가.

**After**: Top 10 = 섹터당 최대 2개 제한. 최대 11개 섹터에서 고루 선발.
divergence 컬럼이 HTML 테이블에 컬러로 시각화.

## 변경 사항

### 1. `src/tools/getLeadingSectors.ts`
- `DEFAULT_INDUSTRY_LIMIT` (현재 10) → 상수를 DB 쿼리용 fetch limit으로 분리:
  `INDUSTRY_FETCH_LIMIT = 50` (DB에서 가져올 상위 N개)
  `INDUSTRY_TOP_N = 10` (최종 반환 개수)
  `INDUSTRY_SECTOR_CAP = 2` (섹터당 최대 개수)
- `findTopIndustriesGlobal` 호출 시 limit을 `INDUSTRY_FETCH_LIMIT`으로 변경
- 매핑 후 `applyIndustrySectorCap(industries, INDUSTRY_SECTOR_CAP, INDUSTRY_TOP_N)` 적용
- 반환 전 `industries` 배열이 `INDUSTRY_TOP_N`개로 슬라이스됨

### 2. `src/lib/industryFilter.ts` (신규)
섹터당 제한 로직을 순수 함수로 분리.

```typescript
export function applyIndustrySectorCap<T extends { sector: string }>(
  industries: T[],
  sectorCap: number,
  topN: number,
): T[]
```

- RS 내림차순이 보장된 입력을 가정 (DB 정렬 그대로)
- 섹터별 카운터 Map으로 O(n) 처리
- `topN`개 채워지면 조기 종료
- 순수 함수 — 사이드이펙트 없음 → 단위 테스트 용이

### 3. `src/lib/industryFilter.test.ts` (신규)
`applyIndustrySectorCap` 단위 테스트.

테스트 케이스:
- 섹터당 2개 제한이 정확히 적용되는지
- Energy 7개 입력 → Energy 2개만 출력
- 총 10개 미만 데이터에서 정상 동작 (데이터 부족 시 있는 만큼 반환)
- topN 초과 입력이 잘리는지
- 섹터 빈 문자열 등 엣지 케이스

### 4. `src/lib/htmlReport.ts`
`renderIndustryTable(text: string): string | null` 함수 추가.

컬럼 구성 (업종 테이블 전용):
| # | 업종 | 소속 섹터 | RS | Divergence | Phase | 4주 변화 |

Divergence 컬러링 규칙:
- 양수(업종 > 섹터): `class="up"` (빨강) — 섹터 대비 초과 강세
- 음수(업종 < 섹터): `class="down"` (파랑) — 섹터 대비 약세

`renderSectionByHeading` 분기에 추가:
```
if (headingContains(heading, "업종 RS", "주도 업종")) {
  const sectionHtml = renderIndustryRankingSection(body);
  ...
}
```

`renderIndustryRankingSection` 함수 추가 — `renderSectorRankingSection`과 동일 구조.
업종 테이블 렌더링 후 "주요 업종 전환" 블록 처리.

섹터 테이블 판별(`renderSectorTable`)이 업종 테이블을 오판하지 않도록
`hasSector && !hasIndustry` 조건으로 보강.

### 5. `src/agent/systemPrompt.ts` — 라인 112
기존:
```
- 업종 RS Top 10은 현재 미포함 (추후 개선 예정)
```

변경:
```
- 업종 RS Top 10: get_leading_sectors(mode='industry', limit=10)
  - 결과는 섹터당 최대 2개로 제한되어 반환됨 (다양한 섹터의 업종 발굴 목적)
  - divergence(양수) = 섹터 약세 속 업종 단독 강세 → 핵심 인사이트
  - 리포트의 "주도 업종 RS" 섹션에 포함
```

### 6. `sample-report.html`
업종 RS 테이블 디자인 섹션 추가.
기존 섹터 RS 테이블 직후에 배치.
divergence 컬럼 up/down 컬러 적용 확인 가능하도록 샘플 데이터 포함.

## 작업 계획

### 커밋 1: 순수 함수 분리 + 테스트
**파일**: `src/lib/industryFilter.ts` (신규), `src/lib/industryFilter.test.ts` (신규)

완료 기준:
- `applyIndustrySectorCap` 구현
- 단위 테스트 전체 통과 (`yarn test`)
- 엣지 케이스 포함

### 커밋 2: getLeadingSectors 적용
**파일**: `src/tools/getLeadingSectors.ts`

완료 기준:
- `INDUSTRY_FETCH_LIMIT = 50` 상수 추가
- `findTopIndustriesGlobal(date, INDUSTRY_FETCH_LIMIT)` 호출
- 매핑 후 `applyIndustrySectorCap(industries, 2, 10)` 적용
- 기존 mode=daily, mode=weekly 분기 영향 없음 확인

### 커밋 3: HTML 렌더러 추가
**파일**: `src/lib/htmlReport.ts`

완료 기준:
- `renderIndustryTable` 구현 (divergence 컬러링 포함)
- `renderIndustryRankingSection` 구현
- `renderSectionByHeading`에 "업종 RS", "주도 업종" 분기 추가
- `renderSectorTable` 오판 가드 추가

### 커밋 4: 프롬프트 복원 + sample-report 업데이트
**파일**: `src/agent/systemPrompt.ts`, `sample-report.html`

완료 기준:
- systemPrompt 라인 112 지시 복원
- sample-report.html에 업종 RS 테이블 샘플 추가
- divergence 컬러 실제 렌더링 확인

## 리스크

- **DB 데이터 부족**: `INDUSTRY_FETCH_LIMIT = 50` 이상 업종 데이터가 없으면 실제 10개 미만 반환 가능. 정상 동작 — 있는 만큼 반환.
- **섹터 테이블 오판**: `renderSectorTable`이 업종 테이블을 섹터 테이블로 오판할 경우 divergence 컬럼 손실. 섹터 테이블 판별 조건에 `hasIndustry` 컬럼 부재 체크로 방어.
- **프롬프트 토큰**: 업종 RS Top 10 추가로 컨텍스트 증가. 10개 row 기준 무시할 수준.

## 의사결정 필요

없음 — 바로 구현 가능.

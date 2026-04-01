# Plan: 일간 리포트 Phase 표/서술 모순 + Technology 섹터 표 누락 수정

**이슈**: #538
**타입**: Lite (버그 수정)
**골 정렬**: ALIGNED — 리포트 팩트 일관성은 시스템 신뢰도의 핵심. Phase 방향 오보는 투자 판단 왜곡 가능성.
**무효 판정**: 해당 없음 (명확한 버그 수정)

## 문제 정의

### Bug 1: Consumer Cyclical Phase 표/서술 방향 모순
- **현상**: 섹터 표에서 `Phase 3→4`(악화)로 표기했으나, 서술에서는 `Phase 4→3 개선`이라고 반대 방향으로 기술
- **근본 원인**: 시스템 프롬프트에서 `Phase X→Y` 표기 시 X=prevGroupPhase, Y=groupPhase 순서를 명시하지 않음. LLM이 표와 서술에서 방향을 다르게 생성.
- **영향**: 모든 섹터의 Phase 전환 표기에서 동일 문제 발생 가능

### Bug 2: Technology 섹터 RS 표 누락
- **현상**: 11개 GICS 섹터 중 10개만 표에 수록. Technology(RS 42.23, 최하위)가 누락
- **근본 원인**: `getLeadingSectors.ts`의 `DEFAULT_LIMIT = 10`이 `findTopSectors` SQL의 `LIMIT $2`에 전달됨. 11개 섹터 중 RS 최하위 1개가 항상 잘림.
- **영향**: 매일 RS 최하위 섹터가 리포트에서 누락되어, 해당 섹터의 약세 분석이 근거 없이 진행됨

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 섹터 표 | RS 상위 10개만 표시 (11번째 섹터 누락) | 전체 섹터 표시 (LIMIT 제거) |
| Phase 표기 | `Phase X→Y` 순서 불명확 → LLM 혼동 | `prevGroupPhase→groupPhase` 순서 명시 |
| Phase 방향 검증 | 서술-표기 방향만 검증 | 서술-표기 방향 검증 (기존 유지) |

## 변경 사항

### 1. `src/tools/getLeadingSectors.ts`
- `DEFAULT_LIMIT = 10` → `DEFAULT_INDUSTRY_LIMIT = 10` (industry 모드 전용)
- `SECTOR_QUERY_LIMIT = 50` 추가 (섹터 쿼리용, 11개 GICS 섹터를 모두 포함하는 안전 상한)
- daily/weekly 모드의 `findTopSectors` 호출 시 `SECTOR_QUERY_LIMIT` 사용
- weekly 모드의 `findSectorsByDate` 호출 시도 `SECTOR_QUERY_LIMIT` 사용
- industry 모드는 기존 `DEFAULT_INDUSTRY_LIMIT` 유지
- tool description에서 "기본 10" → "섹터: 전체, 업종: 기본 10"으로 변경

### 2. `src/agent/systemPrompt.ts`
- 기존 line 304 Phase 전환 서술 규칙에 `prevGroupPhase→groupPhase` 순서 명시 추가
- 표와 서술에서 동일 방향 사용 의무 명시

### 3. 테스트 업데이트
- `__tests__/agent/tools/getLeadingSectors.test.ts`에 전체 섹터 반환 검증 테스트 추가
- 기존 테스트의 mock 호출 순서가 limit 변경으로 깨지지 않는지 확인

## 작업 계획

1. `getLeadingSectors.ts` — DEFAULT_LIMIT 분리 및 섹터 쿼리 limit 변경
2. `systemPrompt.ts` — Phase 표기 순서 명시
3. 테스트 업데이트 및 실행
4. 셀프 리뷰 및 커밋

## 리스크

- **낮음**: 섹터 limit 변경은 DB 쿼리에 LIMIT 50을 전달할 뿐, 실제 반환 행은 11개. 성능 영향 없음.
- **낮음**: 프롬프트 변경은 기존 규칙의 보강이며, 다른 리포트 타입(주간)에도 동일 규칙 적용. 부작용 없음.
- **주의**: weekly 모드의 newEntrants/exits 계산도 limit 영향을 받으므로 함께 수정.

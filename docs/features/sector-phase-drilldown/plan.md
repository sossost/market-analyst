# Plan: 섹터 Phase 전환 감지 시 업종 드릴다운 자동 포함

**이슈**: #522
**트랙**: Lite (리포트 생성 로직 수정, 새 아키텍처 아님)
**골 정렬**: ALIGNED — Phase 2 초입 포착 선행성 향상. 섹터 Phase 전환의 실질 드라이버와 견고성을 업종 단위로 판단 가능.
**무효 판정**: 해당 없음 — `industry_rs_daily` 인프라 이미 존재, 추가 ETL 불필요.

## 문제 정의

일간 브리핑에서 섹터 Phase 전환(예: Financial Services 3→2)을 감지하면 "Phase 3→2 전환, RS +1.33" 수준만 서술. **왜 전환됐는지**에 대한 업종 단위 근거가 없어 리포트 품질 저하.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 섹터 Phase 전환 서술 | "Phase 3→2 전환" 한 줄 | + 업종 드릴다운 (RS 변화 상위, Phase 이상 업종, Phase2 비율) |
| 데이터 소스 | `sector_rs_daily`만 사용 | `industry_rs_daily` 조건부 조회 추가 |
| 적용 범위 | Phase 전환 섹터만 | 동일 (전환 없는 섹터는 영향 없음) |

## 변경 사항

### 1. Repository: `findIndustryDrilldown` 추가
- **파일**: `src/db/repositories/sectorRepository.ts`, `src/db/repositories/types.ts`
- **내용**: 특정 섹터의 업종 드릴다운 조회 (RS 변화 포함)
- `industry_rs_daily` 현재일 + 전일 LEFT JOIN으로 RS 변화 계산
- 섹터 배열 입력 → 한 번의 쿼리로 여러 섹터 처리

### 2. Daily Flow: `getLeadingSectors` 수정
- **파일**: `src/tools/getLeadingSectors.ts`
- **내용**: daily 모드에서 Phase 전환 섹터에 `phaseTransitionDrilldown` 필드 추가
- 전환 섹터가 없으면 추가 쿼리 없음 (성능 영향 제로)
- 드릴다운 포함: RS 변화 상위 5개 업종, Phase 이상 업종, Phase2 업종 비율

### 3. Debate Flow: `marketDataLoader` 수정
- **파일**: `src/debate/marketDataLoader.ts`
- **내용**: `formatMarketSnapshot`에 Phase 전환 섹터 드릴다운 섹션 추가
- `loadMarketSnapshot`에서 전환 섹터 감지 → `findIndustryDrilldown` 조회
- 마크다운 포맷으로 렌더링

### 4. System Prompt 업데이트
- **파일**: `src/agent/systemPrompt.ts`
- **내용**: 드릴다운 데이터 활용 지침 추가 (Phase 전환 서술 시 업종 근거 포함)

### 5. 테스트
- `getLeadingSectors` daily 모드 드릴다운 테스트
- `formatMarketSnapshot` 드릴다운 렌더링 테스트
- `findIndustryDrilldown` 쿼리 매핑 테스트

## 작업 계획

1. `IndustryDrilldownRow` 타입 + `findIndustryDrilldown` 함수 추가
2. `getLeadingSectors` daily 모드에 드릴다운 로직 삽입
3. `marketDataLoader`에 드릴다운 로딩 + 포맷팅 추가
4. `systemPrompt`에 드릴다운 활용 지침 추가
5. 테스트 작성 및 검증

## 리스크

- **성능**: Phase 전환 섹터에만 조건부 실행 → 전환 없으면 추가 쿼리 0건. 전환 시에도 단일 쿼리 (섹터 배열 IN 조건).
- **리포트 비대화**: 전환 섹터당 최대 5개 업종만 표시, Phase 이상 업종은 별도 레이블.

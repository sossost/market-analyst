# Plan: 서사 체인 시각화 (narrative-chain-visualization)

> Issue: #402 · Priority: P3 · Track: Lite

## 골 정렬

- **판정: SUPPORT**
- 근거: `narrative_chains` 데이터는 "Phase 2 주도섹터/주도주 초입 포착"의 구조적 근거(수요-공급-병목 서사)를 시각화한다. 직접적인 포착 로직은 아니지만, CEO가 서사 체인 상태를 한눈에 파악하여 의사결정 품질을 높이는 지원 기능.

## 무효 판정

- **해당 없음** — LLM 백테스트, 과적합 등 무효 패턴에 해당하지 않음. 순수 프론트엔드 시각화.

## 문제 정의

`narrative_chains` 테이블에 megatrend → demand driver → supply chain → bottleneck 데이터가 축적되고 있으나, 프론트엔드에서 확인할 수 없음. CEO가 서사 체인의 현황, 흐름, 연결된 thesis를 파악하려면 DB 직접 조회가 필요.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 서사 체인 확인 | DB 직접 조회 필요 | `/narrative-chains` 페이지에서 목록 + 상세 확인 |
| 상태 필터 | 불가 | ACTIVE / RESOLVING / RESOLVED / OVERSUPPLY / INVALIDATED 필터 |
| 흐름도 | 없음 | megatrend → demand → supply chain → bottleneck 시각화 |
| N+1 병목 | 텍스트로만 존재 | 상세 페이지에서 시각적 표시 |

## 변경 사항

### 1. Feature 모듈 생성
- `frontend/src/features/narrative-chains/types.ts` — NarrativeChainStatus, NarrativeChainSummary, NarrativeChainDetail 타입
- `frontend/src/features/narrative-chains/constants.ts` — 상태 라벨, 타입가드, ITEMS_PER_PAGE
- `frontend/src/features/narrative-chains/lib/supabase-queries.ts` — fetchNarrativeChains, fetchNarrativeChainById

### 2. 목록 페이지 (`/narrative-chains`)
- `frontend/src/app/(main)/narrative-chains/page.tsx` — 어셈블리 페이지
- `NarrativeChainStatusFilter` — 상태 필터 탭 (use client)
- `NarrativeChainTable` — 비동기 서버 컴포넌트 (megatrend별 그룹핑, 수혜 섹터/종목 태그)
- `NarrativeChainTableSkeleton` — 로딩 스켈레톤

### 3. 상세 페이지 (`/narrative-chains/[id]`)
- `frontend/src/app/(main)/narrative-chains/[id]/page.tsx` — 어셈블리 페이지
- `NarrativeChainDetail` — 흐름도 (megatrend → demand → supply → bottleneck)
- N+1 병목 예측 표시
- 연결된 thesis 목록 (linkedThesisIds)
- Alpha Gate 적합성 배지

### 4. 네비게이션
- `nav-items.ts`에 `/narrative-chains` 항목 추가 (Link 아이콘)

### 5. 테스트
- `constants.test.ts` — 상태 라벨, 타입가드 테스트
- `supabase-queries.test.ts` — mapRowToChain 매퍼 테스트

## 작업 계획

1. Feature 모듈 (types → constants → queries)
2. 목록 페이지 컴포넌트
3. 상세 페이지 컴포넌트
4. 네비게이션 추가
5. 테스트 작성
6. 문서 업데이트

## 리스크

- **낮음**: narrative_chains 테이블에 데이터가 적을 수 있음 → 빈 상태 UI로 대응
- **낮음**: linkedThesisIds로 thesis 조회 시 N+1 가능 → 목록에서는 count만 표시, 상세에서만 조회

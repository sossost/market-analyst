# Thesis-Aligned Candidates

## 선행 맥락

narrative_chains의 beneficiary 데이터 품질 문제는 이미 2회 기획된 적이 있다:

1. **narrative-chain-redesign** (plan.md) — beneficiary 빈 배열 82%. 근본 원인: `parseBottleneckFromThesis()`가 thesis 자유형 텍스트에서 정규식 추출 → 100% 실패. 해결: `buildChainFields()`로 교체, Round 3 프롬프트에 `narrativeChain` 구조화 필드 추가. **구현 완료.**
2. **briefing-restructure** (01-spec.md, 02-decisions.md) — beneficiarySectors 빈 배열 문제로 코드 레벨 매칭 불가. "LLM 프롬프트 주입 방식"(옵션 A)으로 우회. "beneficiarySectors 채우기는 별도 이슈로 추적"이라 명시.

현재 코드 상태:
- `narrativeChainService.ts`의 `buildChainFields()`는 thesis.narrativeChain 구조화 필드를 직접 매핑하도록 이미 리팩터링 완료.
- `round3-synthesis.ts`에 beneficiarySectors/beneficiaryTickers 작성 규칙 프롬프트 이미 포함.
- 하지만 9개 ACTIVE chain 중 7개가 여전히 빈 배열 → **프롬프트 개선 이후 생성된 chain도 beneficiary가 비는 경우가 있다는 것**. 이는 LLM이 프롬프트 규칙을 일부 무시하거나, structural_narrative가 아닌 카테고리의 thesis에서 chain이 생성되었을 가능성.

핵심: beneficiary 데이터 품질 개선은 narrative_chains 생성 로직(토론 엔진) 쪽 문제이고, 이번 기능(Thesis-Aligned Candidates 리포트 섹션)은 **이미 채워져 있는 beneficiary 데이터 + ACTIVE theses의 정보를 stock_phases/SEPA와 조인하여 표시하는 것**이다. 두 문제를 분리한다.

## 골 정렬

**ALIGNED.**
ACTIVE thesis가 가리키는 수혜주의 기술적 상태(Phase, RS, SEPA)를 자동 연결하면:
- thesis가 예측한 구조적 전환이 실제 가격 행동으로 반영되고 있는지 즉시 확인 가능
- Phase 2 초입 포착의 "서사적 근거 + 기술적 확인" 교차 검증이 데이터 블록으로 자동화
- 관심종목 등록 게이트(5중 교집합)의 4번 조건(서사적 근거)과 직접 연동

## 문제

ACTIVE thesis/narrative_chain이 수혜주를 지목하고 있지만, 해당 종목의 현재 기술적 상태(Phase, RS, SEPA)를 자동으로 연결하는 데이터 블록이 없다. CEO가 수동으로 thesis의 수혜주를 stock_phases에서 조회해야 하며, 일간 리포트에서 이 연결을 볼 수 없다.

## Before → After

**Before**
- 일간 리포트에 ACTIVE thesis 정보가 LLM 프롬프트에만 주입 (텍스트)
- narrative_chains의 beneficiary_tickers는 DB에 있지만 리포트에 기술적 상태와 조인되어 표시되지 않음
- CEO가 "광통신 thesis → AAOI, LITE, CIEN" 연결을 수동으로 확인

**After**
- 일간 리포트에 "Thesis-Aligned Candidates" 데이터 블록 추가
- ACTIVE thesis/chain의 수혜주를 stock_phases + fundamental_scores와 자동 조인
- 종목별 Phase, RS, SEPA 등급, 관심종목 등록 가능 여부가 한눈에 표시
- beneficiary가 빈 배열인 chain은 섹션에서 자동 제외 (노이즈 방지)

## 변경 사항

### 1. 데이터 수집 함수 신규 (`src/lib/thesisAlignedCandidates.ts`)

ACTIVE chain/thesis에서 수혜주를 추출하고 기술적 데이터와 조인하는 함수.

```
buildThesisAlignedCandidates(date: string): Promise<ThesisAlignedData>
```

로직:
1. `narrative_chains` WHERE status IN ('ACTIVE', 'RESOLVING') AND beneficiary_tickers 비어있지 않음 (jsonb_array_length > 0)
2. 수혜주 목록 추출 (중복 제거)
3. `stock_phases` WHERE symbol IN (수혜주) AND date = targetDate → Phase, RS, pct_from_high_52w
4. `fundamental_scores` WHERE symbol IN (수혜주) AND scored_date <= targetDate → SEPA 등급 (DISTINCT ON symbol, 최신)
5. `company_profiles` WHERE symbol IN (수혜주) → sector, industry, market_cap
6. 체인별 그룹화 → 종목별 기술적 상태 병합

출력 타입:
```typescript
interface ThesisAlignedCandidate {
  symbol: string;
  chainId: number;
  megatrend: string;
  bottleneck: string;
  chainStatus: NarrativeChainStatus;
  phase: number | null;
  rsScore: number | null;
  pctFromHigh52w: number | null;
  sepaGrade: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  // 관심종목 등록 가능 여부 (5중 게이트 중 충족 조건 수)
  gatePassCount: number;
  gateTotalCount: number;
}

interface ThesisAlignedChainGroup {
  chainId: number;
  megatrend: string;
  bottleneck: string;
  chainStatus: NarrativeChainStatus;
  alphaCompatible: boolean | null;
  daysSinceIdentified: number;
  candidates: ThesisAlignedCandidate[];
}

interface ThesisAlignedData {
  chains: ThesisAlignedChainGroup[];
  totalCandidates: number;
  phase2Count: number;
}
```

**게이트 체크**: 각 종목에 대해 5중 교집합 게이트 조건 충족 여부를 간이 판정.
- Phase 2 여부
- RS >= 60
- 업종 RS >= 50 (industry_rs_daily에서 조회)
- SEPA S 또는 A
- thesis 연결 = 이미 충족 (chain에서 왔으므로)

full watchlistGate를 호출하지 않고, 데이터를 직접 판정한다. watchlistGate는 단건 호출용이고, 여기서는 배치 조회가 효율적.

### 2. 스키마 타입 추가 (`src/tools/schemas/dailyReportSchema.ts`)

`DailyReportData`에 optional 필드 추가:

```typescript
thesisAlignedCandidates?: ThesisAlignedData | null;
```

optional로 하여 기존 리포트 동작에 영향 없음.

### 3. 데이터 수집 통합 (`src/agent/run-daily-agent.ts`)

`collectDailyData()` 내부에서 기존 병렬 호출 그룹과 별도로 (독립적이므로 같은 Promise.all에 추가 가능):

```typescript
const thesisAlignedRaw = await buildThesisAlignedCandidates(targetDate)
  .catch((err) => {
    logger.warn("ThesisAligned", `수집 실패 (계속 진행): ${...}`);
    return null;
  });
```

`data.thesisAlignedCandidates = thesisAlignedRaw;`

### 4. HTML 렌더러 추가 (`src/lib/daily-html-builder.ts`)

`renderThesisAlignedSection(data: ThesisAlignedData | null | undefined): string`

- data가 null/undefined이거나 chains가 비었으면 빈 문자열 반환 (섹션 미출력)
- 체인 그룹별로 카드 렌더링:
  - 헤더: megatrend + bottleneck + chain status + 경과일
  - 테이블: symbol | Phase | RS | SEPA | 업종 | 시총 | 게이트(N/5)
  - Phase 2 + RS 60+ 종목은 하이라이트 (관심종목 유력 후보)

섹션 삽입 위치: **섹션 7 (RS 상승 초기) 뒤, 섹션 8 (관심종목 현황) 앞**.
이유: RS 상승 초기 → thesis 연결 종목 → 관심종목 현황 순서가 자연스러운 필터링 퍼널.
데이터가 없으면 섹션 자체가 미출력되므로 레이아웃에 영향 없음.

### 5. narrative_chains beneficiary 품질 개선 (토론 엔진)

현재 9개 ACTIVE chain 중 7개가 beneficiary 빈 배열인 문제.

**원인 분석**: `narrativeChainService.ts`의 `recordNarrativeChain()`은 thesis.beneficiarySectors가 빈 배열이면 UPDATE 시에도 빈 배열을 덮어쓰지 않는 조건부 로직(`...(info.beneficiarySectors.length > 0 && { ... })`)이 이미 있다. 즉 한번 빈 배열로 생성된 chain은 이후 thesis에 beneficiary가 있어도 **기존 빈 값을 유지하지 않고 새 값으로 업데이트된다**. 문제는 chain 생성(INSERT) 시점에 해당 thesis의 beneficiary가 빈 배열이었다는 것.

**해결 방향**: Round 3 프롬프트에 beneficiary 작성 규칙이 이미 있으므로, 프롬프트를 추가 강화하는 것은 효과가 제한적. 대신:

(a) `recordNarrativeChain()` INSERT 시, beneficiary가 빈 배열이면 **같은 megatrend의 기존 ACTIVE chain에서 beneficiary를 상속**하는 fallback 추가. 동일 서사의 이전 chain에 데이터가 있을 수 있다.

(b) `buildChainFields()`에서 thesis.beneficiarySectors가 빈 배열이고 thesis.narrativeChain이 있을 때, narrativeChain.bottleneck 텍스트에서 업종 키워드를 추출하여 company_profiles와 매칭하는 것은 과도한 확장. 이번 범위에서 제외.

**최종**: (a)만 구현. 동일 서사의 기존 chain에서 beneficiary를 상속하는 간단한 fallback.

## 작업 계획

### Step 1 — 데이터 수집 함수 + 타입 (구현팀)

**파일**: `src/lib/thesisAlignedCandidates.ts` (신규), `src/tools/schemas/dailyReportSchema.ts`
**내용**:
- `ThesisAlignedCandidate`, `ThesisAlignedChainGroup`, `ThesisAlignedData` 타입 정의
- `buildThesisAlignedCandidates(date)` 구현 — DB 쿼리 3건 (narrative_chains + stock_phases + fundamental_scores) 배치 조인
- 게이트 간이 판정 (Phase 2 + RS >= 60 + SEPA S/A + thesis 연결)
- DailyReportData에 optional 필드 추가
- 단위 테스트: 빈 chain 필터링, 게이트 카운트 정확성

**완료 기준**: TypeScript 컴파일 통과. 빈 beneficiary chain 제외 확인. 게이트 카운트 = Phase2(0/1) + RS60(0/1) + SEPA(0/1) + thesis(항상 1) = 최대 4/5 (업종 RS는 별도 쿼리 필요하므로 이번 범위에서 4/5로 간소화, 업종 RS 게이트는 향후 추가 가능).

**의존성**: 없음

### Step 2 — 데이터 수집 통합 (구현팀)

**파일**: `src/agent/run-daily-agent.ts`
**내용**:
- `collectDailyData()` 내 Promise.all에 `buildThesisAlignedCandidates(targetDate)` 추가
- 실패 시 null fallback (기존 리포트 동작에 영향 없음)
- 로그: 체인 수, 총 후보 수, Phase 2 후보 수

**완료 기준**: 기존 도구 호출에 영향 없이 병렬 수집. 실패 시 graceful degradation.

**의존성**: Step 1

### Step 3 — HTML 렌더러 + 섹션 삽입 (구현팀)

**파일**: `src/lib/daily-html-builder.ts`
**내용**:
- `renderThesisAlignedSection()` 함수 구현
- 체인별 카드: megatrend, bottleneck, status, 경과일
- 종목 테이블: symbol, Phase, RS, SEPA, 업종, 시총, 게이트 점수
- Phase 2 + RS 60+ 종목 하이라이트 (CSS class)
- `buildDailyHtml()`에서 RS 상승 초기 뒤, 관심종목 앞에 조건부 삽입

**완료 기준**: 데이터 있을 때 섹션 렌더링. 데이터 없으면 섹션 미출력. XSS escape 적용.

**의존성**: Step 1 (타입), Step 2 (데이터 흐름)

### Step 4 — beneficiary 상속 fallback (구현팀)

**파일**: `src/debate/narrativeChainService.ts`
**내용**:
- `recordNarrativeChain()` INSERT 경로에서, info.beneficiarySectors가 빈 배열일 때:
  - `findMatchingChain()` 결과가 null이면 (새 chain) → 같은 megatrend 키워드로 기존 ACTIVE chain 검색 → beneficiary 상속
  - 기존 chain UPDATE 경로에서는 이미 조건부 덮어쓰기 로직이 있으므로 수정 불필요
- 단위 테스트: 빈 beneficiary thesis → 기존 chain의 beneficiary 상속 확인

**완료 기준**: 새 chain INSERT 시 동일 서사의 기존 chain에서 beneficiary 상속. 기존 chain이 없거나 기존 chain도 빈 배열이면 빈 배열 유지 (강제 채움 금지).

**의존성**: 없음 (Step 1~3과 독립)

## 리스크

**R1. beneficiary 데이터가 대부분 비어있어 섹션이 거의 항상 미출력될 수 있음**
- 현재 9개 중 2개만 유효. 섹션이 의미 있으려면 최소 2~3개 chain에 beneficiary 필요.
- 완화: Step 4(상속 fallback)로 기존 chain의 데이터 재활용. 추가로, 시간이 지남에 따라 새로 생성되는 chain에서 프롬프트 규칙에 의해 beneficiary가 채워질 것.
- 섹션 미출력은 노이즈 방지이므로 부정적이지 않음.

**R2. DB 쿼리 3건 추가로 일간 리포트 생성 시간 증가**
- 완화: 3건 모두 인덱스 기반 조회 (narrative_chains.status, stock_phases.date, fundamental_scores.symbol+scored_date). 각 쿼리 < 50ms 예상. 기존 Promise.all에 편입하므로 전체 지연 증가는 미미.

**R3. 게이트 간이 판정에서 업종 RS 게이트 누락**
- 5중 게이트 중 업종 RS는 industry_rs_daily 테이블 조인이 필요. 이번 범위에서는 4/5로 간소화.
- 완화: 게이트 점수를 "N/4 (업종RS 미포함)" 으로 명시 표기하여 오해 방지. 향후 업종 RS 조인 추가 시 5/5로 업그레이드.

## 의사결정 필요

없음 — 바로 구현 가능.

스코프가 명확하고 기존 인프라를 활용한 조인 + 렌더링이다. beneficiary 상속 fallback(Step 4)은 보수적 범위로 제한했다. 게이트 간소화(4/5)는 향후 이슈로 분리 가능.

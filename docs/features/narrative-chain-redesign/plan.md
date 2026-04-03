# Narrative Chain 전면 재설계

## 선행 맥락

thesis 원본은 정상이나 파싱 단계에서 구조적 실패. 33건 전수 조사 결과:
- demand_driver, supply_chain 100% 빈 문자열 (정규식 매칭 실패)
- megatrend와 bottleneck 동일 텍스트 55%
- beneficiary 빈 배열 82%
- 동일 서사("AI 광통신") 14건 중복 생성
- status ACTIVE 고착 32/33건

thesis 테이블에 `beneficiaryTickers`, `beneficiarySectors` 컬럼이 없음을 확인.
현재 백필 스크립트(`scripts/backfill-narrative-chains.ts`)도 이 컬럼들을 빈 배열로 고정한 채
`recordNarrativeChain`을 재호출하므로, 파싱 로직이 바뀌지 않으면 백필해도 동일하게 실패한다.

## 골 정렬

ALIGNED.
서사체인은 "구조적 병목이 어디에 있고 N+1은 무엇인가"를 추적하는 핵심 인텔리전스다.
현재 33건이 오염된 상태에서는 `narrativeChainService`가 병목 탐색에 기여하지 못한다.
신뢰할 수 있는 체인 데이터를 확보해야 Phase 2 초입 포착 정밀도가 올라간다.

## 문제

Round 3 합성 LLM이 이미 구조화된 JSON(`beneficiarySectors`, `beneficiaryTickers`, `nextBottleneck`)을 출력하는데,
정작 `narrativeChainService`는 그 JSON을 무시하고 thesis 자유형 텍스트에서 정규식으로 필드를 재추출한다.
원천 데이터(LLM JSON 아웃풋)가 이미 정확한데 파이프라인이 이를 우회하는 구조적 모순이다.

## Before → After

**Before**
- Round 3 LLM → Thesis 객체 (구조화 필드 포함)
- `recordNarrativeChain(thesis)` 호출
- `parseBottleneckFromThesis()`: thesis.thesis 자유형 텍스트에서 정규식으로 megatrend/demand_driver/supply_chain/bottleneck 추출 → 100% 실패
- `findMatchingChain()`: megatrend 문자열 완전 일치 + bottleneck jaccard 0.7 → 매번 NEW 체인 INSERT → 중복 난립
- beneficiary는 thesis 객체에 있어도 파싱 단계 이전에 소실 가능성 없지만, 서사 필드(4개) 자체가 빈 채로 저장

**After**
- Round 3 LLM → Thesis 객체 (구조화 필드 포함)
- `recordNarrativeChain(thesis)` 호출
- `buildChainFields()`: thesis 객체의 기존 구조화 필드를 직접 매핑 (정규식 제거)
  - `megatrend` = thesis.thesis 첫 문장 (단순 추출 — 자유형에서 최선)
  - `bottleneck` = thesis.thesis 핵심 문장 (LLM 프롬프트에서 구조화 요청으로 품질 보장)
  - `demand_driver`, `supply_chain` = Round 3 LLM이 직접 출력한 값
  - `beneficiarySectors`, `beneficiaryTickers` = thesis 객체의 해당 필드 직접 사용
- **새로운 체인 매칭 전략**: megatrend 완전 일치 대신 `bottleneck` 첫 키워드 클러스터링 + thesis.nextBottleneck 연속성 체크
- 기존 오염 데이터 TRUNCATE → 재백필

## 변경 사항

### 1. Round 3 프롬프트 개선 (`src/debate/round3-synthesis.ts`)

thesis JSON 스키마에 서사체인 4개 필드를 명시적으로 추가 요청:

```
"narrativeChain": {
  "megatrend": "AI 인프라 확장 (전력/냉각 병목)",
  "demandDriver": "AI 모델 파라미터 증가 → 데이터센터 전력 수요 급증",
  "supplyChain": "전력 변압기 → 냉각 시스템 → 광트랜시버",
  "bottleneck": "현재 광트랜시버 대역폭 제한 (800G→1.6T 전환 지연)"
}
```

작성 규칙 추가:
- `structural_narrative` 카테고리에만 `narrativeChain` 필드 작성. 나머지는 null.
- bottleneck: 현재 공급 병목 노드 1개만. 여러 개 나열 금지.
- demandDriver: "왜 이 수요가 발생하는가" — 구조적 원인 1~2줄.
- supplyChain: 병목까지 이어지는 공급망 경로. 화살표(→) 형식 권장.
- beneficiary 구분 강화: beneficiarySectors/Tickers는 **현재 병목** 수혜. nextBottleneck과 연결된 수혜는 `nextBeneficiarySectors`/`nextBeneficiaryTickers` 별도 필드 추가.

### 2. Thesis 타입 확장 (`src/types/debate.ts`)

```typescript
// 추가 필드
narrativeChain?: {
  megatrend: string;
  demandDriver: string;
  supplyChain: string;
  bottleneck: string;
} | null;
nextBeneficiarySectors?: string[] | null;
nextBeneficiaryTickers?: string[] | null;
```

### 3. narrativeChainService.ts 전면 리팩터링

**제거**: `parseBottleneckFromThesis()`, `extractField()`, `extractFirstSentence()`, `FIELD_PATTERNS`

**신규**: `buildChainFields(thesis: Thesis): BottleneckInfo | null`
- `thesis.narrativeChain`이 있으면 직접 매핑
- `narrativeChain`이 null이면 thesis.thesis에서 단순 fallback (메가트렌드 = 첫 문장, 병목 = 전체 텍스트)
- 이 fallback은 프롬프트 개선 이전 구세대 thesis의 백필용으로만 사용

**체인 매칭 개선**: `findMatchingChain()` 전략 교체
- 현재: megatrend 완전 일치 + bottleneck jaccard 0.7
- 변경: `bottleneck` 앞 3단어 키워드 기반 클러스터링
  - "현재 광트랜시버 대역폭 제한" → 키워드 ["광트랜시버", "대역폭", "제한"]
  - 기존 체인 중 키워드 2개 이상 겹치면 "동일 서사"로 판정 → UPDATE
  - 키워드 1개 이하 → NEW INSERT

**status 전환 로직**: 현재 thesis 텍스트에서 OVERSUPPLY/RESOLVED 키워드를 감지하는 로직은 유지.
프롬프트에서 `narrativeChain.bottleneck` 문장에 상태 키워드가 포함되어 있으면 동일하게 작동한다.

### 4. 백필 스크립트 교체 (`scripts/backfill-narrative-chains.ts`)

기존 스크립트를 신규 전략으로 교체:

1. `narrative_chains` 테이블 TRUNCATE (오염 데이터 전체 삭제)
2. `theses` 테이블에서 `category = 'structural_narrative'` 전건 조회 (날짜 제한 없음)
3. 날짜 오름차순으로 `recordNarrativeChain()` 순차 호출 (체인 연속성 보존)
4. 각 thesis에 대해 처리 결과 로그 출력
5. 기존 스크립트의 `--dry-run` 옵션 유지

### 5. Round 3 합성 파서 업데이트 (`src/debate/round3-synthesis.ts`)

JSON 파싱 단계에서 `narrativeChain`, `nextBeneficiarySectors`, `nextBeneficiaryTickers` 필드를 Thesis 객체로 매핑.
기존 `beneficiarySectors`/`beneficiaryTickers`는 현재 병목 수혜로 유지.

## 작업 계획

### Step 1 — 타입 + 프롬프트 + 파서 (구현팀)

**파일**: `src/types/debate.ts`, `src/debate/round3-synthesis.ts`
**내용**:
- Thesis 타입에 `narrativeChain`, `nextBeneficiarySectors`, `nextBeneficiaryTickers` 추가
- Round 3 프롬프트 JSON 스키마에 `narrativeChain` 블록 추가 (작성 규칙 포함)
- Round 3 파싱 로직에서 신규 필드 추출

**완료 기준**: TypeScript 컴파일 에러 없음. 신규 필드가 Thesis 객체에 올바르게 매핑됨.
**의존성**: 없음 (독립 시작 가능)

### Step 2 — narrativeChainService 리팩터링 (구현팀)

**파일**: `src/debate/narrativeChainService.ts`
**내용**:
- `parseBottleneckFromThesis()` 삭제 → `buildChainFields()` 신규 구현
- `findMatchingChain()` 키워드 클러스터링 전략으로 교체
- 기존 API(`recordNarrativeChain()`) 시그니처 유지 (thesisStore.ts 수정 없음)

**완료 기준**:
- `buildChainFields()`가 narrativeChain 필드를 직접 매핑함을 단위 테스트로 검증
- `findMatchingChain()`이 동일 서사를 NEW 대신 UPDATE로 처리함을 단위 테스트로 검증
- 기존 테스트 파일(`src/debate/__tests__/`) 통과

**의존성**: Step 1 완료 (Thesis 타입 확장)

### Step 3 — 백필 스크립트 교체 (구현팀)

**파일**: `scripts/backfill-narrative-chains.ts`
**내용**:
- TRUNCATE → 전건 재백필 로직으로 교체
- `--dry-run` 옵션 유지
- 처리 건수, 성공/실패, 생성된 체인 수 요약 출력

**완료 기준**:
- `--dry-run` 실행 시 처리 대상 목록만 출력
- 실제 실행 시 narrative_chains 레코드 수가 합리적 범위 (중복 없이 서사 단위 클러스터링됨)

**의존성**: Step 2 완료

### Step 4 — 백필 실행 + 검증 (구현팀)

**내용**:
1. `--dry-run`으로 처리 대상 확인
2. 실제 백필 실행
3. DB에서 샘플 쿼리로 demand_driver, supply_chain, beneficiary 필드 채워짐 확인
4. 동일 서사 중복 해소 확인 (AI 광통신 서사가 1건으로 통합되었는지)

**완료 기준**:
- demand_driver, supply_chain 빈 문자열 비율 < 20% (narrativeChain 필드가 없는 구세대 thesis는 fallback으로 빈 값 허용)
- 동일 서사 중복 없음 (서사 단위 체인이 1개 이상으로 분리되지 않음)
- 신규 thesis(프롬프트 개선 이후)에서 narrativeChain 필드가 채워짐

**의존성**: Step 3 완료

## 리스크

**R1. LLM이 narrativeChain 필드를 일관되게 출력하지 않을 수 있음**
- 완화: 프롬프트에 필드별 작성 규칙과 예시를 구체적으로 포함. 미출력 시 fallback으로 기존 thesis 텍스트 사용.
- 이 경우 demand_driver/supply_chain은 여전히 빈 값이지만 megatrend/bottleneck은 최소한 채워진다.

**R2. 키워드 클러스터링이 과도하게 관대하면 다른 서사가 병합될 수 있음**
- 완화: 키워드 2개 임계값은 보수적 설정. 단위 테스트에서 "AI 광통신" vs "AI 서버 전력" 케이스를 명시적으로 검증.
- 과도한 병합은 너무 엄격한 중복보다 탐지하기 쉽다.

**R3. TRUNCATE 후 백필 도중 실패 시 narrative_chains 일시 공백**
- 완화: 백필은 운영 시간 외(주말 또는 토론 미실행 시간대)에 실행. 공백 중 토론이 실행되면 빈 체인에서 새로 시작하므로 오히려 클린 스레이트.
- thesisStore.ts의 `recordNarrativeChain` 실패 격리 로직이 이미 있으므로 토론 시스템 중단 없음.

**R4. 구세대 thesis(narrativeChain 필드 없음)의 백필 품질**
- 완화: 현재 33건 thesis 중 narrativeChain 필드가 있는 것은 프롬프트 개선 이후 건만 해당.
- 구세대 thesis에 대해서는 megatrend = 첫 문장, bottleneck = thesis 요약으로 최선 추출. demand_driver/supply_chain은 빈 값 허용.
- 이 thesis들은 어차피 ACTIVE 상한 초과 또는 timeframe 초과로 조만간 EXPIRED 처리됨.

## 의사결정 필요

**Q1. `nextBeneficiarySectors` / `nextBeneficiaryTickers` 신규 필드를 Thesis 타입과 Round 3 JSON 스키마에 추가하되, narrative_chains 테이블 스키마 변경은 이번 범위에서 제외할지 확인 필요.**

현재 `narrative_chains` 테이블은 `beneficiary_sectors`, `beneficiary_tickers` 컬럼 하나씩이다.
N+1 수혜 vs 현재 병목 수혜를 구분하려면 컬럼이 2쌍으로 늘어나야 한다.
이번 재설계 범위에 DB 마이그레이션을 포함할지, 아니면 Thesis 타입과 프롬프트 개선만 먼저 하고 DB 변경은 다음 이슈로 분리할지 결정 필요.

**권장**: 이번 범위에서는 Thesis 타입에 필드 추가하되, DB 저장은 기존 beneficiary_* 컬럼에 현재 병목 수혜만 저장하는 것으로 한정. nextBeneficiary는 Thesis 런타임 객체에만 존재하고 별도 이슈로 분리.

**Q2. 백필 시 TRUNCATE 대신 기존 체인을 남기고 UPDATE만 할지 여부.**

TRUNCATE 후 재백필이 깔끔하지만, 기존 `linked_thesis_ids`, `bottleneck_identified_at`(최초 탐지 날짜)이 소실된다.
보존 가치가 있다면 UPDATE 전략을 취해야 하나, 현재 데이터가 오염되어 있어 보존 가치가 낮다.

**권장**: TRUNCATE. 오염 데이터 재사용 시 키워드 매칭이 오염된 megatrend를 기준으로 동작하여 새 체인이 또 오염된 체인으로 병합될 위험이 있다. 클린 스레이트 후 재백필이 안전하다.

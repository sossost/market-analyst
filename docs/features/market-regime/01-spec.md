# 시장 레짐 분류기 — Phase 1: LLM 정성 태깅

## 선행 맥락

RFC-narrative-layer.md (2026-03-08) 제안 8에서 최초 정의:
- "어떤 종목이 좋은가"보다 "지금이 종목을 찾을 때인가"가 더 중요한 판단
- Wave 3 항목으로 분류됨 (데이터 축적 후 착수)
- 레짐별 추천 적중률 분리 추적 → "LATE_BULL에서 적중률 22%, MID_BULL에서 58%" 같은 메타 학습 축적이 목표
- RFC 리스크 메모: "초기에는 참고 정보로만 사용, 자동 행동 조정은 충분한 검증 후"

GitHub Issue #94에서 Wave 3 대기 없이 Phase 1(LLM 정성 태깅)만 선행 착수하는 방향으로 범위 조정됨.

docs/features/debate-evolution/00-ideation.md에서도 레짐 기반 학습 태그 필요성 언급 (2025년).

## 골 정렬

**SUPPORT** — 직접 주도주 포착 기능은 아니나, 시스템 전체의 메타 스위치 역할.

약세장에서 Phase 2 신호를 무비판적으로 따르면 위양성 급증 → 추천 신뢰도 훼손 → 시스템 전체가 무력화된다.
레짐 정보가 주간/일간 에이전트에 주입되면 에이전트가 레짐을 감안하여 추천 적극성을 스스로 조절할 수 있고,
장기적으로는 레짐별 적중률 분리 추적을 통해 시스템이 자기 한계를 인식하게 된다.
이것이 Phase 2 초입 포착 신뢰도를 지키는 기반 인프라다.

## 문제

현재 시스템은 시장 레짐을 인식하지 않고 항상 동일한 기준으로 Phase 2 초입 종목을 추천한다.
약세장에서도 강세장 기준을 그대로 적용하면 위양성이 급증하고, 에이전트가 레짐을 감안한 판단을 할 근거 데이터가 없다.

## Before → After

**Before**
- 레짐 정보 없음. 에이전트는 매번 독립적으로 시장 분위기를 서술하지만 구조화된 레짐 판정은 없음.
- 주간/일간 에이전트는 레짐과 무관하게 동일 기준으로 추천.
- 추천 성과를 레짐별로 분리 추적할 수 없어, 어떤 레짐에서 시스템이 잘/못 작동하는지 알 수 없음.

**After**
- 매일 토론 종료 시 macro-economist가 `market_regime` 태그 하나를 정성적으로 판정하여 DB에 기록.
- 주간 에이전트 프롬프트에 현재 레짐 + 최근 30일 레짐 히스토리가 주입됨.
- 레짐이 EARLY_BEAR / BEAR일 때 에이전트가 스스로 추천 적극성을 낮추는 컨텍스트를 갖게 됨.
- 추천 테이블에 레짐 스냅샷이 기록되어 "이 추천은 어떤 레짐에서 나왔는가"를 추적 가능.
- 3개월 이상 데이터 축적 후 Phase 2에서 레짐별 적중률 분리 분석 가능.

## 변경 사항

### DB 변경

**신규 테이블: `market_regimes`**
```
id              serial PK
regime_date     text NOT NULL UNIQUE   -- YYYY-MM-DD (debate_date와 동기화)
regime          text NOT NULL          -- EARLY_BULL | MID_BULL | LATE_BULL | EARLY_BEAR | BEAR
rationale       text NOT NULL          -- macro-economist의 판정 근거 (2~4줄)
confidence      text NOT NULL          -- 'low' | 'medium' | 'high'
tagged_by       text NOT NULL DEFAULT 'macro'  -- 향후 확장용
created_at      timestamp with timezone DEFAULT now()
```

**기존 테이블 변경: `recommendations`**
```
market_regime   text NULL              -- 추천 시점의 레짐 스냅샷 (나중에 읽기 전용 추적)
```

### 코드 변경

**1. 토론 round3-synthesis.ts — JSON 포맷 확장**

moderator 출력 JSON에 `marketRegime` 필드 추가 (debate-level 필드, thesis-level이 아님):

```json
{
  "marketRegime": {
    "regime": "MID_BULL",
    "rationale": "Phase 2 종목 수 정상, 브레드스 안정, VIX 20 미만",
    "confidence": "medium"
  },
  "theses": [ ... ]
}
```

이 필드는 round3-synthesis.ts의 `buildSynthesisPrompt`에서 moderator에게 요청하는 방식으로 추가.
단, 태깅 주체는 moderator가 아니라 **macro-economist 판단을 round3에서 종합**하는 구조.
실제로는 moderator가 round1의 macro 분석을 참조하여 최종 태그를 출력.

**2. src/agent/debate/regimeStore.ts (신규)**

```typescript
// 레짐 저장/조회 전담 모듈
saveRegime(date: string, regime: MarketRegime): Promise<void>
loadLatestRegime(): Promise<MarketRegimeRow | null>
loadRecentRegimes(days: number): Promise<MarketRegimeRow[]>
formatRegimeForPrompt(rows: MarketRegimeRow[]): string
```

**3. src/agent/debate/round3-synthesis.ts — 추출 로직 확장**

`extractThesesFromText`를 `extractDebateOutput`으로 확장:
- 기존 theses 배열 추출 유지
- 신규 `marketRegime` 객체 추출 추가
- marketRegime 유효성 검사 (VALID_REGIMES 상수)

**4. src/agent/run-weekly-agent.ts — 레짐 주입**

주간 에이전트 실행 시 `loadRecentRegimes(30)`으로 최근 30일 레짐을 불러와 시스템 프롬프트에 주입.

**5. src/agent/tools/saveRecommendations.ts — 레짐 스냅샷 기록**

추천 저장 시 현재 레짐을 `recommendations.market_regime`에 기록.

### 프롬프트 변경

**round3-synthesis.ts `buildSynthesisPrompt` 추가 섹션:**

브리핑 구조 마지막에 아래 섹션 추가:

```
## 시장 레짐 판정 (JSON)

리포트 마지막에 아래 JSON을 추가하세요.

레짐 분류 기준:
- EARLY_BULL: 브레드스 반전 신호, Phase 2 비율 상승 초기, 지수 바닥 확인 구간
- MID_BULL:   다수 섹터 Phase 2, RS 상위 종목 다수, 추천 적극성 정상
- LATE_BULL:  소수 종목만 주도, 브레드스 피크 후 하락, 과열 신호
- EARLY_BEAR: 브레드스 급락, Phase 4 비율 상승, 방어 필요
- BEAR:       다수 섹터 하락 추세, Phase 2 신호 신뢰도 매우 낮음

macro-economist의 round1 분석을 최우선으로 참조.
확신이 없으면 confidence: 'low'로 표기.

```json
{
  "marketRegime": {
    "regime": "MID_BULL",
    "rationale": "판정 근거 2~4줄",
    "confidence": "low|medium|high"
  }
}
```
```

## 작업 계획

### Step 1: DB 마이그레이션 (구현팀 — backend)
- `market_regimes` 테이블 생성 (Drizzle 스키마 + 마이그레이션 파일)
- `recommendations` 테이블에 `market_regime` 컬럼 추가
- 완료 기준: `npm run db:migrate` 성공, Supabase에서 테이블 확인

### Step 2: round3-synthesis.ts 확장 (구현팀 — backend)
- `buildSynthesisPrompt`에 레짐 판정 요청 섹션 추가
- `extractDebateOutput` 함수: theses + marketRegime 동시 추출
- 유효성 검사: VALID_REGIMES 상수 (`EARLY_BULL | MID_BULL | LATE_BULL | EARLY_BEAR | BEAR`)
- marketRegime 없을 경우: null로 처리하고 경고 로그 (저장 실패시키지 않음)
- 완료 기준: 유닛 테스트 통과, 기존 theses 추출 로직 무중단

### Step 3: regimeStore.ts 신규 생성 (구현팀 — backend)
- `saveRegime`, `loadLatestRegime`, `loadRecentRegimes`, `formatRegimeForPrompt` 구현
- 같은 날짜 재실행 시 upsert (UNIQUE 제약 활용)
- 완료 기준: 유닛 테스트, DB 조회 정상

### Step 4: thesisStore.ts의 debate 실행 흐름에 레짐 저장 연결 (구현팀 — backend)
- `runDebateAgent` 또는 `saveTheses` 호출 지점에서 `saveRegime` 병렬 실행
- 에러 격리: 레짐 저장 실패가 토론 전체를 중단시키지 않도록
- 완료 기준: 토론 실행 후 `market_regimes` 테이블에 레코드 확인

### Step 5: 주간 에이전트 레짐 주입 (구현팀 — backend)
- `run-weekly-agent.ts`에서 `loadRecentRegimes(30)` + `formatRegimeForPrompt` 호출
- 시스템 프롬프트에 "최근 30일 레짐 히스토리" 섹션 추가
- 완료 기준: 주간 에이전트 dry-run 시 레짐 컨텍스트 포함 확인

### Step 6: recommendations 레짐 스냅샷 (구현팀 — backend)
- `saveRecommendations.ts`에서 저장 시 `loadLatestRegime()`으로 현재 레짐 조회 후 기록
- 완료 기준: 추천 저장 후 `market_regime` 컬럼 채워짐 확인

### Step 7: 테스트 작성 (구현팀 — backend)
- `round3-synthesis.test.ts`: `extractDebateOutput` 유효/무효 케이스
- `regimeStore.test.ts`: save/load/format 로직
- 완료 기준: 커버리지 80% 이상, Vitest 통과

## 리스크

**레짐 오판 리스크**: LLM이 토론 당일 데이터만 보고 레짐을 판정하기 때문에, 시장 전환점에서 오판 가능.
대응: Phase 1에서는 레짐 정보를 "참고 컨텍스트"로만 주입. 에이전트가 자율 판단하게 하고, 자동 행동 조정(추천 차단 등)은 Phase 2에서만.

**moderator 프롬프트 과부하**: 이미 긴 round3 프롬프트에 레짐 판정까지 추가하면 품질 저하 가능.
대응: 레짐 판정 섹션을 프롬프트 끝에 배치, 브리핑 품질에 영향 없도록 분리.

**데이터 희소성**: 초기 30일간은 레짐 히스토리가 부족. 빈 배열이면 프롬프트 주입 건너뜀.
대응: `formatRegimeForPrompt`는 빈 배열 시 빈 문자열 반환 (기존 패턴 동일).

**기존 theses 추출 회귀**: `extractThesesFromText` → `extractDebateOutput` 리팩터링 시 기존 로직 깨질 위험.
대응: 기존 함수는 내부 구현체로 보존, 새 함수는 래퍼로 구성. 테스트 먼저 작성.

## 의사결정 필요

없음 — 아래 사항은 자율 판단으로 결정 완료.

1. **레짐 분류 5단계 확정**: EARLY_BULL / MID_BULL / LATE_BULL / EARLY_BEAR / BEAR. RFC 원안 그대로.
2. **저장 위치**: `theses` 테이블이 아닌 별도 `market_regimes` 테이블. 레짐은 debate-level 속성이고 thesis-level이 아님. 조회/집계도 분리되어야 깔끔.
3. **태깅 주체**: moderator가 macro-economist의 round1 분석을 참조하여 최종 태그 출력. macro가 직접 별도 호출하면 토큰 비용 추가 발생 + 토론 흐름과 분리됨.
4. **Phase 1 행동 조정 방식**: 자동 차단 없음. 레짐 컨텍스트를 프롬프트에 주입하여 에이전트의 자율 판단을 유도. 자동 행동 조정은 Phase 2(정량 분류기) 도입 후 검증 기반으로 결정.
5. **일간 에이전트 주입**: Phase 1에서는 주간 에이전트에만 주입. 일간 에이전트는 레짐 변화가 거의 없는 단기 시점에서 동작하므로 필요시 Phase 2에서 추가.

# 투자 브리핑(토론 Round3) 품질 개선 — 펀더멘탈 연동 + 서사 근거 강화

## 선행 맥락

없음 — debate-round3-quality 관련 기록 없음.

단, 시스템 구조에서 확인된 사실:
- F7 펀더멘탈 시스템은 완성되어 있으나 토론 파이프라인과 완전히 분리되어 있음
- `run-debate-agent.ts`에서 `loadFundamentalData` / `scoreFundamentals` 를 한 번도 호출하지 않음
- Round 3 프롬프트(`buildSynthesisPrompt`)는 `marketDataContext`(RS/Phase 데이터)만 수신하고 펀더멘탈 스코어는 미수신
- `DebateConfig` 인터페이스에 펀더멘탈 데이터 필드 자체가 없음

## 골 정렬

**ALIGNED** — 직접 기여.

추천 종목의 펀더멘탈 필터(B등급 이상)와 테마 격상 기준 강화는 "남들보다 먼저 포착"의 신호 품질을 높이는 핵심 조치다. 트레이딩 시그널 혼입 차단은 프로젝트 골(구조적 초기 신호 포착, 매매 타이밍 아님)과 직접 정렬된다.

## 문제

토론 Round 3 브리핑이 5가지 품질 결함을 보임:
1. 추천 종목에 펀더멘탈 데이터가 없어 RS 모멘텀만으로 추천 → 분석 근거 부족
2. 단일 종목 언급으로도 테마/구조적 발견으로 격상 → 과잉 일반화
3. 목표가/진입가 등 트레이딩 시그널이 리포트에 혼입 → 프로젝트 골과 불일치
4. VIX 단기 수치를 즉각 심리 전환으로 해석 → 성급한 결론
5. N+1 병목 예측에 정량 근거 없음 → 서사 신뢰도 저하

## Before → After

**Before**: Round 3 프롬프트는 RS/Phase 시장 데이터만 받아 텍스트 브리핑 생성. 펀더멘탈 스코어 없음. 가드레일 일부 누락.

**After**: Round 3 프롬프트에 추천 종목 펀더멘탈 스코어(등급+EPS성장률) 주입. B등급 미만 추천 시 명시적 경고. 테마 격상 기준(3종목+), 트레이딩 시그널 금지, VIX 해석 가이드, 병목 예측 근거 의무화 가드레일 추가.

## 변경 사항

### Phase 1 — 펀더멘탈 데이터 주입 파이프라인 (핵심)

**`src/agent/run-debate-agent.ts`**
- `loadFundamentalData` import 추가
- `scoreFundamentals`, `promoteTopToS` import 추가
- Step 2에서 `marketSnapshot` 로드와 병렬로 Phase 2 종목 심볼 추출 후 펀더멘탈 데이터 로드
- 로드된 스코어를 `formatFundamentalContext(scores)` 로 포매팅 후 `DebateConfig`에 전달
- 에러 격리: 펀더멘탈 로드 실패 시 빈 문자열로 폴백, 토론 계속 진행

**`src/agent/debate/debateEngine.ts`**
- `DebateConfig`에 `fundamentalContext?: string` 필드 추가
- Round 3 호출 시 `fundamentalContext`를 `runRound3` input으로 전달

**`src/agent/debate/round3-synthesis.ts`**
- `Round3Input`에 `fundamentalContext?: string` 필드 추가
- `buildSynthesisPrompt`에 `fundamentalContext` 파라미터 추가
- 시장 데이터 섹션 다음에 펀더멘탈 섹션 삽입 (XML 태그 래핑)
- `runRound3` 함수 시그니처 업데이트

### Phase 2 — 프롬프트 가드레일 강화 (round3-synthesis.ts)

`buildSynthesisPrompt` 내 4가지 가드레일 추가:

1. **펀더멘탈 필터 가드레일**: 섹션 4(기회) 설명에 "B등급 미만 종목 추천 시 '펀더멘탈 미검증' 표기 필수" 지시 추가
2. **테마 격상 기준**: "단일 종목으로 구조적 발견 격상 금지 — 동일 섹터 3종목 이상 동반 확인 시에만 테마 서사 작성" 지시 추가
3. **트레이딩 시그널 금지 강화**: 기존 `※ 목표가/손절가 같은 트레이딩 시그널은 쓰지 마세요` 문구 강화 — "진입가, 매매 타이밍, 손절 수준 언급 시 해당 문장 전체 삭제"로 명확화
4. **VIX 해석 가이드**: 섹션 3(핵심 발견) 또는 섹션 6(이견)에 추가 — "VIX 단기 하락은 심리 전환으로 해석 금지. VIX 20 하회 + 3거래일 이상 지속 확인 후 언급 가능"
5. **N+1 병목 정량 근거 의무화**: 섹션 3 병목 설명에 "nextBottleneck 작성 시 정량 근거(CAPEX 규모, 리드타임 단축 수치, 재고 증가율 등) 1개 이상 필수. 근거 없으면 null" 지시 강화

### 포매터 신규 함수 (round3-synthesis.ts 또는 별도 util)

```typescript
// 펀더멘탈 스코어를 Round 3 프롬프트용 텍스트로 변환
function formatFundamentalContext(scores: FundamentalScore[]): string
```

출력 형식:
```
<fundamental-data>
## 추천 대상 종목 펀더멘탈 스코어 (SEPA 기준)

| 종목 | 등급 | EPS YoY | 매출 YoY | EPS 가속 | 마진 확대 |
|------|------|---------|---------|---------|---------|
| NVDA | A    | +145%   | +122%   | 예       | 예       |
| ...  |      |         |         |          |          |

※ 등급 기준: S(Top 3 of A) > A > B > C > F
※ B등급 미만 종목을 추천할 경우 "펀더멘탈 미검증" 표기 필수
</fundamental-data>
```

## 작업 계획

### Step 1: 펀더멘탈 데이터 로드 및 주입 (`run-debate-agent.ts`)
- **담당**: backend-engineer
- **작업**: Step 2 (시장 데이터 로드) 블록에서 Phase 2 종목 심볼 추출 후 `loadFundamentalData` 호출. 스코어링 후 `formatFundamentalContext` 호출. 결과를 `debateConfig.fundamentalContext`로 전달.
- **에러 격리**: try/catch — 실패 시 `logger.warn` 후 빈 문자열 폴백
- **완료 기준**: `run-debate-agent.ts` 실행 시 "Fundamental: X symbols scored" 로그 출력

### Step 2: DebateConfig + Round3Input 타입 확장 (`debateEngine.ts`, `round3-synthesis.ts`)
- **담당**: backend-engineer
- **작업**: `fundamentalContext?: string` 필드 두 인터페이스에 추가. `runDebate` → `runRound3` 전달 체인 연결.
- **완료 기준**: TypeScript 컴파일 에러 없음

### Step 3: `formatFundamentalContext` 포매터 구현 (`round3-synthesis.ts`)
- **담당**: backend-engineer
- **작업**: `FundamentalScore[]`를 받아 마크다운 테이블 + XML 래핑 반환. 데이터 없는 필드는 "—" 표기. 데이터 0건이면 빈 문자열 반환.
- **완료 기준**: 단위 테스트 통과 (Vitest)

### Step 4: `buildSynthesisPrompt` 가드레일 추가 (`round3-synthesis.ts`)
- **담당**: backend-engineer
- **작업**: 5개 가드레일 텍스트를 프롬프트 적절한 위치에 삽입. 펀더멘탈 섹션을 시장 데이터 섹션 다음에 추가.
- **완료 기준**: 프롬프트 문자열에 5개 가드레일 키워드 모두 포함 확인

### Step 5: 단위 테스트 작성
- **담당**: backend-engineer
- **작업**:
  - `formatFundamentalContext` — 정상 케이스, 빈 배열, 데이터 누락 케이스
  - `buildSynthesisPrompt` — fundamentalContext 있을 때/없을 때 분기 확인
- **완료 기준**: `yarn test` 통과, 기존 555 테스트 회귀 없음

## 설계: 펀더멘탈 주입 흐름

```
run-debate-agent.ts (Step 2)
  ├─ loadMarketSnapshot(debateDate)          [기존]
  └─ [신규] Phase 2 종목 심볼 추출
       ├─ newPhase2Stocks.map(s => s.symbol)
       └─ topPhase2Stocks.map(s => s.symbol)
       → dedup → loadFundamentalData(symbols)
       → scoreFundamentals 각 종목
       → promoteTopToS(scores)
       → formatFundamentalContext(scores)
       → fundamentalContext: string

runDebate(config: DebateConfig)
  → config.fundamentalContext 전달

runRound3(input: Round3Input)
  → buildSynthesisPrompt(..., fundamentalContext)

buildSynthesisPrompt()
  → <fundamental-data> 섹션 삽입
  → 5개 가드레일 텍스트 삽입
```

**심볼 범위**: `newPhase2Stocks`(최대 20개) + `topPhase2Stocks`(최대 15개) 합집합. 최대 35개 심볼 → `MAX_SYMBOLS_PER_QUERY(500)` 내 안전.

**데이터 없는 경우**: `quarters.length < 5` 종목은 F등급으로 표시. 테이블에 포함하되 "데이터 부족"으로 표기.

## 리스크

| 리스크 | 대응 |
|--------|------|
| 펀더멘탈 DB 쿼리 실패 | 에러 격리 — 빈 문자열 폴백, 토론 계속 |
| 프롬프트 길이 증가 (토큰) | MODERATOR_MAX_TOKENS 8192 이내. 테이블 최대 35행 × 1줄 ≈ 800자. 허용 범위. |
| 가드레일이 과도해 정상 추천도 차단 | 금지가 아닌 "표기 필수" 방식으로 완화 (hard block 아님) |
| Phase 2 종목 중 펀더멘탈 데이터 없는 종목 다수 | 표에 "데이터 부족" 표기로 LLM에게 맥락 제공 |

## 의사결정 필요

없음 — 바로 구현 가능

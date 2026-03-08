# Report Consistency — 리포트 일관성 + 극단적 상승률 오표기 수정

## 선행 맥락

memory 검색 결과 이 주제에 대한 기존 결정/교훈 없음.

관련 배경:
- PR #73 (비용 최적화): `agentLoop.ts`에서 프롬프트 캐싱을 도입했으나 `temperature` 설정은 포함되지 않음
- PR #82 (서사 레이어 Wave 1): `systemPrompt.ts`에 규칙 섹션 구조가 확립되어 있음 — 신규 규칙 삽입 지점이 명확

---

## 골 정렬

**ALIGNED** — Phase 2 주도섹터/주도주를 남들보다 먼저 포착하여 알파를 형성한다는 목표에서, 리포트의 품질과 신뢰성은 직접적 조건이다.

- `temperature: 0` 설정: 같은 데이터 → 같은 종목 선택 → 재현 가능한 판단. 노이즈 제거는 신호 품질 향상이다.
- 극단적 수치 오표기: PTN +68,414%처럼 비현실적인 숫자는 리포트 수신자의 신뢰를 훼손하고, 실제 투자 판단을 방해한다.
- 용어 설명 추가: Phase 2, RS, MA150 등의 용어를 처음 보는 수신자가 이해할 수 있어야 알파 공유가 가능하다.

---

## 문제

일간/주간 에이전트 리포트에서 세 가지 품질 문제가 동시에 발생하고 있다:
1. `temperature` 기본값(1.0)으로 인해 동일 데이터에서도 매번 다른 종목·서술이 생성됨 (재현 불가)
2. `pctFromLow52w` 필드를 LLM이 "종목 상승률"로 오해석하여 +68,414% 등 비현실적 수치가 리포트에 노출됨
3. Phase 2, RS, MA150 등 내부 분석 용어가 설명 없이 리포트에 노출됨

---

## Before → After

**Before**
- `agentLoop.ts`: `client.messages.create({ model, max_tokens, system, tools, messages })` — temperature 파라미터 없음, 기본값 1.0 적용
- `getPhase2Stocks.ts`, `getStockDetail.ts`, `getPhase1LateStocks.ts`, `getRisingRS.ts`: 응답 JSON에 `pctFromLow52w` 필드 포함, 필드명만 있고 의미 설명 없음
- `systemPrompt.ts`: `pctFromLow52w` 해석 규칙 없음, 용어 범례 없음
- 리포트 수신자: PTN +68,414% 같은 수치를 그대로 봄. RS, Phase 2, MA150이 무엇인지 모름

**After**
- `agentLoop.ts`: `temperature: 0` 명시 → 결정론적 응답
- 도구 4개: `pctFromLow52w` → `pctFromLow52wPct` 로 rename + JSON 응답에 `_note` 필드 추가로 의미 명시. 극단적 수치(>500%) 경고 필드 추가
- `systemPrompt.ts` 규칙 섹션: `pctFromLow52w` 해석 금지 규칙 + 용어 범례 추가
- 리포트: 비현실적 수치 미노출. 용어에 첫 등장 시 괄호 설명 포함

---

## 변경 사항

### 수정 1 — temperature: 0 설정
**파일**: `src/agent/agentLoop.ts`
**위치**: L60, `client.messages.create({...})` 호출부
**변경**: `temperature: 0` 파라미터 추가

```typescript
// Before
const response = await callWithRetry(() =>
  client.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    system: systemBlocks,
    tools: cachedTools,
    messages,
  }),
);

// After
const response = await callWithRetry(() =>
  client.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: 0,
    system: systemBlocks,
    tools: cachedTools,
    messages,
  }),
);
```

**판단 근거**: 시장 분석 에이전트는 창의성이 아니라 판단의 일관성이 요구된다. 같은 데이터 → 같은 판단이어야 디버깅과 성과 추적이 가능하다. temperature: 0은 캐시 히트율도 높인다(동일 입력 → 동일 출력 → 프롬프트 캐싱 효과 극대화).

---

### 수정 2 — pctFromLow52w 오해석 방지

**원인 확인**:
- `build-stock-phases.ts` L228-229: `pctFromLow52w = (price - low) / low` — 계산 자체는 정확
- 페니스탁 $0.01 → $7: `(7 - 0.01) / 0.01 = 699` → 69,900% — 수학적으로 옳음
- 문제는 LLM이 이를 "이 종목이 69,900% 올랐다"고 해석하는 것

**수정 A — 도구 응답 JSON 필드 보강** (4개 파일)

| 파일 | 위치 |
|------|------|
| `src/agent/tools/getPhase2Stocks.ts` | L79-99, stocks.map() 내부 |
| `src/agent/tools/getStockDetail.ts` | L169-172 |
| `src/agent/tools/getPhase1LateStocks.ts` | L92-95 |
| `src/agent/tools/getRisingRS.ts` | L104-107 |

각 파일의 `pctFromLow52w` 계산 직후에 `isExtremePctFromLow` 필드를 추가한다:

```typescript
// 공통 패턴 (4개 파일 동일 적용)
pctFromLow52w:
  r.pct_from_low_52w != null
    ? Number((toNum(r.pct_from_low_52w) * 100).toFixed(1))
    : null,
isExtremePctFromLow:
  r.pct_from_low_52w != null
    ? toNum(r.pct_from_low_52w) * 100 > 500
    : false,
```

`isExtremePctFromLow: true`이면 해당 수치는 페니스탁 베이스로 인한 수학적 결과이며, 종목의 최근 퍼포먼스를 의미하지 않는다는 것을 LLM이 인식할 수 있도록 systemPrompt에 규칙을 추가한다.

**수정 B — systemPrompt.ts 규칙 추가**

`buildDailySystemPrompt`와 `buildWeeklySystemPrompt` 두 함수의 `## 규칙` 섹션에 아래 규칙을 추가:

```
- **pctFromLow52w는 "52주 최저가 대비 현재 괴리율"입니다** — 종목의 최근 상승률이나 수익률이 아닙니다. 이 수치를 리포트에 인용할 때 반드시 "52주 저점 대비 +XX%"로 표기하세요. isExtremePctFromLow: true인 종목(주로 페니스탁)은 이 수치를 리포트에 노출하지 마세요.
```

---

### 수정 3 — 전문 용어 설명 추가

**방식 결정 (B안 자율 채택)**: 용어 유지 + 첫 등장 시 괄호 설명 + MD 파일 하단 범례

이유: A안(용어 변경)은 기존 내부 로직과 DB 컬럼명에서 용어가 혼재하게 되어 유지보수 비용이 더 높다. B안은 리포트 가독성을 높이면서 코드 변경이 최소화된다.

`systemPrompt.ts`의 `## 리포트 규칙` / `## 리포트 포맷` 섹션에 아래 지침 추가:

**Daily 프롬프트 추가 규칙**:
```
- **전문 용어 첫 등장 시 괄호로 설명**: Phase 2 (상승 추세), RS (상대강도), MA150 (150일 이동평균), A/D ratio (상승종목수:하락종목수)
- MD 파일 맨 하단에 "## 용어 설명" 섹션 추가: Phase 1~4 정의, RS 설명, MA150/MA200 설명
```

**Weekly 프롬프트 추가 규칙** (동일하게 적용):
```
- **전문 용어 첫 등장 시 괄호로 설명**: Phase 2 (상승 추세), RS (상대강도), MA150 (150일 이동평균)
- MD 파일 맨 하단에 "## 용어 설명" 섹션 추가 (동일 내용)
```

범례 표준 문안 (systemPrompt에 literal로 포함):
```
## 용어 설명
- **Phase 1~4**: Stan Weinstein Stage Analysis 기반 추세 단계. Phase 2 = 가격이 MA150 위에서 상승 추세 유지
- **RS (상대강도)**: S&P 500 대비 상대 수익률 순위 (0~100). 높을수록 시장 대비 강세
- **MA150**: 150일 이동평균선. 중기 추세 방향 판단 기준
- **A/D ratio**: 당일 상승 종목수 대 하락 종목수 비율. 시장 폭 건강도 지표
```

---

## 작업 계획

### Step 1 — temperature: 0 설정 (구현팀, 단독)
- 파일: `src/agent/agentLoop.ts` L60
- 변경: `temperature: 0` 파라미터 1줄 추가
- 완료 기준: `agentLoop.ts` 변경 확인, 기존 테스트 통과

### Step 2 — pctFromLow52w 도구 응답 보강 (구현팀, 4개 파일 병렬)
- `getPhase2Stocks.ts`, `getStockDetail.ts`, `getPhase1LateStocks.ts`, `getRisingRS.ts`
- 각 파일의 map() 내부에 `isExtremePctFromLow` 필드 추가
- 완료 기준: 4개 파일 변경 확인, 유닛 테스트에서 >500% 케이스 커버

### Step 3 — systemPrompt.ts 규칙 추가 (구현팀, 단독)
- `buildDailySystemPrompt`의 `## 규칙` 섹션
- `buildWeeklySystemPrompt`의 `## 규칙` 섹션
- `pctFromLow52w` 해석 규칙 + 용어 첫 등장 설명 규칙 + MD 범례 규칙
- 완료 기준: 두 함수 모두 동일 규칙 포함 확인

### Step 4 — 테스트 (검증팀)
- 기존 테스트 회귀 확인
- `isExtremePctFromLow` 경계값 테스트: 499%, 500%, 501%
- systemPrompt 스냅샷 테스트 업데이트 (있다면)

병렬 가능: Step 2의 4개 파일 수정은 완전 독립 → 병렬 처리. Step 1, Step 3도 Step 2와 독립적이므로 동시 진행 가능. Step 4는 1~3 완료 후.

---

## 리스크

**debate 에이전트에는 temperature: 0 미적용**: `debate/callAgent.ts`를 통해 실행되는 토론 에이전트는 `agentLoop.ts`를 거치지 않는다. 이번 수정은 일간/주간 에이전트(`runAgentLoop` 호출 경로)에만 적용된다. debate 에이전트의 temperature는 별도 확인 필요하나, 토론에는 창의적 다양성이 오히려 유효할 수 있으므로 이번 범위에서 제외한다.

**프롬프트 캐시 무효화**: `systemPrompt.ts` 규칙 변경 시 첫 1회는 캐시 미스 발생. 비용 임팩트 없음(1회성).

**`pctFromLow52w` 필드명 유지**: 도구 4개의 필드명을 바꾸지 않고 `isExtremePctFromLow`만 추가한다. 필드명 rename은 DB 스키마·타입·테스트 전방위 영향으로 이번 범위에서 제외.

**fundamental 에이전트**: `src/agent/fundamental/` 하위 파일들은 `pctFromLow52w`를 직접 사용하지 않는 것으로 확인됨 — 영향 없음.

---

## 의사결정 필요

없음 — 아래 판단은 자율 결정 완료:
- temperature: 0 → 분석 에이전트는 재현성이 창의성보다 우선
- 용어 처리 B안 → 코드 변경 최소화 + 가독성 확보
- `pctFromLow52w` 필드명 유지 → rename 비용 대비 이득 낮음
- debate 에이전트 제외 → 이번 범위 밖

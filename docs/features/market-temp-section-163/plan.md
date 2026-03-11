# 일간 리포트 시장 온도 고정 섹션 (#163)

## 선행 맥락

- **발송 게이트 도입 (PR #daily-briefing-send-gate)**: 5개 OR 조건 미충족 시 에이전트 루프 자체를 스킵. 현재 스킵 시 Discord 발송 없이 조용히 종료. 이 흐름이 이번 미션의 핵심 변경 대상.
- **#157 일간 리포트 5개 필수 섹션 구조화**: `reportValidator.ts`의 `DAILY_REQUIRED_SECTIONS`에 "시장 온도", "섹터 RS", "시장 흐름" 키워드로 MD 검증. 이번 미션에서 구조를 확장하지 않고 정합성만 유지.
- **marketDataLoader.ts**: 토론 에이전트가 이미 `loadMarketSnapshot` + `formatMarketSnapshot`으로 지수/브레드스/공포탐욕지수를 DB+API에서 일괄 수집. 일간 에이전트의 `getIndexReturns` + `getMarketBreadth` 도구와 동일한 데이터 소스를 사용하나, 별도 외부 API 호출을 직접 수행하는 구조. 재사용 가능.
- **간략 발송 미채택 결정 (send-gate plan.md)**: 이전 기획에서 "간략 발송도 알림이어서 노이즈" 이유로 의도적으로 미채택. 이번 미션은 이 결정을 번복한다. 단, 에이전트 루프를 실행하지 않고 정형화된 데이터만 발송하는 형태로 구현해 비용 최소화.

## 골 정렬

ALIGNED — 직접 기여.

시장 온도는 Phase 2 주도섹터/주도주 포착 판단의 기반 컨텍스트다. 인사이트 없는 날에도 시장 온도가 매일 일관되게 제공되어야 축적된 시계열이 형성되고, 그 위에서 Phase 전환 신호의 의미를 판독할 수 있다. 매일 오는 간략 온도 정보와 인사이트가 있는 날의 전체 리포트는 서로 다른 목적(컨텍스트 유지 vs 알파 신호)을 가지므로 노이즈가 아니다.

## 문제

발송 게이트 미통과 시 지수 등락, Phase 2 비율, A/D ratio, 공포탐욕지수 등 시장 온도 정보가 완전히 사라진다. 투자 판단의 기반 컨텍스트가 날짜 단위로 단절되어 시계열 파악이 어려워진다.

## Before → After

**Before**:
```
거래일 → [게이트 통과] 에이전트 루프 → 리뷰 파이프라인 → 전체 리포트 발송
          [게이트 미통과] 조용히 종료 — Discord 발송 없음
```

**After**:
```
거래일 → [게이트 통과] 에이전트 루프 → 리뷰 파이프라인 → 전체 리포트 발송
          [게이트 미통과] 시장 온도 데이터 수집 → 간소 리포트 발송 (LLM 없음, DB+API만)
```

전체 리포트의 메시지 상단에는 시장 온도 블록이 항상 포함되도록 프롬프트를 강화.

## 변경 사항

### 1. `src/agent/marketTempBlock.ts` 신규 — 시장 온도 포맷터

**역할**: DB + 외부 API에서 시장 온도 데이터를 수집하고, Discord 메시지용 텍스트 블록으로 포맷. LLM 없이 순수 데이터 조립.

**의존성**: `marketDataLoader.ts`의 `loadMarketSnapshot` 재사용.
- 이미 `fetchIndexQuotes` + `fetchFearGreed` + `loadMarketBreadth`가 구현됨.
- `formatMarketSnapshot`은 토론 에이전트용 포맷(마크다운 헤더, XML 래핑)이므로 재사용하지 않고, Discord 메시지용 포맷 함수를 별도 작성.

```typescript
// src/agent/marketTempBlock.ts

import { loadMarketSnapshot } from "./debate/marketDataLoader";
import type { MarketSnapshot } from "./debate/marketDataLoader";

/** Discord 메시지에 삽입할 시장 온도 블록을 생성한다. */
export async function buildMarketTempBlock(targetDate: string): Promise<string>

/** MarketSnapshot → Discord 포맷 텍스트 변환 (LLM 없음, 순수 데이터 포맷) */
export function formatMarketTempBlock(snapshot: MarketSnapshot): string
```

**출력 포맷 (간소 리포트용)**:
```
📊 시장 일일 브리핑 (YYYY-MM-DD)

📈 지수 등락
S&P 500: X,XXX (+X.XX%) | NASDAQ: XX,XXX (+X.XX%)
DOW: XX,XXX (+X.XX%) | Russell: X,XXX (+X.XX%)
VIX: XX.XX (+X.XX%)

😨 공포탐욕: XX (Fear) | 전일 XX | 1주전 XX

🌡️ 시장 온도 데이터
Phase 2: XX% (▲X.X%p) | 시장 평균 RS: XX.X
A/D: X,XXX:X,XXX (X.XX) | 신고가 XX / 신저가 XX

📭 오늘은 특별한 시장 신호 없음
```

**규칙**:
- 지수 데이터 조회 실패 시 해당 항목 생략 (블록 전체 실패 없음)
- 공포탐욕지수 조회 실패 시 행 생략
- `phase2RatioChange`의 부호에 따라 `▲`/`▼`/`-` 표시
- Phase 2 비율은 0~100 사이 값만 노출 (clampPercent 이미 적용된 값 사용)

### 2. `src/agent/run-daily-agent.ts` 수정 — 게이트 미통과 분기 처리

**현재 흐름** (line 103~113):
```typescript
if (process.env.SKIP_DAILY_GATE !== "true") {
  const gate = await evaluateDailySendGate(targetDate);
  if (!gate.shouldSend) {
    logger.step("[5/8] Send gate: SKIP — 발송 조건 미충족");
    logger.info("SendGate", "모든 조건 미충족 — 오늘은 인사이트 없음. 에이전트 스킵.");
    await pool.end();
    return;  // ← 여기를 교체
  }
  ...
}
```

**변경 후**:
```typescript
if (process.env.SKIP_DAILY_GATE !== "true") {
  const gate = await evaluateDailySendGate(targetDate);
  if (!gate.shouldSend) {
    logger.step("[5/8] Send gate: SKIP — 시장 온도 간소 발송");
    await sendMarketTempOnly(targetDate);  // 신규 함수
    await pool.end();
    return;
  }
  ...
}
```

**`sendMarketTempOnly` 함수** (run-daily-agent.ts 내 private 함수):
```typescript
async function sendMarketTempOnly(targetDate: string): Promise<void> {
  try {
    const block = await buildMarketTempBlock(targetDate);
    await sendDiscordMessage(block);
    logger.info("MarketTemp", "간소 리포트 발송 완료");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("MarketTemp", `간소 리포트 발송 실패 (에이전트는 정상 종료): ${reason}`);
    // 실패해도 throw하지 않음 — 간소 리포트 실패가 전체 흐름을 중단하면 안 됨
  }
}
```

**주의**: 간소 발송 실패는 `sendDiscordError`를 호출하지 않는다. 인사이트 없는 날의 간소 발송 실패는 치명적이지 않다. 로그만 남기고 종료.

### 3. `src/agent/systemPrompt.ts` 수정 — 리포트 상단 시장 온도 필수 지시 강화

**현재**: 시장 온도 정보가 메시지 포맷 예시에 포함되어 있으나, 에이전트 자율 판단에 의존.

**변경**: `buildDailySystemPrompt`의 `## 리포트 규칙` 섹션 첫 문단에 명시적 필수 지시 추가.

변경 위치: `## 리포트 규칙` 섹션 상단 (현재 line 114 부근).

추가할 내용:
```
### 시장 온도 블록 — 모든 리포트의 첫 번째 섹션 (필수)

인사이트 유무와 무관하게 **반드시** Discord 메시지 맨 위에 시장 온도 블록을 포함하세요.
시장 온도 블록은 생략 불가입니다. 특이종목이 없는 날에도 동일하게 포함합니다.

시장 온도 블록에 포함할 항목:
- 주요 지수(S&P 500, NASDAQ, DOW, Russell 2000, VIX) 일간 등락
- CNN 공포탐욕지수 (현재 / 전일 / 1주전)
- Phase 2 비율 + 전일 대비 변화 (▲/▼)
- 시장 평균 RS
- A/D ratio (상승:하락 종목수)
- 52주 신고가/신저가 종목수

조회 방법: `get_index_returns`와 `get_market_breadth`를 첫 번째 도구 호출에 반드시 포함하세요.
```

**정합성 확인**: 이 변경은 #157에서 도입한 `DAILY_REQUIRED_SECTIONS` 검증과 정합. "시장 온도" 키워드는 이미 validator에서 체크되므로 추가 validator 수정 불필요.

### 4. `src/agent/marketTempBlock.test.ts` 신규 — 단위 테스트

**테스트 대상**: `formatMarketTempBlock` 함수 (순수 함수 → 테스트 용이)

| 테스트 케이스 | 기대 결과 |
|---|---|
| 정상 snapshot — 모든 필드 존재 | 지수/공포탐욕/Phase2/A-D 포함 출력 |
| indices 빈 배열 | 지수 행 생략, 나머지 정상 출력 |
| fearGreed null | 공포탐욕 행 생략 |
| breadth null | Phase2/A-D 행 생략 |
| phase2RatioChange 양수 | "▲" 표시 |
| phase2RatioChange 음수 | "▼" 표시 |
| phase2RatioChange 0 | "-" 표시 |
| 모든 선택 필드 null | 헤더와 "특별한 시장 신호 없음" 행만 출력 |

**`buildMarketTempBlock` 통합 테스트**: DB/API 의존성 있으므로 단위 테스트 제외. `loadMarketSnapshot`은 `marketDataLoader.ts`에서 이미 테스트됨.

## 작업 계획

### Phase 1: marketTempBlock.ts 구현 + 테스트 (구현팀)
- **무엇을**: `src/agent/marketTempBlock.ts` 신규 작성 + `src/agent/marketTempBlock.test.ts` 신규 작성
- **완료 기준**: `formatMarketTempBlock` 단위 테스트 전체 통과. 커버리지 80% 이상.
- **주의**: `loadMarketSnapshot`은 `marketDataLoader.ts`에서 import. 중복 구현 금지.

### Phase 2: run-daily-agent.ts 수정 (구현팀)
- **무엇을**: 게이트 미통과 분기에서 `sendMarketTempOnly` 호출. 간소 발송 실패는 warn 로그만.
- **완료 기준**: 게이트 미통과 시 Discord에 간소 메시지 발송 + 정상 종료 확인.
- **주의**: `sendMarketTempOnly` 실패 시 throw 없이 warn 로그만. 에이전트 전체 exit code에 영향 없음.

### Phase 3: systemPrompt.ts 수정 (구현팀)
- **무엇을**: `buildDailySystemPrompt`의 `## 리포트 규칙` 첫 부분에 시장 온도 블록 필수 지시 삽입.
- **완료 기준**: 기존 메시지 포맷 예시와 충돌 없이 삽입. `DAILY_REQUIRED_SECTIONS` validator의 "시장 온도" 키워드 검증과 정합.
- **주의**: 프롬프트 길이 증가 최소화. 핵심 지시만. 예시는 기존 포맷 그대로 유지.

### Phase 4: 코드 리뷰 + 통합 확인 (검증팀)
- **무엇을**: 전체 변경분 code-reviewer 실행. CRITICAL/HIGH 이슈 수정.
- **완료 기준**: code-reviewer CRITICAL/HIGH 이슈 없음. 전체 테스트 통과. 커버리지 80% 이상 유지.

## 리스크

| 리스크 | 대응 |
|---|---|
| marketDataLoader의 fetchIndexQuotes가 Yahoo Finance API 불안정으로 실패 | 개별 지수 실패는 tolerate (기존 코드와 동일한 방어 로직). 전체 실패 시 "지수 데이터 수집 실패" 메시지로 대체 |
| 간소 리포트와 전체 리포트 포맷 불일치 (같은 날 양쪽 발송될 경우 없지만 디자인 혼란) | 간소 리포트는 "📭 오늘은 특별한 시장 신호 없음" 문구로 전체 리포트와 명확히 구분 |
| systemPrompt 변경으로 리포트 구조 변화 | 기존 메시지 포맷 예시를 수정하지 않고, 규칙 섹션에 지시만 추가. 포맷 예시는 이미 시장 온도 블록을 포함하고 있으므로 LLM 행동 변화 최소 |
| 간소 발송 실패 시 사용자 인지 불가 | warn 로그로 기록. 치명적이지 않으므로 의도적으로 에러 채널 발송 제외. 운영 중 패턴 확인 후 재검토 가능 |
| marketDataLoader가 debate 패키지에 위치해 일간 에이전트에서 import 시 의존성 혼란 | 이미 `src/lib/narrativeChainStats.ts`가 `src/agent/debate/` 내 모듈을 참조하는 패턴이 있음. 동일 패턴 허용. 향후 리팩터링 필요 시 별도 이슈로 분리 |

## 의사결정 필요

없음 — 바로 구현 가능.

**자율 판단 항목:**
- 간소 리포트 실패 시 `sendDiscordError` 미호출: 인사이트 없는 날의 보조 발송이므로 에러 채널 알림 불필요. 로그만으로 충분.
- `formatMarketTempBlock` 별도 함수 작성 (재사용 미검토): `formatMarketSnapshot`은 토론 에이전트용 XML 래핑 포맷이라 Discord 메시지에 부적합. 신규 포맷 함수가 단순하고 명확함.
- Phase 1~3 순차 실행: Phase 1(데이터 레이어)이 Phase 2(통합)의 선행 조건이므로 순차가 맞음.

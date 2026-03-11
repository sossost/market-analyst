# 일간 브리핑 조건부 발송 게이트

## 선행 맥락

- 토론 에이전트(`run-debate-agent.ts`)에 `checkAlertConditions()` 패턴이 이미 구현되어 있음. "매일 토론은 기억 축적이 목적 — 중요할 때만 알림" 철학이 주석에 명시. 이 패턴을 일간 에이전트에 동일하게 적용하는 것이 이번 미션.
- 일간 에이전트(`run-daily-agent.ts`)는 현재 거래일이면 무조건 `runReviewPipeline` → Discord 발송. 스킵 로직 없음.
- 레짐 분류기(`regimeStore.ts`)가 이미 EARLY_BULL ~ BEAR 5단계 레짐을 DB에 저장하고 있음. 레짐 데이터를 게이트 조건으로 사용 가능.
- `getLeadingSectors` 도구가 `groupPhase`, `prevGroupPhase`, `phase1to2Count5d` 필드를 반환. 섹터 전환 시그널 검출에 활용 가능.
- `getUnusualStocks` 도구가 `phase_change` 조건으로 특이종목을 이미 스크리닝. 게이트 입력 신호로 활용 가능.

## 골 정렬

ALIGNED — 직접 기여.

매일 브리핑을 발송하면 CEO가 인사이트 없는 날에도 알림을 받게 되어 "중요 신호"에 대한 민감도가 떨어진다. 조건부 발송은 노이즈를 제거해 진짜 Phase 2 전환 신호가 눈에 띄도록 만든다. 프로젝트 골(Phase 2 주도섹터/주도주를 남들보다 먼저 포착)에 직접 기여.

## 문제

일간 브리핑이 거래일마다 무조건 발송되어 인사이트 없는 날에도 알림이 발생한다. CEO의 주의를 매일 소모시켜 정작 중요한 신호가 눈에 묻힌다.

## Before → After

**Before**: 거래일 → 에이전트 실행 → 리뷰 파이프라인 → 무조건 Discord 발송

**After**: 거래일 → 에이전트 실행 → **게이트 평가** → [인사이트 있음] 전체 리포트 발송 / [인사이트 없음] 스킵(로그만) / [데이터 요약만] 간략 발송(선택)

## 변경 사항

### 1. 게이트 조건 정의 (`src/agent/dailySendGate.ts` 신규)

DB에서 당일 데이터를 직접 조회하여 발송 여부를 판정하는 순수 함수 모듈.

**발송 조건 (OR 결합 — 하나라도 충족 시 전체 리포트 발송)**

| 조건 | 설명 | 데이터 소스 |
|------|------|-------------|
| 섹터 전환 | `group_phase` 1→2 전환 섹터 1개 이상 (prevGroupPhase=1, groupPhase=2) | `sector_rs_daily` |
| RS 급상승 섹터 | `change_4w` 상위 3위 안에 새 섹터 진입 (전주 대비 newEntrant) | `sector_rs_daily` |
| 레짐 변화 | 최근 2일간 레짐이 변경됨 (EARLY_BULL → MID_BULL 등 어떤 방향이든) | `market_regimes` |
| 특이종목 급등 | Phase 1→2 전환 + 거래량 2배 이상 종목이 3개 이상 | `stock_phases` + `daily_prices` |
| Phase 1 후기 다수 | `phase1to2_count_5d` 상위 2개 섹터 합산 10개 이상 | `sector_rs_daily` |

**자율 판단 근거:**
- "섹터 RS 동반 상승이 가장 유의미한 필터" (PR #61 검증 결과). 섹터 전환을 핵심 조건으로 채택.
- 레짐 변화는 Phase 2 진입/이탈 방향 전환이므로 반드시 알려야 함.
- 특이종목 3개 이상은 시장 내 에너지 집중을 의미. 개별 종목 1~2개는 노이즈일 가능성 높음.
- 임계값 (3개, 10개 등)은 초기 보수적 기준 — 2주 운영 후 재조정 예정.

```typescript
// src/agent/dailySendGate.ts

export interface SendGateResult {
  shouldSend: boolean;
  reasons: string[]; // 발송 이유 목록 (스킵 시 빈 배열)
}

export async function evaluateDailySendGate(
  targetDate: string,
): Promise<SendGateResult>
```

### 2. `run-daily-agent.ts` 수정

에이전트 실행 전에 게이트를 평가한다. 게이트 미통과 시 에이전트 루프 자체를 실행하지 않는다 (비용 절감).

```
[기존 흐름]
환경변수 검증 → 거래일 확인 → theses 로드 → narrative chains 로드 → 에이전트 루프 → 리뷰 파이프라인 → 발송

[변경 흐름]
환경변수 검증 → 거래일 확인 → theses 로드 → narrative chains 로드
→ [NEW] 게이트 평가
  → 통과: 에이전트 루프 → 리뷰 파이프라인 → 발송
  → 미통과: 로그 기록 + 스킵 (에이전트 루프 실행 안 함)
```

**스킵 시 처리:**
- `logger.info` 로 미통과 사유 기록
- Discord 발송 없음 (조용히 종료)
- `pool.end()` 후 정상 종료 (exit code 0)

**의사결정 — "간략 발송" 옵션 채택 여부:**
이슈에서 "데이터 요약만 간략 발송" 옵션이 언급되었으나 이번 Phase에서는 **채택하지 않는다.** 이유:
- 간략 발송도 알림이다. 매일 오는 간략 알림은 결국 노이즈가 된다.
- 토론 에이전트도 미통과 시 DB 저장만 하고 조용히 종료. 같은 패턴 유지가 일관성 있다.
- 간략 발송이 필요하다고 판단되면 별도 이슈로 추가.

### 3. 테스트 (`src/agent/dailySendGate.test.ts` 신규)

| 테스트 케이스 | 기대 결과 |
|--------------|-----------|
| 섹터 1→2 전환 1개 존재 | shouldSend: true |
| 레짐 변화 감지 | shouldSend: true |
| 특이종목 3개 이상 Phase 전환 | shouldSend: true |
| 특이종목 2개 (임계값 미만) | shouldSend: false |
| 모든 조건 미충족 | shouldSend: false |
| DB 조회 실패 (에러) | shouldSend: true (안전 fallback — 발송하지 않는 것보다 발송이 안전) |
| 여러 조건 동시 충족 | reasons 배열에 모두 포함 |

## 작업 계획

### Phase 1: 게이트 모듈 구현 (구현팀)
- **무엇을**: `src/agent/dailySendGate.ts` 신규 작성
- **완료 기준**: 5개 조건 각각 DB 조회 로직 구현. 단위 테스트 통과.
- **주의**: DB 조회 실패는 `shouldSend: true` fallback (에러가 스킵을 만들면 안 됨)

### Phase 2: run-daily-agent.ts 통합 (구현팀)
- **무엇을**: 게이트 평가 단계 삽입. 스킵 시 조용한 종료 처리.
- **완료 기준**: 미통과 시 에이전트 루프 미실행 + 정상 종료 확인.
- **주의**: 스킵 시 Discord 메시지 발송 없음. 로그만.

### Phase 3: 통합 테스트 + 리뷰 (검증팀)
- **무엇을**: 전체 플로우 end-to-end 검증. `run-daily-agent.ts` 변경분 포함 코드 리뷰.
- **완료 기준**: 커버리지 80% 이상. code-reviewer CRITICAL/HIGH 이슈 없음.

## 리스크

| 리스크 | 대응 |
|--------|------|
| 게이트가 너무 엄격해 유의미한 날도 스킵 | DB 오류 시 shouldSend: true fallback + 임계값 2주 후 재조정 |
| 섹터 전환 데이터 없는 날 (ETL 미실행 등) | 조건별 데이터 null 체크, null이면 해당 조건 false (발송 않음은 아님) |
| 게이트 로직 자체 버그 → 영구 스킵 | 단위 테스트 + 로그 모니터링. 이상 감지 시 CLAUDE.md 규칙으로 수동 오버라이드 가능하게 환경변수(`SKIP_DAILY_GATE=true`) 추가 |

## 의사결정 필요

없음 — 바로 구현 가능.

(자율 판단 항목: 간략 발송 미채택, 임계값 초기값, 에러 시 shouldSend:true fallback — 모두 근거 명시 완료)

# Report Quality Fix (이슈 #150)

## 선행 맥락

**관련 이력:**
- **#107 / PR #114** (2026-03-07, merged): Phase 1 시스템 프롬프트에 Bull-Bias 가드레일 3개 규칙 추가. 프롬프트 레벨 억제로 설계됨. 현재 리포트에서 여전히 미작동 확인.
- **#110 / PR #113** (2026-03-07, merged): 데일리 리포트 날짜 버그 수정. 시스템 프롬프트에 `targetDate` 명시.
- **#109 / docs/features/report-reliability**: 수치 신뢰도 관련 스펙 존재. 원자재/거시 수치 환각 차단 규칙 포함.
- **#58 / PR #61**: 초입 포착 도구 유효성 검증. 섹터 RS 동반 상승이 핵심 필터임을 검증.
- **#63 / PR #63**: bull-bias 감지기(`biasDetector.ts`) 구현. bull-bias 80% 초과 시 경고 로그. QA 연동만 됨, 에이전트 실행 차단은 없음.

**메모리에서 확인된 교훈:**
- "도구를 만든 후 '작동하는지' 정량 검증하는 루프가 없으면 false positive가 방치된다." (chief-of-staff.md)
- #107 가드레일이 같은 LLM이 지키기로 되어 있어서 자기확증편향 문제가 있음. 구조적 강제가 없으면 반복된다.

## 골 정렬

**ALIGNED** — 직접 기여.

리포트는 Phase 2 주도섹터/주도주 포착의 최종 산출물이다. 리포트에 Phase 2 비율 3520%, 리스크 언급 전무, 섹터-종목 불일치가 존재하면 알파 형성의 인풋이 오염된다. 리포트 품질 보정은 골의 직접 달성을 위한 필수 조건이다.

## 문제

2026-03-09 주간 리포트에서 세 가지 품질 오류가 동시 발생했다.

1. **Phase 2 비율 3520%** — 도구 레이어에서 이중 변환 버그로 추정. 에이전트가 잘못된 수치를 받아 그대로 리포트에 출력.
2. **Bull-bias 100:0** — 추천 5건 전부 상승/긍정 키워드. #107에서 프롬프트 가드레일을 넣었으나 LLM 자기 통제 방식이라 구조적으로 불안정.
3. **섹터-종목 불일치** — 주도 섹터로 Energy/Basic Materials/Utilities를 명시했으나 추천 종목 5개 모두 Healthcare/Technology.

## Before → After

**Before:**
- `getLeadingSectors.ts`와 `marketDataLoader.ts`가 DB의 `phase2_ratio` (0~1 범위)를 * 100 변환 후 에이전트에 전달. 만약 DB에 이미 percent 단위(예: 35.2)가 저장되어 있으면 3520이 된다.
- 리스크 언급 규칙이 프롬프트 텍스트에만 존재. LLM이 지킬지 여부는 보장 불가.
- 섹터-종목 정합성 검증 로직 전무. 에이전트가 스스로 검증해야 하는데 실패해도 차단 없음.

**After:**
- `phase2_ratio` 변환 경로 단일화. DB 저장 단위(0~1)와 도구 출력 단위(0~100%)를 계약으로 명확히 정의. 이중 변환 제거.
- 리포트 전송 직전 후처리 검증 레이어: phase2_ratio 범위 guard + 섹터-종목 정합성 체크 + 리스크 키워드 존재 여부 체크. 위반 시 경고를 리포트 내에 강제 삽입.
- AVGO(RS 56, Phase 1) 류의 기준 미달 종목이 추천에 포함되면 자동으로 `[기준 미달]` 태그 추가.

## 변경 사항

### Phase 1: 즉시 수정 (데이터 버그 + 검증 레이어)

#### 1-A. Phase 2 ratio 이중 변환 버그 수정

**의심 경로 (코드 확인 완료):**
- `src/agent/tools/getLeadingSectors.ts` 47번째 줄: `toNum(s.phase2_ratio) * 100` — DB 값이 0~1이면 정상, 이미 percent면 이중 변환
- `src/agent/debate/marketDataLoader.ts` 103번째 줄: 동일 패턴
- `src/etl/jobs/validate-data.ts`: `MIN/MAX(phase2_ratio::numeric)` 조회로 실제 DB 값 범위 확인 가능

**수정 방향:**
- DB `phase2_ratio` 컬럼 실제 범위를 `validate-data.ts`로 확인.
- `group-rs.ts` 132번째 줄 SQL: `COUNT(*) FILTER (WHERE sp.phase = 2)::numeric / NULLIF(COUNT(*), 0)` — 결과는 0~1. 이것이 저장됨.
- 따라서 `getLeadingSectors.ts` 47번째 줄의 `* 100` 변환은 올바르다 (DB가 0~1이면).
- 그렇다면 3520%의 원인은 다른 데 있다. `save_report_log` 호출 시 에이전트가 `getLeadingSectors`에서 받은 값(35.2)을 marketSummary.phase2Ratio에 기록한 후, 다음 리포트 이력 참조 시 이를 다시 *100 하는 루프 가능성.
- `readReportHistory` 도구와 `reviewFeedback.ts` 체계도 확인 필요.
- **구체적 액션**: 코드 추적으로 3520%가 생성되는 정확한 경로를 `console.log` 또는 단위 테스트로 재현한 후 수정.

**validation guard 추가 (방어):**
- `getLeadingSectors.ts`에 결과 반환 전 assertion: `phase2Ratio > 100 → 로그 경고 + 100으로 clamp + 에러 메타데이터 추가`
- `getMarketBreadth.ts`도 동일 guard 적용

#### 1-B. 리스크 언급 필수화 — 후처리 검증

**파일 위치:** `src/agent/tools/sendDiscordReport.ts` 또는 신규 `src/agent/lib/reportValidator.ts`

**검증 항목:**
```typescript
interface ReportValidationResult {
  warnings: string[];
  errors: string[];
}

function validateReport(markdown: string, message: string): ReportValidationResult {
  const BEAR_KEYWORDS = ['리스크', '주의', '경고', '위험', '하락', '약세', '손절', '변동성'];
  const hasRiskMention = BEAR_KEYWORDS.some(kw => markdown.includes(kw) || message.includes(kw));

  if (!hasRiskMention) {
    // 리포트 내에 경고 섹션 강제 삽입 (차단이 아니라 주입)
    errors.push('⚠️ [자동 삽입] 리스크 언급 전무 감지 — 시장 리스크 및 종목별 약점을 별도 검토하세요.');
  }
}
```

- 차단이 아니라 **경고 삽입** 방식. 리포트 발송을 막지 않고, 누락된 섹션을 자동 추가.
- bull-bias 비율(긍정 키워드 수 / 전체 판단 키워드 수)을 계산해 80% 초과 시 경고 텍스트 삽입.

#### 1-C. 섹터-종목 정합성 자동 체크

**동일 `reportValidator.ts`에 추가:**
```typescript
function checkSectorConsistency(
  leadingSectors: string[],    // 리포트에서 주도 섹터로 명시된 섹터
  recommendedStocks: { symbol: string; sector: string }[]
): string[] {
  const warnings: string[] = [];
  const mismatchedStocks = recommendedStocks.filter(
    s => !leadingSectors.some(ls => ls.toLowerCase().includes(s.sector.toLowerCase()))
  );
  if (mismatchedStocks.length === recommendedStocks.length) {
    warnings.push(`⚠️ 섹터-종목 불일치: 주도 섹터(${leadingSectors.join(', ')})와 추천 종목 섹터가 전혀 겹치지 않습니다.`);
  }
  return warnings;
}
```

- 완전 불일치 시 경고. 부분 불일치는 허용 (선도 종목은 섹터 전환 직전에 먼저 움직일 수 있음).

#### 1-D. RS/Phase 기준 미달 종목 자동 태깅

- `save_recommendations`에 진입 전, `phase < 2 || rs_score < 60`인 종목에 `[기준 미달]` 태그를 `reason` 필드에 자동 prefix.
- 리포트 MD에는 해당 종목을 별도 섹션 "기준 미달 주시 종목"으로 이동 (추천 섹션에서 제외).

### Phase 2: 구조 개선 (중장기)

#### 2-A. 후처리 QA 에이전트 연동

- 현재 `biasDetector.ts`가 있으나 QA 리포트에만 연동됨.
- `reviewAgent.ts`에 `biasDetector` 결과를 실시간으로 반영하여, 발송 전 bias 수치가 80% 초과면 리포트 내에 경고 배너 삽입.
- `reviewAgent.ts` 현재 역할: 리포트 원고 검토 → 개선안 반환. 여기에 구조 검증 레이어 추가.

#### 2-B. Phase 2 ratio validation 자동화

- ETL 파이프라인에 `validate-data.ts` 실행을 추가하고, `phase2_ratio > 1` 또는 `< 0`인 레코드 감지 시 Slack/Discord 알림.
- 데이터 오류를 생성 시점에 잡는 것이 에이전트 수신 후 잡는 것보다 우선.

#### 2-C. 중복 종목 [재추천] 태그 시스템

- 이미 `readReportHistory` 도구로 이력 조회 가능하나, 에이전트가 자의적으로 판단함.
- `save_recommendations` 실행 시 최근 3주 이내 동일 symbol이 있으면 `is_repeat: true` 플래그를 자동 설정.
- 리포트 MD에 `[재추천]` 태그 자동 삽입.

## 작업 계획

### Phase 1 (이번 브랜치)

| 단계 | 무엇을 | 에이전트 | 완료 기준 |
|------|-------|---------|----------|
| P1-1 | Phase 2 ratio 버그 경로 재현 (단위 테스트) | 구현팀 | `getLeadingSectors` + `getMarketBreadth`에서 입력값별 출력 검증 테스트 통과 |
| P1-2 | Validation guard 추가 (getLeadingSectors, getMarketBreadth) | 구현팀 | `phase2Ratio > 100` 입력 시 clamp + 경고 로그 출력 테스트 |
| P1-3 | `reportValidator.ts` 신규 생성 (리스크/섹터/기준 미달 검증) | 구현팀 | 단위 테스트: 리스크 없는 리포트 → 경고 삽입, 섹터 완전 불일치 → 경고 삽입 |
| P1-4 | `sendDiscordReport.ts`에 reportValidator 연동 | 구현팀 | 통합 테스트: validator 경고가 실제 발송 payload에 포함 |
| P1-5 | RS/Phase 기준 미달 태깅 (`save_recommendations`) | 구현팀 | Phase 1 또는 RS < 60 종목 저장 시 reason에 `[기준 미달]` 자동 prefix |
| P1-6 | code-reviewer 실행 | code-reviewer | CRITICAL/HIGH 이슈 없음 |
| P1-7 | pr-manager에 PR 위임 | pr-manager | PR 생성 완료 |

**병렬 가능:** P1-1과 P1-3은 독립 작업이므로 병렬 실행.

### Phase 2 (다음 브랜치, 별도 이슈)

| 단계 | 무엇을 | 우선순위 |
|------|-------|---------|
| P2-1 | reviewAgent.ts + biasDetector 실시간 연동 | P1 (high) |
| P2-2 | ETL validate-data 자동 알림 | P2 (medium) |
| P2-3 | save_recommendations 중복 태깅 | P2 (medium) |

## 리스크

1. **3520% 버그의 정확한 경로 미확정**: 코드 분석으로는 DB `phase2_ratio`가 0~1 범위로 저장되고 도구에서 *100 변환하므로 정상처럼 보인다. 실제 3520%가 발생한 경로는 에이전트가 `save_report_log` 호출 시 전달한 값이 의심된다. `readReportHistory`로 이전 로그를 에이전트가 재참조하거나, 프롬프트 내에서 숫자를 혼용할 가능성도 있다. P1-1 단위 테스트로 재현 시도 후 경로 확정 필요.

2. **reportValidator 오탐**: "리스크 언급 필수화"를 키워드 기반으로 구현하면, 리스크를 충분히 설명했음에도 특정 키워드 없이 표현된 경우 오탐 발생. Phase 1에서는 보수적으로 (경고 삽입이지 차단 아님) 접근하여 오탐 피해 최소화.

3. **섹터-종목 불일치 판단 기준**: 선도 종목은 섹터 전환 직전에 먼저 움직일 수 있어서 "완전 불일치"만 경고하는 게 맞다. 부분 불일치(5개 중 2개 이상 주도 섹터 일치)는 경고 대상에서 제외.

4. **Phase 2 구조 개선은 `reviewAgent.ts` 변경을 수반**: 리뷰 에이전트는 현재 운영 중인 파이프라인 일부. 변경 시 회귀 테스트 필수.

## 의사결정 필요

없음 — 아래 사항은 매니저 판단으로 결정:

- **reportValidator 경고 방식**: "차단"이 아닌 "경고 삽입"으로 결정. 발송 차단은 운영 리스크가 크고, 경고 삽입은 리포트 수신자가 즉시 인지 가능.
- **Phase 2 구현 시점**: Phase 1 완료 후 운영 데이터 1~2주 관찰 후 진행. Phase 1이 효과적이면 Phase 2 우선순위 재평가.
- **이슈 분리**: Phase 2 작업은 #150과 별도 이슈로 분리. 이번 PR 스코프는 Phase 1만.

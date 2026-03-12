# Daily Report Quality Fix — 이슈 #197

## 선행 맥락

**관련 이력:**
- **#150 / PR #150**: Phase 2 비율 이중 변환(3520%) + 섹터-종목 불일치 + bull-bias 문제. `reportValidator.ts` 후처리 레이어 도입, 필수 섹션 키워드 검증 추가.
- **#157**: 일간 MD 파일 섹션 구조화. `DAILY_REQUIRED_SECTIONS` 검증 항목에 "시장 온도", "섹터 RS", "시장 흐름" 키워드 추가.
- **PR #114**: Bull-bias 가드레일 3개 규칙을 시스템 프롬프트에 삽입. 이번 이슈와 같이 LLM 자기 통제 방식이라 구조적 한계 존재.
- **PR #196**: 투자 브리핑(Round3) 품질 개선 — 펀더멘탈 연동 + 서사 근거 강화.

**교훈:**
- `checkDailySections`가 이미 "시장 온도", "섹터 RS", "시장 흐름" 키워드를 검증하고 있으나, 이번 이슈의 섹터 요약 및 시장 흐름 누락이 다시 발생했다는 것은 두 가지를 의미한다: (1) validator가 경고만 하고 에이전트가 재작성하지 않음, (2) 프롬프트 지시가 LLM에게 명확히 내면화되지 않음.
- Phase 분류 ↔ 서술 불일치는 `reportValidator.ts`에 검증 로직이 없다. 신규 추가가 필요하다.
- 전일 대비 신규성 부족은 프롬프트에 전혀 강제가 없다. 명시적 지시 필요.

## 골 정렬

**ALIGNED** — 직접 기여.

일간 리포트는 Phase 2 초입 주도주 포착 알파의 매일 산출물이다. 리포트가 Phase 분류와 서술이 모순되거나 구조가 누락되면 독자가 판단할 수 없고, 전일과 동일한 내용이면 변화를 감지하는 목적 자체가 소멸한다. 리포트 품질 보정은 골 달성의 직접 조건이다.

## 문제

2026-03-11 일간 리포트 자동 검증 점수 25/40 (기준 28 미달). 세 가지 동시 발생:

1. **Phase 분류 ↔ 서술 모순**: SLDB·CODA·DBVT가 Phase 2(상승 추세)로 분류됐으나 종목 서술은 약세 기조. 리포트를 읽는 사람은 이 종목을 사야 할지 피해야 할지 판단 불가.
2. **필수 섹션 누락**: "섹터별 요약" 및 "시장 흐름" 섹션 누락. 시장 요약이 3줄로 그침. `checkDailySections` validator가 있음에도 재발.
3. **신규성 부족**: 주도 섹터가 전일과 동일하나 이유 서술 없음. 전일 대비 변화 코멘트 없음.

## Before → After

**Before:**
- `DAILY_REQUIRED_SECTIONS`의 키워드 검증은 `warnings`로만 분류 — 에이전트가 이미 `send_discord_report`를 호출한 후에 validator가 돌기 때문에 실질적인 재작성 강제 없음.
- 시스템 프롬프트에 Phase 분류 ↔ 서술 일관성 자동 검증 지시 없음.
- 전일 대비 변화 단락 지시가 시스템 프롬프트에 없음 ("전일 대비 변화 포함"이 `get_market_breadth` 워크플로우 설명에는 있으나, 리포트 포맷 규칙에는 명시 없음).
- "섹터별 요약" 섹션이 MD 파일 필수 섹션 목록에 없음 (시장 온도, 섹터 RS, 시장 흐름만 있음).

**After:**
- 시스템 프롬프트에 Phase 분류 ↔ 서술 일관성 자체 검증 절차 추가 (bull-bias 가드레일과 같은 방식).
- 시스템 프롬프트 리포트 포맷 규칙에 "전일 대비 변화 단락 필수" 명시. 주도 섹터가 전일과 동일하면 이유를 서술.
- `DAILY_REQUIRED_SECTIONS`에 "섹터별 요약" 키워드 추가.
- `checkDailySections`에서 섹션 누락이 `warnings`가 아닌 `errors`로 분류되도록 강도 상향. 에러 발생 시 `runReviewPipeline`이 REVISE로 처리.
- 검증 프롬프트(`validate-daily-report-prompt.md`)에 Phase 분류 ↔ 서술 일관성 항목 추가 (팩트 일관성 항목 강화).

## 변경 사항

### 1. 시스템 프롬프트 강화 — `src/agent/systemPrompt.ts`

**1-A. Phase 분류 ↔ 서술 일관성 자체 검증 절차 추가** (Bull-Bias 가드레일 섹션 내)

아래를 `## Bull-Bias 가드레일` 섹션에 추가:
```
- **Phase 분류 ↔ 서술 일관성 검증 절차**: 리포트 작성 완료 후, 종목을 Phase 2(상승 추세)로 분류했으면 서술도 상승 추세 관점이어야 합니다. Phase 2 분류 종목을 "약세", "하락세", "부진" 등으로 서술하거나, Phase 1/3/4 종목을 매수 후보로 프레이밍하면 ⚠️ 분류-서술 모순 경고를 해당 종목 옆에 삽입하세요. 의도적으로 경고 목적으로 언급하는 경우에는 "Phase 2이나 모멘텀 둔화 감지 — 관망"처럼 단서를 명시하세요.
```

**1-B. 전일 대비 변화 단락 필수화** (리포트 규칙 섹션 내, MD 파일 필수 섹션 목록)

기존 5개 필수 섹션에 6번 추가:
```
6. **전일 대비 변화 요약** — 주도 섹터, Phase 2 비율, 특이종목이 전일과 동일하면 이유를 서술. 변화가 있으면 무엇이 어떻게 바뀌었는지 명시. 전일 데이터가 없으면 "전일 데이터 없음"으로 표기.
```

**1-C. 섹터 요약 섹션 지시 강화**

MD 파일 섹터 RS 랭킹 표 항목에 "섹터별 요약" 명시:
```
2. **섹터 RS 랭킹 표 + 섹터별 요약** — 섹터별 RS 점수와 순위 변동. Group Phase 2 여부 표시. 전일 대비 순위 변동이 큰 섹터(±3 이상)는 별도 한 줄 코멘트 추가.
```

### 2. reportValidator 강화 — `src/agent/lib/reportValidator.ts`

**2-A. `DAILY_REQUIRED_SECTIONS`에 섹터 요약 추가**
```typescript
const DAILY_REQUIRED_SECTIONS = [
  { keyword: "시장 온도", label: "시장 온도 근거" },
  { keyword: "섹터 RS", label: "섹터 RS 랭킹 표" },
  { keyword: "시장 흐름", label: "시장 흐름 및 종합 전망" },
  { keyword: "섹터별 요약", label: "섹터별 요약" },     // 추가
] as const;
```

**2-B. `checkDailySections`를 warnings → errors로 상향**

현재: `warnings.push(...)`
변경: `errors.push(...)` — errors는 `isValid: false`로 이어지며, 리뷰 파이프라인에서 REVISE 처리 트리거.

단, "섹터별 요약" 항목은 warnings 유지 (점진적 강화. 전체를 한 번에 errors로 올리면 기존 통과 리포트가 block될 수 있음).

> 판단 근거: `checkPhase2RatioRange`는 이미 errors로 분류. 필수 구조 누락도 같은 수준의 품질 오류이므로 errors로 처리가 맞다. 단, "섹터별 요약"은 신규 항목이므로 warnings로 시작해 누락 빈도 확인 후 2주 내 errors로 전환 예정.

**2-C. Phase 분류 ↔ 서술 불일치 감지 추가** (신규 함수)

LLM이 생성한 자유 텍스트에서 Phase 분류와 약세 서술이 동시에 등장하는 패턴을 감지.

```typescript
const PHASE2_BEARISH_PATTERN = /Phase\s*2[^\n]*?(약세|하락세|부진|급락|손절)/gi;

function checkPhaseDescriptionConsistency(
  markdown: string,
  warnings: string[],
): void {
  const pattern = /Phase\s*2[^\n]*?(약세|하락세|부진|급락|손절)/gi;
  let match: RegExpExecArray | null;
  const conflicts: string[] = [];

  while ((match = pattern.exec(markdown)) !== null) {
    conflicts.push(match[0].slice(0, 80));
  }

  if (conflicts.length > 0) {
    warnings.push(
      `Phase 2 분류 ↔ 약세 서술 모순 감지 (${conflicts.length}건). 서술 또는 Phase 분류를 수정하세요: ${conflicts.join(" | ")}`,
    );
  }
}
```

이 함수는 `validateReport`의 섹션 E 다음에 호출 (reportType === "daily" 시에만).

### 3. 검증 프롬프트 강화 — `scripts/validate-daily-report-prompt.md`

**팩트 일관성** 항목 기준 구체화:
```
### 1. 팩트 일관성 (0~10점)
- 데이터 수치와 서술이 일치하는가?
- **Phase 분류 ↔ 서술 일관성**: Phase 2(상승 추세) 종목을 약세/하락세로 서술하거나, Phase 1/3/4 종목을 매수 후보로 프레이밍하면 3점 이상 감점
- 예: "섹터 RS 상승" 서술인데 실제 RS 수치가 하락인 경우 → 감점
- 판단 근거를 1~2줄로 명시
```

**이전 대비 변화** 항목 기준 구체화:
```
### 4. 이전 대비 변화 (0~10점)
- 직전 리포트 대비 복붙 수준으로 동일한 문장이 반복되는가?
- 새로운 인사이트가 포함되었는가?
- **주도 섹터가 전일과 동일하면**: 동일한 이유가 서술되어 있는가? 이유 없이 동일 섹터 반복이면 2점 감점
- 직전 리포트 없으면 이 항목은 null로 표시
- 판단 근거를 1~2줄로 명시
```

### 4. 테스트 추가 — `src/agent/lib/__tests__/reportValidator.test.ts`

- Phase 2 + 약세 서술 동시 등장 시 warnings 감지 테스트
- `checkDailySections` errors 상향 후 `isValid: false` 반환 테스트
- "섹터별 요약" 키워드 누락 시 warnings 포함 테스트

## 작업 계획

| 단계 | 내용 | 에이전트 | 완료 기준 |
|------|------|---------|----------|
| 1 | `systemPrompt.ts` — Phase 분류 ↔ 서술 일관성 검증 절차 + 전일 대비 변화 단락 + 섹터별 요약 지시 추가 | 실행팀 | 프롬프트 빌드 결과 diff 확인 |
| 2 | `reportValidator.ts` — `DAILY_REQUIRED_SECTIONS` 확장 + `checkDailySections` errors 상향 + `checkPhaseDescriptionConsistency` 추가 | 실행팀 | 테스트 통과 |
| 3 | `validate-daily-report-prompt.md` — 팩트 일관성 + 이전 대비 변화 항목 기준 구체화 | 실행팀 | diff 확인 |
| 4 | 테스트 추가 + 전체 테스트 스위트 통과 확인 | 실행팀 | `yarn test` green |

단계 1·2·3은 독립적이므로 병렬 실행 가능.

## 리스크

- `checkDailySections`를 errors로 상향하면, 에이전트가 특이종목이 없는 날(메시지만 전송, MD 파일 없음)에 markdownContent가 `""` 또는 `undefined`인 경우 false positive가 발생할 수 있음. **해결**: `markdown` 인수가 비어있거나 짧으면(예: 500자 미만) `checkDailySections` 자체를 스킵.
- `checkPhaseDescriptionConsistency` 정규식은 같은 줄에 Phase 2와 약세 키워드가 있을 때만 감지. 리포트가 멀티라인이면 일부 모순이 누락될 수 있음. 허용 — 완전 감지보다 false positive 최소화 우선.
- 시스템 프롬프트 지시 추가로 token 비용 소폭 증가 (약 200~300 token 추가). 무시 가능 수준.

## 의사결정 필요

없음 — 바로 구현 가능.

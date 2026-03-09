# Report Reliability — 버그/개선 사이클

## 선행 맥락

- PR #63: 편향 감지 시스템 구축 완료. `biasDetector.ts` 존재.
- PR #62: QA 에이전트 정상화. 리포트 품질 기준 확립.
- `memoryLoader.ts` 주석(line 41): "principle 필드에 이미 [경계] 접두사 포함"이라고 명시돼 있으나, 테스트 mock에는 해당 접두사 없이 데이터 설정. 구조적 불일치.
- `agentLoop.ts` line 25: `targetDate`를 LLM에 명시적으로 전달함. 그러나 systemPrompt에 날짜를 명시하는 지시 없음 — LLM이 날짜 판단을 자율적으로 수행.

## 골 정렬

ALIGNED — 세 건 모두 리포트 신뢰성 직접 개선. 날짜 오류와 bull-bias 필터는 데이터 품질을 훼손하고 투자 판단을 오염시킴. `[경계]` 태그 누락은 caution 학습의 전달 실패로 재귀 개선 신뢰성을 저해함.

## 문제

3건의 독립적 버그/개선이 하나의 공통 주제(리포트 신뢰성)로 묶임:
1. **#110**: 데일리 리포트 날짜가 2024-03-06으로 잘못 표시됨. LLM이 `targetDate`를 무시하고 자체 판단으로 날짜를 씀.
2. **#106**: `memoryLoader.ts`의 caution 카테고리가 `[경계]` 태그를 출력하지 않음. 테스트 mock과 구현 사이 계약 불일치.
3. **#107**: 데일리 리포트에 bull-bias 필터 부재. 지정학 위기/VIX 25+, 극단적 급등주, 내부 모순에 대한 명시적 가이드 없음.

## Before → After

### #110 날짜 오류
- **Before**: LLM이 리포트 제목에 `2024-03-06`을 씀 (자체 추정 날짜)
- **After**: `targetDate`를 systemPrompt에도 명시 삽입 → LLM이 반드시 해당 날짜를 사용

### #106 [경계] 태그 누락
- **Before**: `memoryLoader.ts`는 `principle` 필드 원문을 그대로 출력. 테스트 mock에는 `[경계]` 없음 → 테스트 2건 실패
- **After**: memoryLoader가 caution 항목에 직접 `[경계]` 접두사를 붙이도록 변경. principle 저장 형식에 무관하게 안정적 출력 보장. 테스트 mock도 실제 DB 패턴(buildCautionPrinciple 출력)과 일치하도록 수정.

### #107 bull-bias 필터
- **Before**: systemPrompt에 리포트 규칙만 있고, 공포 국면 / 극단적 급등 / 내부 모순에 대한 지시 없음
- **After**: `buildDailySystemPrompt` 규칙 섹션에 조건부 보수 판단 지시 3개 추가

## 변경 사항

### 파일 1: `src/agent/systemPrompt.ts`

**#110 수정 (`buildDailySystemPrompt`)**:
- `options`에 `targetDate?: string` 파라미터 추가
- base 프롬프트 상단에 `오늘 날짜: ${targetDate}` 줄 추가 (LLM의 첫 문단에서 덮어쓰기 방지)
- `run-daily-agent.ts`에서 `targetDate`를 `buildDailySystemPrompt`에 전달

**#107 수정 (규칙 섹션 추가)**:
규칙 섹션에 다음 3개 조건부 지시 추가:
```
- **지정학 위기 또는 VIX 25+ 상황**: "공포 = 저가매수 기회"로 프레이밍하지 마세요. 리스크를 먼저 명시하고, 매수 판단은 데이터 확인 후 조건부로만 허용합니다.
- **20일 기준 +200% 이상 급등주**: "스마트머니 유입" 또는 "선도주" 프레이밍 금지. 단순히 "급등 주의, 거래량·카탈리스트 확인 필수"로 처리하세요.
- **내부 모순 자체 검증**: 리포트 작성 후, "시장 온도 = 약세"인데 강력 매수를 추천하거나, "VIX 급등"인데 공포 없음 표시처럼 결론이 데이터와 충돌하는 경우 리포트를 스스로 재검토하세요.
```

### 파일 2: `src/agent/debate/memoryLoader.ts`

**#106 수정 (`loadLearnings` 내 caution 루프)**:
- 현재: `lines.push(`- ${r.principle}${rate}`)` — principle 원문 그대로
- 변경: `[경계]`로 시작하지 않으면 접두사 자동 추가
```typescript
const prefix = r.principle.startsWith("[경계]") ? "" : "[경계] ";
lines.push(`- ${prefix}${r.principle}${rate}`);
```

### 파일 3: `__tests__/agent/debate/memoryLoader.test.ts`

**#106 테스트 수정**:
- `it("includes caution learnings in 경계 패턴 section")` — mockData principle에 `[경계]` 없어도 출력에 `[경계]`가 있는지 검증하는 테스트는 유지 (구현 수정으로 통과 예정)
- `it("shows caution learnings without rate when hitRate is null")` — mockData에 `[경계]` 없는 원문으로 설정했을 때 출력에 `[경계]`가 붙는지 검증 → 이미 테스트 기대값이 맞음, 구현 수정으로 통과
- 두 테스트 모두 mockData 수정 불필요 — memoryLoader 구현만 수정하면 통과

## 작업 계획

| 순서 | 작업 | 에이전트 | 완료 기준 |
|------|------|----------|-----------|
| 1 | `memoryLoader.ts` caution 루프 수정 (#106) | 구현팀 | 테스트 2건 통과 |
| 2 | `systemPrompt.ts` targetDate 주입 + bull-bias 규칙 추가 (#110, #107) | 구현팀 | 코드 리뷰 통과, 날짜 주입 단위 테스트 |
| 3 | `run-daily-agent.ts` — targetDate를 buildDailySystemPrompt에 전달 (#110) | 구현팀 | 기존 테스트 통과 |
| 4 | 전체 테스트 수행 | 검증팀 | `npm test` 100% 통과 |

작업 1~3은 서로 독립적이므로 병렬 가능.

## 리스크

- **#110 근본 원인 불확실성**: `targetDate`가 user message에 이미 포함됨에도 LLM이 2024를 쓴 이유가 시스템 프롬프트 캐시 히트 시 초기 메시지를 덜 주의하는 현상일 수 있음. systemPrompt에 날짜를 삽입하면 캐시 무효화가 발생하므로, 날짜 주입 위치를 신중히 선택해야 함 (프롬프트 끝부분에 추가하는 방식으로 캐시 영향 최소화).
- **#107 LLM 자율성 제한**: 규칙을 너무 강하게 지정하면 데이터 기반 판단이 규칙에 가로막힐 수 있음. "금지"가 아닌 "절차 강제" 형태로 작성.
- **#106 principle 중복 접두사**: DB에 이미 `[경계]`가 저장된 경우 중복 방지 로직(`startsWith("[경계]")` 체크) 필수. 코드에 이미 반영된 설계.

## 의사결정 필요

없음 — 바로 구현 가능.

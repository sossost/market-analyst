# QA 에이전트 종합 고도화

## 선행 맥락

- `docs/features/daily-report-qa/` — validate-daily-report.sh + validate-daily-report-prompt.md 최초 구축 이력
- `docs/features/debate-report-validation/` — validate-debate-report.sh 신규 구축 이력
- `docs/features/report-quality-gate/` — Claude QA 점수 기반 이슈 생성 체계 구축 이력
- `docs/features/report-quality-guard/` — factConsistency/bullBias/structure 4개 항목 채점 확립

기존 QA 스택은 이미 두 레이어로 분리 운영 중:
1. **사후 Claude QA** (validate-daily-report.sh / validate-debate-report.sh) — 발송 후 품질 점수화 + 이슈 생성
2. **사전 데이터 정합성 QA** (dailyQA.ts / debateQA.ts) — 발송 전 DB 수치와 리포트 대조 + 경고 삽입

이번 고도화는 이 두 레이어를 모두 강화한다.

## 골 정렬

ALIGNED — Phase 2 주도주/주도섹터 조기 포착 정확도와 직결된다. 팩트 에러 섹터 오분류, bull-bias 과잉, 데이터 누락은 분석 신뢰성을 훼손하여 알파 형성을 방해한다. QA 체계 강화는 분석 품질 보장을 통해 골에 직접 기여한다.

## 문제

현재 QA 체계는 이슈 생성 기준이 느슨하고(6점 미만 OR 총점 ≤28), 팩트 에러 유형별 심각도 구분이 없으며, dailyQA/debateQA의 데이터 정합성 오류가 이슈로 승격되지 않는다. 결과적으로 경미한 오류는 경고 메시지로만 끝나고 추적이 안 된다.

## Before → After

**Before**
- 이슈 생성 기준: 6점 미만 OR 총점 ≤28 (단일 기준)
- 팩트 에러 severity: 구분 없이 모두 warn
- dailyQA/debateQA warn 이상: Discord 경고 문구 삽입만, 이슈 생성 없음
- 토론 리포트 Claude 사후 검증: validate-debate-report.sh 이미 운영 중 (이슈 미확인 사항)
- 교차 리포트 정합성: 없음
- 당일 급락 종목 필터: 없음
- 구조화 데이터 저장 전 검증: 없음

**After**
- 이슈 생성 기준: 총점 ≤32 OR factConsistency < 7 OR 기타 항목 < 5 (강화)
- 팩트 에러 severity: 유형별 차등 (섹터 오분류 max 6, 데이터 누락 max 7, 수치 오류 max 5)
- dailyQA/debateQA severity warn 이상: 자동 이슈 생성
- 교차 리포트: 일간+토론 reported_symbols 불일치 감지
- 당일 급락 종목: -5% + 거래량 1.5x 시 별도 경고 카테고리
- 구조화 데이터 저장 전 빈 배열/0값 차단

## 변경 사항

### Phase 1 — 기존 시스템 보강

**1-1. 이슈 생성 기준 강화 (validate-daily-report-prompt.md)**
- 현재: `어느 하나라도 6점 미만이거나 totalScore ≤ 28`
- 변경: `총점 ≤32 OR factConsistency < 7 OR 기타 항목 < 5`
- 동일 패턴으로 validate-debate-report-prompt.md도 적용 (thesisBasis 기준 정렬)

**1-2. 팩트 에러 severity 세분화 (src/agent/lib/factChecker.ts)**
- 현재: 모든 mismatch가 severity `warn` 단일값
- 변경: `MismatchType`별 severity 매핑 함수 추가
  - `sector_list` (섹터 오분류): severity `block` (max penalty 6)
  - `phase2_ratio` (데이터 누락/수치 오류): 차이 10pp 이상이면 `block`, 미만이면 `warn`
  - `symbol_phase` (수치 오류): severity `warn` 유지
  - `symbol_rs` (수치 오류): severity `warn` 유지
- `aggregateSeverity` 함수는 `block` 타입 mismatch 존재 여부 기준으로 재정의

**1-3. dailyQA/debateQA 이슈 생성 연결**
- **신규 파일**: `src/agent/lib/qaIssueReporter.ts`
  - `reportQAIssue(result: DailyQAResult | DebateQAResult, reportDate: string, qaType: 'daily' | 'debate'): Promise<void>`
  - severity `warn` 이상이면 `gh issue create` 실행 (쉘 스크립트와 동일한 패턴)
  - 라벨: `report-feedback` + `P2: medium` (block이면 `P1: high`)
  - 이슈 본문: mismatch 목록 + 날짜 + QA 타입
- **수정**: `src/agent/run-daily-agent.ts` — DailyQA warn/block 후 `reportQAIssue` 호출
- **수정**: `src/agent/run-debate-agent.ts` — DebateQA warn/block 후 `reportQAIssue` 호출
- 이슈 생성 실패는 비블로킹 (try-catch로 격리)

### Phase 2 — 토론 리포트 Claude 감사 신설

**현황 파악**: validate-debate-report.sh가 이미 존재하고 운영 중이다. 프롬프트는 `scripts/validate-debate-report-prompt.md`에 5개 항목(thesisBasis/bullBias/analystDiversity/structure/novelty)으로 구성되어 있다. 이슈 #362의 Phase 2 요구사항인 "40점 채점: factConsistency/coherence/eventAwareness/structuredData 각 10점"은 현재 운영 중인 5항목 채점과 구조가 다르다.

**실현 가능성 판단**: 현재 프롬프트를 완전히 교체하면 기존 QA 이력과 비교 불가해진다. 총점 체계를 변경하면 기존 이력 비교 단절 + 기존 4항목 가중치 희석. eventAwareness는 총점 체계 밖에서 별도 플래그(warn)로 처리한다.

**2-1. validate-debate-report-prompt.md 항목 추가**
- 기존 4개 항목(thesisBasis/bullBias/analystDiversity/structure) 유지, **총점 40점 유지**
- `eventAwareness`는 총점에 포함하지 않음 — 당일 시장 이벤트 미인식 시 별도 경고 플래그(`eventAwarenessWarning`) 출력
- 이슈 기준: `totalScore ≤ 32` OR `thesisBasis < 7` OR 기타 항목 < 5 (기존 40점 기준)

**2-2. 시장 이벤트 캘린더 (data/market-events.json)**
- 신규 파일: `data/market-events.json`
- 구조: `{ "events": [{ "date": "YYYY-MM-DD", "type": "FOMC|CPI|NFP|...", "description": "..." }] }`
- 초기 데이터: 향후 90일 주요 이벤트 수동 입력 (FOMC, CPI, NFP, PCE)
- validate-debate-report.sh에서 당일 이벤트를 프롬프트에 주입

### Phase 3 — 교차 리포트 정합성

**3-1. 교차 검증 레이어 (src/agent/lib/crossReportValidator.ts)**
- 신규 파일
- `validateCrossReport(dailyDate: string, debateDate: string): Promise<CrossValidationResult>`
- 로직: DB에서 `daily_reports` 당일 `reported_symbols`와 `debate_sessions`의 `theses`(beneficiaryTickers) 조회, 일간 리포트 종목이 토론 thesis에 없으면 warn
- 반환: `{ mismatch: boolean, dailyOnly: string[], debateOnly: string[], severity: 'ok'|'warn' }`
- 이 검증은 **블로킹이 아님** — 모순 시 Discord 경고만 (발송 차단하지 않음)
  - 이유: 일간 에이전트는 당일 데이터 기반, 토론은 전날 실행 → 구조적 지연 존재. 차단보다 모니터링이 적합.

**3-2. 당일 가격 게이트 (src/agent/lib/priceDeclineFilter.ts)**
- 신규 파일
- `filterDeclinedSymbols(symbols: string[], date: string): Promise<DeclinedSymbol[]>`
- 로직: `daily_prices`에서 당일 `-5% 이하 + volume ratio >= 1.5` 종목 추출
- 반환: `{ symbol: string, pctChange: number, volRatio: number }[]`
- 호출 위치: `run-daily-agent.ts`에서 QA 단계에 추가. 결과를 Discord 경고 카테고리로 삽입
- **블로킹 아님** — 발송은 계속되고 경고 섹션만 추가

**Phase 3 의존성**: Phase 2 완료 필요 없음. Phase 1과 독립적으로 병렬 개발 가능. 단, crossReportValidator는 debate_sessions 테이블 구조 확인이 필요 (스키마 이미 파악됨).

### Phase 4 — 구조화 데이터 완전성 게이트

**4-1. 토론 리포트 저장 전 검증 (src/agent/debate/debateEngine.ts)**
- `runDebate()` 반환 직전, `result.round3.theses` 검증 추가
- 검증 조건: `theses.length === 0` 또는 모든 thesis의 `beneficiaryTickers`가 빈 배열이면 `logger.warn` + Discord 경고 (저장은 계속)
- **저장 차단은 하지 않음** — thesis 0건은 정상 케이스(시장 신호 없음)일 수 있으므로 차단 아닌 경고
- 구현 위치: `run-debate-agent.ts` Step 6 저장 후, Step 7 발송 전

**4-2. 일간 리포트 저장 전 검증 (src/agent/reportLog.ts 또는 saveReportLog tool)**
- `saveReportLog` 실행 시 `reportedSymbols.length === 0`이면 logger.warn
- 본문(fullContent) 내 종목 언급 체크: fullContent에 reportedSymbols의 symbol이 하나도 없으면 warn
- 구현 위치: `src/agent/tools/saveReportLog.ts`의 execute 함수에 검증 추가
- **저장 차단은 하지 않음** — 에이전트 판단을 믿되 이상 신호만 기록

## 작업 계획

### Phase 1 (즉시, 2일 예상) — 구현팀

**Step 1-A: 프롬프트 이슈 기준 강화**
- 수정: `scripts/validate-daily-report-prompt.md` 이슈 판단 기준 변경
- 수정: `scripts/validate-debate-report-prompt.md` 이슈 판단 기준 변경
- 완료 기준: 프롬프트 하단 `hasIssue` 조건이 `총점 ≤32 OR factConsistency < 7 OR 기타 항목 < 5`로 업데이트됨

**Step 1-B: factChecker.ts severity 세분화**
- 수정: `src/agent/lib/factChecker.ts`
  - `Mismatch.severity` 타입 유지, 생성 시 `sector_list` → `block`, `phase2_ratio` diff >= 10 → `block`
  - `aggregateSeverity` 로직 변경: `block` severity mismatch 있으면 즉시 `block` 반환
- 수정: `src/agent/__tests__/dailyQA.test.ts`, `src/agent/lib/__tests__/factChecker.test.ts` — 새 severity 로직 테스트
- 완료 기준: 기존 테스트 통과 + 섹터 오분류 시 `block` 반환 테스트 추가

**Step 1-C: qaIssueReporter.ts 신규 + 연결**
- 신규: `src/agent/lib/qaIssueReporter.ts`
- 수정: `src/agent/run-daily-agent.ts` Step 8 이후 이슈 생성 호출
- 수정: `src/agent/run-debate-agent.ts` Step 8 이후 이슈 생성 호출
- 신규: `src/agent/lib/__tests__/qaIssueReporter.test.ts`
- 완료 기준: warn 이상 QA 결과 시 `gh issue create` 호출, DRY_RUN 환경변수로 이슈 생성 스킵 가능

### Phase 2 (2-3일 예상) — 구현팀

**Step 2-A: market-events.json 생성**
- 신규: `data/market-events.json` (향후 90일 FOMC, CPI, NFP, PCE 이벤트)
- 완료 기준: JSON 파일 존재, 구조 유효성 확인

**Step 2-B: validate-debate-report.sh + 프롬프트 업데이트**
- 수정: `scripts/validate-debate-report-prompt.md` — `eventAwareness` 항목 추가, 총점 50점 기준
- 수정: `scripts/validate-debate-report.sh` — 실행 전 당일 이벤트 JSON을 프롬프트에 주입하는 로직 추가
- 완료 기준: 당일 이벤트가 프롬프트에 포함되어 Claude가 이벤트 인지 여부 채점 가능

### Phase 3 (2-3일 예상, Phase 1/2와 병렬) — 구현팀

**Step 3-A: crossReportValidator.ts 신규**
- 신규: `src/agent/lib/crossReportValidator.ts`
- 신규: `src/agent/lib/__tests__/crossReportValidator.test.ts`
- 완료 기준: 단위 테스트 통과, 일간/토론 symbol 불일치 감지 후 logger.warn 호출

**Step 3-B: priceDeclineFilter.ts 신규**
- 신규: `src/agent/lib/priceDeclineFilter.ts`
- 신규: `src/agent/lib/__tests__/priceDeclineFilter.test.ts`
- 수정: `src/agent/run-daily-agent.ts` — QA 단계 이후 급락 종목 경고 삽입
- 완료 기준: -5%/거래량 1.5x 조건 충족 시 Discord 발송 본문에 경고 카테고리 삽입

### Phase 4 (1일 예상, Phase 1과 병렬) — 구현팀

**Step 4-A: 토론 데이터 완전성 경고**
- 수정: `src/agent/run-debate-agent.ts` — theses 저장 후 빈 beneficiaryTickers 경고
- 완료 기준: theses 전체 beneficiaryTickers가 빈 배열이면 Discord 경고 메시지 발송

**Step 4-B: 일간 리포트 저장 전 검증**
- 수정: `src/agent/tools/saveReportLog.ts` — execute 함수에 reportedSymbols 검증 추가
- 완료 기준: reportedSymbols 빈 배열 또는 fullContent에 종목 언급 없음 → logger.warn 호출

## 병렬 실행 가능 여부

```
Phase 1 (Step 1-A, 1-B, 1-C) ──── 병렬 시작 가능
Phase 2 (Step 2-A, 2-B)       ──── Phase 1과 병렬 시작 가능
Phase 3 (Step 3-A, 3-B)       ──── Phase 1, 2와 병렬 시작 가능
Phase 4 (Step 4-A, 4-B)       ──── Phase 1, 2, 3과 병렬 시작 가능
```

Phase 1/2/4는 완전 병렬. Phase 3도 Phase 2 완료를 기다릴 이유가 없다 (이슈 #362의 Phase 2 선행 조건은 validate-debate-report.sh 신규 구축인데, 이미 운영 중임).

## 테스트 계획

| 파일 | 테스트 대상 | 핵심 케이스 |
|------|------------|------------|
| `factChecker.test.ts` | severity 세분화 | sector_list → block, phase2_ratio diff >= 10 → block |
| `qaIssueReporter.test.ts` | 이슈 생성 함수 | warn → gh 호출, ok → 미호출, DRY_RUN → 스킵 |
| `crossReportValidator.test.ts` | 교차 검증 | 불일치 종목 감지, DB 없을 때 graceful |
| `priceDeclineFilter.test.ts` | 급락 필터 | -5%/1.5x 조건 충족/미충족 |
| 기존 `dailyQA.test.ts` | 회귀 방지 | severity 변경 후 기존 테스트 통과 확인 |
| 기존 `debateQA.test.ts` | 회귀 방지 | 동일 |

## 리스크

**R1. 이슈 생성 폭증**: 이슈 기준이 강화되면 매일 이슈가 생성될 수 있다.
- 완화: 초기 2주간 DRY_RUN 모드로 실제 이슈 생성 수량 모니터링 후 기준 미세조정
- `VALIDATE_DRY_RUN=1` 환경변수 이미 지원됨

**R2. factChecker severity 변경이 기존 알림 패턴을 깨뜨림**: `sector_list`를 `block`으로 올리면 Discord에 BLOCK 경고가 더 자주 삽입된다.
- 완화: `aggregateSeverity` 로직만 변경하고 mismatch 생성 로직은 그대로 유지. 기존 테스트 회귀 확인 필수.

**R3. crossReportValidator의 구조적 지연 문제**: 토론은 전날 ETL 기준, 일간 에이전트는 당일 ETL 기준 → 정상적으로 불일치할 수 있다.
- 완화: 블로킹 아닌 warn-only. 불일치 감지 시 날짜 차이도 함께 출력하여 의도된 지연 구분 가능하도록 설계.

**R4. qaIssueReporter의 gh CLI 의존성**: `gh` 미설치 환경에서 오류 발생 가능.
- 완화: `gh` 실행 실패 시 logger.warn만 남기고 비블로킹 처리. validate-daily-report.sh와 동일한 패턴 사용.

**R5. validate-debate-report-prompt.md totalScore 기준 변경**: 기존 40점 → 50점으로 변경 시 과거 QA 결과와 비교 불가.
- 완화: JSON에 `schemaVersion: 2` 필드 추가하여 버전 구분. 과거 파일은 그대로 유지.

## 의사결정 필요

**D1. factChecker sector_list severity 상향**: `sector_list` mismatch를 `block`으로 올리면 "섹터 오분류" 시 Discord에 BLOCK 경고가 삽입된다. 현재는 warn이었으므로 경고 빈도가 높아질 수 있다. 기준 강화 수준 승인 필요.

**D2. 교차 검증 블로킹 여부**: 이슈 #362는 "모순 시 block"을 요구하지만 코드 분석 결과 일간/토론의 구조적 날짜 지연으로 인해 블로킹이 오탐을 유발할 가능성이 높다. 현 기획서는 warn-only로 조정함. CEO가 블로킹을 원하면 revisit 필요.

**D3. validateDebate 50점 체계**: 기존 40점에서 50점으로 확장 시 과거 이력과 비교 단절. 기존 40점 유지하되 eventAwareness를 가중치로만 반영하는 방식도 가능. 선택 필요.

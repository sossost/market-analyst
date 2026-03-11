# Report Validation Expansion — 주간/펀더멘탈 리포트 검증 확장

## 선행 맥락

- **일간 리포트 검증** (PR #175 이전, #139 흡수): `scripts/cron/validate-daily-report.sh` + `scripts/validate-daily-report-prompt.md` + `src/scripts/get-latest-report.ts`로 이미 운영 중. 팩트 일관성 / bull-bias / 구조 / novelty 4항목, 40점 만점, 미달 시 `report-feedback` 이슈 자동 생성.
- **#139 흡수**: 이슈 #139 "주간 리포트 QA"는 본 기획(#179)에 완전 흡수된다. 중복 구현 없음. #139는 본 기획 완료 후 닫는다.
- **daily_reports 테이블**: `type` 컬럼으로 `'daily'` / `'weekly'` 구분. `full_content` 텍스트 컬럼 존재. 주간 리포트도 동일 테이블에 저장됨. `get-latest-report.ts`는 현재 `type = 'daily'`만 조회.
- **펀더멘탈 리포트**: DB에 저장되지 않는다. `publishStockReport()`가 Gist + Discord로만 발행. 검증을 위해 리포트 텍스트를 파일로 임시 저장하는 방식이 필요함.
- **주간 실행 경로**: `scripts/launchd/com.market-analyst.agent-weekly.plist` → `scripts/cron/agent-weekly.sh` → `run-weekly-agent.ts`. KST 토 10:00.
- **validate-daily 구조**: 5단계 — 리포트 조회(tsx) → 프롬프트 조립(python3 치환) → `claude -p --output-format json` 실행 → 결과 저장 → 조건부 이슈 생성. 이 패턴을 그대로 재사용.

## 골 정렬

**ALIGNED** — 직접 기여.

주간 리포트는 주도섹터/주도주 포착의 종합 산출물이고, 펀더멘탈 리포트는 S등급 종목의 심층 분석 산출물이다. 두 리포트의 품질이 낮으면(팩트 오류, bull-bias, 반복성) 알파 형성의 기반 신뢰성이 훼손된다. 검증 루프 확장은 리포트 품질의 재귀 개선을 가속시킨다.

## 문제

일간 리포트에만 사후 검증 루프가 존재한다. 주간 리포트(섹터 분석 + 종목 추천 + 시장 전망)와 펀더멘탈 리포트(S등급 종목 심층 분석)는 발송 후 품질 이슈가 있어도 감지 루프가 없다. 결함이 반복되어도 이슈로 기록되지 않으므로 다음 사이클에 반영이 안 된다.

## Before → After

**Before**: 주간 에이전트 실행 → `run-weekly-agent.ts` → 리뷰(`reviewAgent`) → Discord 발송. 발송 이후 검증 없음. 펀더멘탈: `runFundamentalValidation()` → Gist + Discord. 검증 없음.

**After**: 위 파이프라인 유지 + 발송 완료 후 유형별 검증 스크립트가 후속 실행. Claude Code CLI가 리포트를 읽고 유형별 점수화. 기준 미달 시 GitHub 이슈 자동 생성(`report-feedback` 라벨).

## 변경 사항

### 신규 파일

1. `scripts/validate-weekly-report-prompt.md` — 주간 리포트 검증 프롬프트 템플릿 (5항목, 50점 만점)
2. `scripts/validate-fundamental-report-prompt.md` — 펀더멘탈 리포트 검증 프롬프트 템플릿 (4항목, 40점 만점)
3. `scripts/cron/validate-weekly-report.sh` — 주간 검증 셸 스크립트
4. `scripts/cron/validate-fundamental-report.sh` — 펀더멘탈 검증 셸 스크립트
5. `src/scripts/get-latest-weekly-report.ts` — DB에서 최신 주간 리포트 조회 (type='weekly')
6. `src/scripts/get-latest-fundamental-report.ts` — 파일시스템에서 최신 펀더멘탈 리포트 조회

### 기존 파일 수정

7. `scripts/cron/agent-weekly.sh` — 주간 에이전트 완료 후 `validate-weekly-report.sh` 후속 실행 추가 (비블로킹)
8. `src/agent/fundamental/stockReport.ts` — `publishStockReport()`에 리포트 텍스트를 `data/fundamental-reports/` 디렉토리에 파일 저장 추가
9. `scripts/cron/agent-weekly.sh` 또는 별도 트리거 — 펀더멘탈 검증 후속 실행 연결
10. `scripts/launchd/setup-launchd.sh` — (선택) validate-weekly plist 등록 항목 추가

### 코드 변경 없음

- `run-weekly-agent.ts`, `reviewAgent.ts`, `agentLoop.ts`, `runFundamentalValidation.ts` — 기존 파이프라인 유지

## 검증 항목 설계

### 주간 리포트 검증 (5항목 / 50점 만점)

일간보다 검증 항목이 많다. 주간은 시황 해석 + 섹터 분석 + 종목 추천 + 중기 전망이 복합된 구조이므로.

| 항목 | 배점 | 설명 |
|------|------|------|
| 팩트 일관성 | 0~10 | 수치 서술과 실제 데이터 일치 여부. "섹터 RS 상승"인데 RS가 하락인 경우 등 |
| bull-bias 필터 | 0~10 | 낙관/비관 언급 비율 ≤ 70:30 목표. 데이터 없는 낙관 결론 여부 |
| 구조/가독성 | 0~10 | 시장 흐름 → 섹터 → 종목 순서 준수. 핵심 정보 상단 배치 여부 |
| 이전 대비 변화 | 0~10 | 직전 주간 리포트 대비 복붙 수준 반복 여부. 새 인사이트 포함 여부 |
| 전망의 검증 가능성 | 0~10 | 예측/전망이 구체적이고 검증 가능한 조건으로 표현되었는가. "상승 가능성 있음" 같은 모호한 서술 감점 |

이슈 기준: 항목 하나라도 6점 미만 or totalScore ≤ 35 (5항목 × 7점 기준)

### 펀더멘탈 리포트 검증 (4항목 / 40점 만점)

| 항목 | 배점 | 설명 |
|------|------|------|
| 데이터 정합성 | 0~10 | EPS/매출 수치, 등급 판정 기준이 서술과 일치하는가. SEPA 기준 적용 오류 여부 |
| 서사 근거 | 0~10 | LLM 분석(narrative) 섹션이 정량 데이터에 기반하는가. 데이터 없는 낙관 서사 감점 |
| 구조 완결성 | 0~10 | 필수 섹션(기술적 현황 / 펀더멘탈 분석 / 분기 실적 / 애널리스트 분석 / 종합 판단) 모두 포함 여부 |
| 투자 판단 명확성 | 0~10 | S등급 종목으로서 왜 주목해야 하는지 명확히 서술되었는가. "상승 가능성"처럼 모호한 결론 감점 |

이슈 기준: 항목 하나라도 6점 미만 or totalScore ≤ 28

## 파이프라인 구조

```
[주간 파이프라인]
scripts/cron/agent-weekly.sh
  └─ run-weekly-agent.ts → reviewAgent → Discord 발송
  └─ (완료 후, 비블로킹) validate-weekly-report.sh
        ├─ npx tsx src/scripts/get-latest-weekly-report.ts
        ├─ claude -p (validate-weekly-report-prompt.md)
        ├─ data/report-qa/weekly-YYYY-MM-DD.json 저장
        └─ hasIssue=true → gh issue create (report-feedback)

[펀더멘탈 파이프라인]
agent-weekly.sh 내 runFundamentalValidation() 완료 후
  └─ stockReport.ts publishStockReport()가 data/fundamental-reports/SYMBOL-DATE.md 저장
  └─ (agent-weekly.sh 완료 후, 비블로킹) validate-fundamental-report.sh
        ├─ data/fundamental-reports/ 에서 당일 파일 목록 조회
        ├─ 각 파일에 대해 claude -p 실행 (항목별 검증)
        ├─ data/report-qa/fundamental-SYMBOL-YYYY-MM-DD.json 저장
        └─ hasIssue=true → gh issue create (report-feedback)
```

## 작업 계획

### Phase 1 — 주간 리포트 검증 (핵심, 먼저 완료)

**Step 1: get-latest-weekly-report.ts 작성**
- 담당: 실행팀
- 작업: `get-latest-report.ts`를 참고하여 `type = 'weekly'` 조건으로 최신 주간 리포트 2건 조회. 동일 출력 형식 (`{ today, prev }` JSON).
- 파일: `src/scripts/get-latest-weekly-report.ts`
- 완료 기준: `npx tsx src/scripts/get-latest-weekly-report.ts` 실행 시 JSON stdout. 데이터 없으면 `null`.

**Step 2: 주간 검증 프롬프트 작성**
- 담당: 실행팀
- 작업: `scripts/validate-weekly-report-prompt.md` 작성. 위 설계된 5항목 프롬프트 + JSON 출력 형식. 변수: `{REPORT_DATE}`, `{REPORT_CONTENT}`, `{PREV_DATE}`, `{PREV_REPORT_CONTENT}`. hasIssue 기준: 항목 6점 미만 or totalScore ≤ 35.
- 완료 기준: 파일 존재, 형식이 daily 프롬프트와 일관성 있음.

**Step 3: validate-weekly-report.sh 작성**
- 담당: 실행팀
- 작업: `validate-daily-report.sh`를 템플릿으로, 주간용으로 수정.
  - `get-latest-weekly-report.ts` 호출
  - `validate-weekly-report-prompt.md` 사용
  - 결과 저장: `data/report-qa/weekly-YYYY-MM-DD.json`
  - 이슈 기준: `totalScore ≤ 35` or 항목 6점 미만
  - 비블로킹 처리 (set +e 또는 || true)
- 파일: `scripts/cron/validate-weekly-report.sh`
- 완료 기준: 로컬에서 `./scripts/cron/validate-weekly-report.sh` 실행 시 JSON 저장 + 조건부 이슈 생성 동작 확인.

**Step 4: agent-weekly.sh에 후속 실행 추가**
- 담당: 실행팀
- 작업: `agent-weekly.sh` 마지막에 `validate-weekly-report.sh` 후속 실행 추가. 실패해도 파이프라인 종료 안 됨 (`|| true` 패턴).
- 완료 기준: `agent-weekly.sh` 실행 후 `validate-weekly-report.sh`가 자동으로 실행됨.

**Step 5: Vitest 단위 테스트 작성**
- 담당: 실행팀
- 작업: `get-latest-weekly-report.ts` 핵심 로직에 대한 단위 테스트. `toEntry()` 함수, null 처리 등. 기존 `get-latest-report.ts` 테스트 구조 참고.
- 완료 기준: 커버리지 80% 이상.

### Phase 2 — 펀더멘탈 리포트 검증

**Step 6: stockReport.ts 파일 저장 추가**
- 담당: 실행팀
- 작업: `publishStockReport()`에 `data/fundamental-reports/SYMBOL-DATE.md` 파일 저장 로직 추가. 기존 Gist/Discord 발송 유지. 저장 실패 시 warn 로그 후 계속 진행.
- 파일: `src/agent/fundamental/stockReport.ts`
- 완료 기준: `publishStockReport()` 호출 후 `data/fundamental-reports/` 에 파일 생성됨.

**Step 7: get-latest-fundamental-report.ts 작성**
- 담당: 실행팀
- 작업: `data/fundamental-reports/` 디렉토리에서 당일 날짜(YYYY-MM-DD) 파일 목록 조회. 파일이 없으면 `null` 반환. 형식: `{ reports: [{ symbol, date, content }] }` JSON.
- 파일: `src/scripts/get-latest-fundamental-report.ts`
- 완료 기준: 파일 있으면 JSON 배열, 없으면 `null`.

**Step 8: 펀더멘탈 검증 프롬프트 작성**
- 담당: 실행팀
- 작업: `scripts/validate-fundamental-report-prompt.md` 작성. 위 설계된 4항목 프롬프트 + JSON 출력 형식. 변수: `{SYMBOL}`, `{REPORT_DATE}`, `{REPORT_CONTENT}`. hasIssue 기준: 항목 6점 미만 or totalScore ≤ 28.
- 완료 기준: 파일 존재.

**Step 9: validate-fundamental-report.sh 작성**
- 담당: 실행팀
- 작업:
  - `get-latest-fundamental-report.ts` 호출
  - 당일 리포트 파일 목록 순회
  - 각 파일에 대해 `claude -p` 실행 (타임아웃 300초)
  - 결과 저장: `data/report-qa/fundamental-SYMBOL-DATE.json`
  - `hasIssue=true`이면 이슈 생성 (제목에 종목명 포함)
  - 비블로킹 처리
- 파일: `scripts/cron/validate-fundamental-report.sh`
- 완료 기준: 로컬에서 실행 시 종목별 JSON 저장 + 조건부 이슈 생성.

**Step 10: agent-weekly.sh에 펀더멘탈 검증 연결**
- 담당: 실행팀
- 작업: `agent-weekly.sh` 마지막에 `validate-fundamental-report.sh` 후속 실행 추가 (비블로킹). 주간 검증 이후 순차 실행 (상호 독립적이지만 파일 저장 완료 보장을 위해 순서 유지).
- 완료 기준: 주간 에이전트 완료 후 두 검증 스크립트가 순차 실행됨.

## 파일 변경 목록 (요약)

| 파일 | 변경 유형 | Phase |
|------|-----------|-------|
| `src/scripts/get-latest-weekly-report.ts` | 신규 | 1 |
| `scripts/validate-weekly-report-prompt.md` | 신규 | 1 |
| `scripts/cron/validate-weekly-report.sh` | 신규 | 1 |
| `scripts/cron/agent-weekly.sh` | 수정 (후속 실행 추가) | 1 |
| `src/agent/fundamental/stockReport.ts` | 수정 (파일 저장 추가) | 2 |
| `src/scripts/get-latest-fundamental-report.ts` | 신규 | 2 |
| `scripts/validate-fundamental-report-prompt.md` | 신규 | 2 |
| `scripts/cron/validate-fundamental-report.sh` | 신규 | 2 |

## 수용 기준 (Acceptance Criteria)

### Phase 1
- [ ] `get-latest-weekly-report.ts` — weekly 타입 조회, JSON stdout, null 처리
- [ ] `validate-weekly-report.sh` — 실행 시 `data/report-qa/weekly-DATE.json` 생성됨
- [ ] `validate-weekly-report.sh` — hasIssue=true 시 `report-feedback` 라벨 이슈 생성됨
- [ ] `agent-weekly.sh` — 주간 에이전트 완료 후 자동으로 검증 실행됨
- [ ] 검증 실패 시 파이프라인이 종료되지 않음 (비블로킹)
- [ ] 단위 테스트 커버리지 80% 이상

### Phase 2
- [ ] `publishStockReport()` 호출 후 `data/fundamental-reports/SYMBOL-DATE.md` 파일 생성됨
- [ ] `validate-fundamental-report.sh` — 종목별 JSON 저장됨
- [ ] `validate-fundamental-report.sh` — 이슈 제목에 종목명 포함됨
- [ ] `agent-weekly.sh` — 주간 + 펀더멘탈 검증 둘 다 자동 실행됨

## 이슈 생성 규칙

### 라벨
- `report-feedback` — 공통 (기존 라벨 재사용)
- 우선순위: 항목 3점 미만 → `P1: high`, 그 외 → `P2: medium`

### 이슈 제목 패턴
- 주간: `주간 리포트 품질 이슈 — YYYY-MM-DD (점수: N/50)`
- 펀더멘탈: `[SYMBOL] 펀더멘탈 리포트 품질 이슈 — YYYY-MM-DD (점수: N/40)`

### 이슈 본문 포함 내용
- 날짜, 총점, 항목별 점수
- 감점 항목별 근거 (1~2줄)
- 재발 방지 제안 (프롬프트/가드레일 방향)
- 다음 리포트 체크포인트

## 리스크

1. **주간 리포트 full_content 미채움**: `daily_reports.full_content`가 null이면 구조화 데이터 fallback으로 검증. 검증의 실효성이 낮아질 수 있음. Phase 1 후 실제 채워짐 여부를 `get-latest-weekly-report.ts` 실행으로 확인.

2. **펀더멘탈 리포트 파일 저장 부하**: S등급이 여러 종목이면 `claude -p`를 종목 수만큼 순차 실행. 타임아웃 × 종목 수만큼 시간 소요. S등급은 통상 1~3종목이므로 허용 범위. 5종목 초과 시 병렬화 검토.

3. **`claude -p` 맥미니 가용성**: 일간 검증과 동일 전제. 이미 일간 검증이 운영 중이므로 추가 설치 불필요.

4. **이슈 노이즈**: 주간/펀더멘탈 검증 기준을 너무 엄격하게 설정하면 노이즈 증가. Phase 1 배포 후 2주 관찰 → 임계값 조정.

5. **data/fundamental-reports/ 파일 누적**: 매주 S등급 리포트가 쌓임. 현재 `data/` 디렉토리는 gitignore 여부 확인 필요. 30일 이상 된 파일은 주기적 정리 권장.

## #139 흡수 처리

- 이슈 #139 "주간 리포트 QA"는 본 기획(#179)의 Phase 1에 완전 포함됨
- 본 기획 Phase 1 완료 시 #139를 "Closed as completed by #179"로 닫음
- #139에 별도로 구현 시작하지 않음

## 의사결정 필요

없음 — 매니저 + mission-planner 자율 판단으로 결정됨:

1. **#139 흡수**: 확정. 별도 진행 없음.
2. **펀더멘탈 파일 저장 위치**: `data/fundamental-reports/` 로 결정. 기존 `data/report-qa/` 패턴과 일관성 유지.
3. **검증 실행 방식**: 쉘 스크립트 후속 실행 (비블로킹). launchd 별도 plist 추가 안 함.
4. **점수 기준**: 주간 35/50, 펀더멘탈 28/40로 결정 (일간과 동일한 70% 기준).

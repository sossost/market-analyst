# Daily Report QA Pipeline

## 선행 맥락

- **bull-bias 필터** (#107, PR #114): 프롬프트 가드레일 3개 규칙 적용됨. 생성 단계 편향 억제는 기존에 구현됨. 이번 기획은 생성 후 검증(post-hoc)으로 별개 레이어.
- **QA 시스템** (#59, PR #62): 주간 QA 리포트 — GitHub Actions + `data/qa-reports/` 파일 저장 + Discord 발송. 시스템 단위 점검이 목적이며 개별 리포트 품질 검증은 담당하지 않음.
- **reviewAgent.ts** (기존): 생성된 draft를 Anthropic API로 리뷰(OK/REVISE/REJECT) 후 즉시 수정·발송. 역할은 발송 전 실시간 교정. 이번 기획의 검증과 목적이 다름 — 본 기획은 발송 후 감사(audit) + 개선점 추적.
- **리포트 DB 마이그레이션** (#120, PR #126): `daily_reports` 테이블에 `full_content` 컬럼으로 전체 리포트 텍스트 저장 가능.
- **편향 감지** (PR #63): `biasDetector.ts`는 thesis learnings 대상. 리포트 텍스트 편향 감지와 별개.

## 골 정렬

**ALIGNED** — 직접 기여.

일간 보고서는 Phase 2 주도섹터/주도주 포착 결과를 담는 최종 산출물이다. 산출물 품질이 낮으면(팩트 오류, bull-bias, 반복 복붙) 알파 형성에 직접 해가 된다. 검증 → 이슈 생성 → 다음 사이클 반영 루프는 시스템의 재귀 개선을 가속시킨다.

## 문제

일간 보고서가 `reviewAgent.ts`의 실시간 교정을 거쳐 발송되지만, 발송된 최종본의 품질은 사후에 검토되지 않는다. bull-bias, 팩트 불일치, 이전 리포트 대비 반복성 등 패턴성 문제가 누적되어도 감지 루프가 없다.

## Before → After

**Before**: 보고서 생성(agentLoop) → 리뷰(reviewAgent) → 발송(Discord). 발송 이후 사후 검토 없음. 문제가 있어도 누가 어떤 리포트에서 발견하지 않으면 흘러감.

**After**: 위 파이프라인 유지 + 발송 직후 `scripts/cron/validate-daily-report.sh`가 후속 실행. Claude Code CLI(`claude -p`)가 최신 리포트를 읽고 4가지 항목을 점수화. 개선점 발견 시 GitHub 이슈 자동 생성(`report-feedback` 라벨). 문제 없으면 조용히 종료. 이슈가 쌓이면 다음 사이클 프롬프트 개선에 반영.

## 변경 사항

1. **`scripts/cron/validate-daily-report.sh`** — 새 파일. 일간 에이전트 실행 후 후속으로 호출되는 검증 쉘 스크립트.
2. **`scripts/validate-daily-report-prompt.md`** — 새 파일. `claude -p`에 전달할 검증 프롬프트 템플릿 (변수 치환 후 사용).
3. **`src/scripts/get-latest-report.ts`** — 새 파일. `daily_reports` DB에서 최신 일간 리포트를 조회하여 stdout으로 출력하는 경량 스크립트.
4. **`scripts/launchd/com.market-analyst.validate-daily.plist`** — 새 파일. 맥미니 launchd 등록용. 일간 에이전트 완료 후 일정 딜레이(10분)로 실행.
5. **`scripts/launchd/setup-launchd.sh`** — 기존 파일 수정. 신규 plist 등록 항목 추가.
6. **`data/report-qa/`** — 새 디렉토리. 검증 결과 로컬 파일 저장 경로.

코드 변경 없음: `run-daily-agent.ts`, `reviewAgent.ts`, `agentLoop.ts` — 기존 파이프라인 유지.

## 파이프라인 구조

```
[맥미니 launchd]
     │
     ├─ com.market-analyst.agent-daily.plist (기존, 없으면 etl-daily에 통합)
     │       ↓
     │  scripts/cron/etl-daily.sh or agent-daily.sh
     │       ↓
     │  npx tsx src/agent/run-daily-agent.ts
     │       └→ agentLoop → reviewAgent → Discord 발송
     │
     └─ com.market-analyst.validate-daily.plist (신규, 약 +10분 오프셋)
             ↓
        scripts/cron/validate-daily-report.sh
             │
             ├─ npx tsx src/scripts/get-latest-report.ts  (DB에서 최신 리포트 조회)
             │       ↓ stdout: 리포트 텍스트 + 메타데이터
             │
             ├─ 직전 리포트 조회 (비교 기준)
             │
             └─ claude -p "$(프롬프트 템플릿 + 리포트 삽입)"
                     ↓
                JSON 결과 파싱
                     │
                     ├─ 이슈 없음 → 로컬 파일 저장 + 종료
                     └─ 이슈 있음 → gh issue create (report-feedback 라벨)
                                      + 로컬 파일 저장
```

## Claude Code CLI 프롬프트 설계

### 입력 구조

```
당신은 시장 분석 리포트 감사관입니다. 오늘 발송된 일간 리포트를 읽고 4가지 항목을 점수화합니다.

## 오늘 리포트 ({REPORT_DATE})
{REPORT_CONTENT}

## 직전 리포트 ({PREV_DATE}, 비교 기준)
{PREV_REPORT_CONTENT}

---

## 검증 항목

### 1. 팩트 일관성 (0~10점)
- 데이터 수치와 서술이 일치하는가?
- 예: "섹터 RS 상승" 서술인데 실제 RS 수치가 하락인 경우 → 감점
- 판단 근거를 1~2줄로 명시

### 2. bull-bias 필터 (0~10점)
- 리스크/약세 언급 비율이 충분한가? (목표: 낙관/비관 언급 비율 ≤ 70:30)
- 데이터 없이 낙관 결론을 내리는가?
- 판단 근거를 1~2줄로 명시

### 3. 구조/가독성 (0~10점)
- 리포트 포맷 준수 여부 (섹터 요약 → 종목 → 시장 흐름 순서)
- 핵심 정보가 상단에 있는가?
- Discord 2000자 제한 준수 여부 (메시지 섹션 기준)
- 판단 근거를 1~2줄로 명시

### 4. 이전 대비 변화 (0~10점)
- 직전 리포트 대비 복붙 수준으로 동일한 문장이 반복되는가?
- 새로운 인사이트가 포함되었는가?
- 판단 근거를 1~2줄로 명시

---

## 출력 형식

반드시 아래 JSON만 출력하세요. 코드 펜스 없이 순수 JSON.

{
  "scores": {
    "factConsistency": <0~10>,
    "bullBias": <0~10>,
    "structure": <0~10>,
    "novelty": <0~10>
  },
  "totalScore": <0~40>,
  "hasIssue": <true|false>,
  "issueTitle": "<GitHub 이슈 제목. hasIssue=false면 빈 문자열>",
  "issueBody": "<GitHub 이슈 본문 (마크다운). hasIssue=false면 빈 문자열>",
  "summary": "<검증 요약 1~2줄>"
}

판단 기준:
- hasIssue = true 조건: 어느 하나라도 6점 미만이거나 totalScore ≤ 28
- issueBody에는 감점 항목별 근거, 재발 방지 제안 포함
- 모든 점수 ≥ 7이고 totalScore ≥ 30이면 hasIssue = false
```

### 설계 원칙

- `claude -p` 플래그: 단일 프롬프트 실행, stdin 입력, JSON stdout 출력
- 검증자는 수정하지 않는다 — JSON만 반환, 리포트 내용 변경 없음
- 직전 리포트 없으면 novelty 항목 점수 보류(null), hasIssue 판단에서 제외
- Claude Code Max 토큰 여유 활용 — 외부 API 비용 추가 없음

## 이슈 자동 생성 로직

```bash
# 검증 결과 파싱
HAS_ISSUE=$(echo "$QA_RESULT" | jq -r '.hasIssue')
ISSUE_TITLE=$(echo "$QA_RESULT" | jq -r '.issueTitle')
ISSUE_BODY=$(echo "$QA_RESULT" | jq -r '.issueBody')

if [ "$HAS_ISSUE" = "true" ]; then
  gh issue create \
    --title "$ISSUE_TITLE" \
    --body "$ISSUE_BODY" \
    --label "report-feedback" \
    --label "P2: medium"
fi
```

### 이슈 본문 포함 내용

- 날짜, 총점, 항목별 점수
- 감점 근거 (각 항목 1~2줄)
- 재발 방지 제안 (프롬프트 수정 또는 가드레일 강화 방향)
- 다음 리포트에서 확인할 체크포인트

### 라벨 규칙

- `report-feedback` — 리포트 품질 피드백 전용 라벨 (신규 생성 필요)
- `P2: medium` — 기본 우선순위. 3점 미만 항목이 있으면 `P1: high`로 격상

## 맥미니 launchd 연동 방안

### 일간 에이전트 plist 현황

현재 `scripts/launchd/`에 `com.market-analyst.agent-daily.plist`가 없다. 일간 에이전트는 GitHub Actions 또는 별도 트리거로 실행되는 것으로 추정됨. 구현 시 실제 실행 방식을 확인하여 후속 스케줄 설계.

### validate-daily plist 설계

```xml
<!-- com.market-analyst.validate-daily.plist -->
<!-- 매일 한국 장 마감 후 에이전트 실행 완료 타이밍을 고려하여 설정 -->
<!-- 에이전트 실행 시각 + 10분 오프셋 -->
<key>StartCalendarInterval</key>
<dict>
  <!-- 구체 시각은 일간 에이전트 실행 시각 확인 후 결정 -->
  <key>Hour</key><integer>TBD</integer>
  <key>Minute</key><integer>TBD</integer>
</dict>
```

**대안**: 절대 시각 스케줄 대신, `etl-daily.sh` 또는 일간 에이전트 쉘 스크립트 내 마지막 단계로 `validate-daily-report.sh`를 후속 실행. 이 경우 launchd 별도 등록 불필요. 실패해도 `set +e`로 비블로킹 처리.

**결정**: Phase 1 구현에서는 쉘 스크립트 후속 실행 방식 채택. launchd 추가는 Phase 2.

## 작업 계획

### Phase 1: 핵심 검증 루프 (필수)

**Step 1 — GitHub 라벨 생성**
- 담당: 실행팀 (구현 간단)
- 작업: `gh label create "report-feedback" --color "#FF9800"` 실행
- 완료 기준: 라벨이 repo에 존재

**Step 2 — get-latest-report.ts 작성**
- 담당: 실행팀
- 작업: `daily_reports` DB에서 최신 일간 리포트 2건 조회 (오늘 + 직전). `full_content`가 null이면 `reportedSymbols` + `marketSummary`를 포맷팅하여 대체 텍스트 생성. JSON 형태로 stdout 출력.
- 출력 형식:
  ```json
  {
    "today": { "date": "YYYY-MM-DD", "content": "..." },
    "prev": { "date": "YYYY-MM-DD", "content": "..." }
  }
  ```
- 완료 기준: `npx tsx src/scripts/get-latest-report.ts` 실행 시 JSON stdout 출력. 데이터 없으면 `null` 반환 후 exit 0.

**Step 3 — 검증 프롬프트 파일 작성**
- 담당: 실행팀
- 작업: `scripts/validate-daily-report-prompt.md` 파일 작성. 위 설계된 프롬프트 템플릿 저장. `{REPORT_DATE}`, `{REPORT_CONTENT}`, `{PREV_DATE}`, `{PREV_REPORT_CONTENT}` 변수 플레이스홀더 포함.
- 완료 기준: 파일 존재

**Step 4 — validate-daily-report.sh 작성**
- 담당: 실행팀
- 작업:
  1. `npx tsx src/scripts/get-latest-report.ts`로 리포트 조회
  2. 결과가 null이면 "리포트 없음" 로그 후 exit 0
  3. 프롬프트 템플릿에 실제 리포트 내용 치환
  4. `claude -p "$(프롬프트)"` 실행 (타임아웃 5분)
  5. stdout을 JSON 파싱 (`jq`)
  6. `data/report-qa/YYYY-MM-DD.json` 저장
  7. `hasIssue=true`이면 `gh issue create` 실행
  8. 에러는 비블로킹 처리 — 검증 실패가 리포트 발송을 막지 않음
- 완료 기준: 로컬에서 `./scripts/cron/validate-daily-report.sh` 실행 시 JSON 저장 + 조건부 이슈 생성 동작 확인

**Step 5 — 일간 에이전트 실행 방식 확인 + 후속 실행 연결**
- 담당: 실행팀
- 작업: 일간 에이전트 실행 경로(GitHub Actions / 맥미니 launchd / 수동) 확인. 확인된 경로에 `validate-daily-report.sh` 후속 실행 추가. 실패해도 에이전트 파이프라인 종료 안 됨.
- 완료 기준: 일간 에이전트 완료 후 자동으로 검증 스크립트 실행됨

### Phase 2: 개선 (선택, Phase 1 안정화 후)

- `full_content` 컬럼이 실제로 채워지고 있지 않다면 `saveReportLogTool` 또는 리포트 저장 로직에서 채우도록 수정
- launchd 별도 plist 등록 (절대 시각 스케줄)
- 검증 결과를 DB에 저장하는 `report_qa_results` 테이블 추가 (트렌드 추적)
- 주간 QA 리포트에 "이번 주 일간 리포트 평균 QA 점수" 섹션 추가

## 테스트 전략

### 단위 테스트 불필요 항목

- 쉘 스크립트 자체 — 통합 테스트로 대체
- `claude -p` CLI 동작 — 외부 의존성

### 통합 테스트 (get-latest-report.ts)

`src/scripts/get-latest-report.ts`에 대한 Vitest 단위 테스트:
- `daily_reports` 데이터 있을 때 올바른 JSON 반환 여부
- `full_content` null 시 대체 텍스트 생성 로직
- 데이터 없을 때 `null` 반환 여부

커버리지 목표: 80% 이상

### 수동 검증 절차

1. DB에 최신 daily_reports 레코드 존재 확인
2. `npx tsx src/scripts/get-latest-report.ts` 실행 → JSON 출력 확인
3. `./scripts/cron/validate-daily-report.sh` 직접 실행 (환경변수 주입 후)
4. `data/report-qa/YYYY-MM-DD.json` 파일 생성 확인
5. 테스트용 낮은 점수 JSON을 강제 주입하여 이슈 생성 동작 확인
6. GitHub repo에 `report-feedback` 라벨 이슈 생성 확인

## 리스크

1. **`full_content` 컬럼 미채움**: `daily_reports`의 `full_content`가 null이면 검증 대상 텍스트가 구조화 데이터(`reportedSymbols`, `marketSummary`)만 남아 팩트 일관성 검증의 실효성 저하. Step 2에서 대체 텍스트 생성 로직 필수. Phase 2에서 근본 해결.

2. **`claude -p` 환경 가용성**: 맥미니에 Claude Code CLI 설치 + 인증 상태 전제. 설치 안 되어 있으면 Phase 1 실행 불가. 사전 확인 필요.

3. **검증 latency**: `claude -p` 실행 시간이 길면(최대 5분 타임아웃) 일간 파이프라인 전체 시간 증가. 비블로킹 처리로 영향 최소화.

4. **이슈 노이즈**: 검증 기준이 너무 엄격하면 매일 이슈가 생성되어 무시되는 패턴 발생. 초기 2주는 점수 기준을 관찰 후 임계값 조정.

5. **GitHub API rate limit**: `gh issue create`는 토큰 기반이라 rate limit 리스크 낮음. 단, CI 환경에서 GITHUB_TOKEN 권한 확인 필요.

## 의사결정 필요

1. **일간 에이전트 실행 경로**: 현재 일간 보고서가 맥미니 launchd로 실행되는지, GitHub Actions로 실행되는지 명확하지 않음. 구현 시 CEO 확인 또는 실행팀이 코드베이스에서 확인 후 결정.

2. **이슈 임계값**: 6점 미만 또는 totalScore ≤ 28을 기본으로 설정했으나, 초기에는 너무 엄격할 수 있음. Phase 1 배포 후 2주 관찰 → CEO 피드백으로 조정.

3. **`report-feedback` 라벨 알림**: 이슈가 생성될 때 특정 Discord 채널에 알릴지 여부. 기본 설정은 이슈만 생성(조용히). Discord 알림 원하면 추가 구현 필요.

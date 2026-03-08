# QA 에이전트 정상화

## 선행 맥락

- **2026-03-07 교훈** (`memory/chief-of-staff.md`): 이슈 #58(초입 포착 도구 검증)에서 LCNB/COO 같은 Phase 3→1 하락 종목이 "Phase 2 진입 대기"로 오분류된 것을 CEO가 직접 발견했다. "도구를 만든 후 작동하는지 정량 검증하는 루프가 없으면 false positive가 방치된다. QA가 이 역할을 해야 함"이라는 교훈이 기록됨.
- **MEMORY.md 잔존 괴리**: "QA 실행 상태 불명 — 검증 루프가 끊겨 있을 가능성"이 P1 이슈로 기록됨.
- `run-weekly-qa.ts`와 `qa-analyst.md`는 완성된 상태지만, 실행 파이프라인이 누락된 상태.

## 골 정렬

**SUPPORT** — 직접 초입 포착은 아니지만, 검증 루프가 없으면 다른 모든 개선(Phase 1 후기 포착, RS 필터, 펀더멘탈 교집합)이 실제로 작동하는지 알 수 없다. #58 결과가 QA에 피드되지 않으면 정량 검증의 가치도 반감된다. 없으면 다른 기능 개선이 검증 불가이므로 즉시 정상화 대상.

## 문제

QA 에이전트(`run-weekly-qa.ts`)와 크론 스크립트(`qa-weekly.sh`)는 존재하지만, 맥미니 크론탭에 등록되어 있지 않고 GitHub Actions workflow도 없다. 결과적으로 QA가 한 번도 자동 실행된 적 없으며, #58에서 확보한 초입 포착 도구 검증 결과도 QA 점검 항목에 포함되어 있지 않다.

## Before → After

**Before**
- 맥미니 크론탭: ETL Daily, Debate Daily, Agent Weekly만 등록. QA Weekly 누락.
- GitHub Actions: `agent-weekly.yml`에 QA 실행 없음. QA 전용 workflow 없음.
- QA 리포트 저장 경로: 없음 (Discord/Gist로만 발송, 로컬 파일 없음).
- #58 검증 결과 (`tool-validation-*.json`): QA 시스템 프롬프트에 반영 안 됨.
- `data/backtest/` 체크: 시스템 프롬프트에 언급되어 있으나 실제 데이터 없음 (현재 QA가 스킵 가능).

**After**
- 맥미니 크론탭: QA Weekly (토 UTC 03:00) 등록 완료.
- GitHub Actions: `qa-weekly.yml` workflow 신설. 매주 토요일 자동 실행.
- QA 리포트: `data/qa-reports/YYYY-MM-DD.md`에 저장 후 커밋 (이력 보존).
- `run-weekly-qa.ts` 시스템 프롬프트: #58 검증 결과(Phase 1 후기 41.9%, RS 20.3%, 교집합 30.6%)를 골 달성 판단 기준으로 명시.
- 초입 포착 도구 3종 동작 여부를 QA 점검 항목에 추가.

## 변경 사항

### 1. GitHub Actions workflow 신설
파일: `.github/workflows/qa-weekly.yml`
- 트리거: 매주 토 UTC 03:00 + workflow_dispatch
- 실행: `npx tsx src/agent/run-weekly-qa.ts`
- 환경변수: DATABASE_URL, ANTHROPIC_API_KEY, DISCORD_DEBATE_WEBHOOK_URL (또는 DISCORD_WEBHOOK_URL), DISCORD_ERROR_WEBHOOK_URL, GH_GIST_TOKEN
- 결과 파일을 `data/qa-reports/` 에 저장 후 커밋

### 2. run-weekly-qa.ts 수정
- 리포트를 `data/qa-reports/YYYY-MM-DD.md`에 파일로도 저장하는 로직 추가
- 시스템 프롬프트 "골 달성 진척도" 섹션에 #58 검증 기준 명시:
  - Phase 1 후기 전환율 기준: 41.9% (유효 임계값)
  - RS 상승 초기 전환율 기준: 20.3% (섹터 동반 상승 시 24.2%)
  - 펀더멘탈+Phase1 교집합 기준: 30.6%
  - 섹터 동반 상승 여부를 가장 유의미한 필터로 명시

### 3. 맥미니 크론탭 업데이트
- SSH로 접속하여 `setup-cron.sh`를 재실행 (QA Weekly가 이미 스크립트에 포함됨)
- `setup-cron.sh` 자체는 변경 불필요: QA Weekly(토 UTC 03:00) 이미 정의됨

### 4. data/qa-reports/ 디렉토리 초기화
- `.gitkeep` 파일로 디렉토리 생성 및 커밋
- `.gitignore` 확인: `data/qa-reports/`가 제외되어 있으면 추적 대상으로 변경

## 작업 계획

### Step 1: 저장 경로 및 디렉토리 준비
**에이전트**: 실행팀 (구현)
**작업**:
- `data/qa-reports/.gitkeep` 생성
- `.gitignore`에서 `data/qa-reports/` 제외 여부 확인 및 필요시 수정
**완료 기준**: `data/qa-reports/` 디렉토리가 git에 추적됨

### Step 2: run-weekly-qa.ts — 파일 저장 + 프롬프트 강화
**에이전트**: 실행팀 (구현)
**작업**:
- `main()` 함수에 `data/qa-reports/YYYY-MM-DD.md` 파일 저장 로직 추가 (Discord 발송과 독립)
- 시스템 프롬프트 "골 달성 진척도" 섹션에 #58 검증 기준값 삽입
**완료 기준**:
- 로컬에서 `npm run agent:qa` 실행 시 `data/qa-reports/` 에 리포트 파일 생성됨
- 프롬프트에 검증 기준값이 포함됨

### Step 3: GitHub Actions workflow 신설
**에이전트**: 실행팀 (구현)
**작업**: `.github/workflows/qa-weekly.yml` 작성
- 매주 토 UTC 03:00 스케줄
- `run-weekly-qa.ts` 실행
- 생성된 `data/qa-reports/YYYY-MM-DD.md`를 git add + commit + push
**완료 기준**: workflow 파일이 유효한 YAML이며 agent-weekly.yml과 동일한 secrets 구조를 사용

### Step 4: 맥미니 크론탭 업데이트
**에이전트**: 매니저 직접 실행 (SSH 명령)
**작업**: `ssh <MAC_MINI_HOST> "cd /Users/mini/market-analyst && ./scripts/cron/setup-cron.sh"`
**완료 기준**: `crontab -l`에 QA Weekly (토 UTC 03:00) 항목이 나타남

### Step 5: 통합 검증
**에이전트**: 매니저 직접 확인
**작업**: `ssh <MAC_MINI_HOST> "crontab -l"` 로 QA 항목 확인, workflow YAML 문법 검증
**완료 기준**: 크론탭 + GitHub Actions 양쪽에 QA 실행이 등록됨

## 리스크

1. **맥미니 vs GitHub Actions 이중 실행**: 맥미니와 GitHub Actions 둘 다 실행되면 같은 날 QA 리포트가 2번 발송될 수 있다. 맥미니는 오프라인 리스크가 있으므로 GitHub Actions를 주(主) 실행으로, 맥미니를 백업으로 유지한다. 리포트 파일명에 날짜가 들어가므로 중복 파일은 덮어쓰기로 처리.
2. **`report_logs` 테이블 부재 가능성**: `run-weekly-qa.ts`가 `report_logs` 테이블을 쿼리하는데, `queryOrNull`로 감싸져 있어 실패해도 전체 실행이 중단되지 않는다. 테이블 없으면 "데이터 수집 실패"로 표시됨 — 수용 가능.
3. **Gist 토큰 부재 시**: Gist 없이 Discord 요약만 발송되는 폴백이 구현되어 있다. 문제없음.
4. **GitHub Actions에서 파일 커밋 권한**: `GITHUB_TOKEN`의 `contents: write` 권한이 필요하다. workflow에 명시적으로 추가 필요.

## 의사결정 필요

없음 — 바로 구현 가능.

(주 실행을 GitHub Actions, 맥미니를 백업으로 하는 구조는 기존 패턴(agent-weekly가 GitHub Actions 주, 맥미니 백업)과 일치하므로 자율 판단으로 결정함.)

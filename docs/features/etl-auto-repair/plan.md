# Plan: ETL 실패 시 Claude Code 자동 수정 + PR 생성 인프라

## 문제 정의

현재 ETL 파이프라인 실패 시:
- GitHub Actions job이 exit(1)로 실패
- Discord 알림 없음 (ETL job은 sendDiscordError 미연동)
- 사람이 GitHub Actions 실패를 확인하고 수동 대응

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| ETL 실패 감지 | GitHub Actions UI 확인 | 자동 감지 + repair 시도 |
| 대응 | 사람이 로그 확인 → 수동 수정 | Claude Code CLI가 분석 → 수정 → PR 생성 |
| 알림 | 없음 | Discord에 PR URL 또는 에러 알림 |
| 복구 시간 | 수 시간 ~ 1일 | 수 분 (자동) |

## 골 정렬

- **판정: SUPPORT**
- Phase 2 주도섹터/주도주 포착 목표와 직접 관련은 없으나, ETL 파이프라인 안정성은 모든 분석의 기반
- 운영 부담 감소 → CEO가 분석/의사결정에 집중 가능

## 무효 판정

- **해당 없음** — LLM 백테스트, 과최적화 등 무효 패턴에 해당하지 않음
- 인프라 자동화 영역으로 유효한 엔지니어링 과제

## 변경 사항

### 1. `scripts/auto-repair.sh` — Claude Code CLI 자동 복구 스크립트
- ETL 실패 시 호출되는 엔트리포인트
- 입력: 실패한 job 이름, 에러 로그, 관련 파일 경로
- 동작: Claude Code CLI를 비대화형으로 호출하여 분석 → 수정 → PR 생성
- 안전장치: 1회 실패당 1회만 시도, 수정 범위 제한, PR만 생성 (머지 금지)

### 2. `scripts/etl-repair-prompt.md` — Claude Code에 전달할 프롬프트 템플릿
- 에러 컨텍스트, 수정 가능 파일 범위, 규칙을 포함한 프롬프트
- 변수 치환: `{{ERROR_LOG}}`, `{{JOB_NAME}}`, `{{RELATED_FILES}}`

### 3. `src/lib/etl-repair.ts` — repair 트리거 유틸리티
- ETL job에서 import하여 사용하는 repair 호출 함수
- 실패 시 `scripts/auto-repair.sh`를 subprocess로 호출
- 환경 문제(네트워크, 인증)는 제외하고 코드 문제만 repair 시도
- repair 실패 시 기존 Discord 에러 알림 fallback

### 4. 테스트
- `src/lib/__tests__/etl-repair.test.ts` — repair 트리거 유닛 테스트

## 설계 결정

### 수정 범위 제한
- `src/etl/`, `src/db/` 디렉토리만 수정 허용
- `--allowedTools`로 Edit, Read, Grep, Glob, Write만 허용
- `gh pr create`는 허용하되 `gh pr merge`는 금지

### 환경 문제 vs 코드 문제 분류
- 환경 문제 키워드: ECONNREFUSED, ENOTFOUND, ETIMEDOUT, 401, 403, rate limit
- 위 키워드가 포함된 에러는 repair 대상에서 제외 → Discord 알림만

### 무한 루프 방지
- lock 파일 방식: `/tmp/etl-repair-{job-name}.lock`
- lock 파일이 존재하면 repair 스킵
- repair 완료(성공/실패) 후 lock 해제

### PR 생성 규칙
- 브랜치: `auto-repair/{job-name}-{timestamp}`
- 커밋 메시지: `fix(etl): auto-repair {job-name} — {error-summary}`
- PR body에 에러 로그, 수정 내용, 자동 생성 표시 포함

## 작업 계획

1. `scripts/auto-repair.sh` 작성
2. `scripts/etl-repair-prompt.md` 프롬프트 템플릿 작성
3. `src/lib/etl-repair.ts` repair 트리거 유틸리티 작성
4. 테스트 작성 및 검증
5. 기존 ETL job에 repair 연동은 별도 이슈로 분리 (이 이슈는 인프라만)

## 리스크

| 리스크 | 대응 |
|--------|------|
| Claude Code CLI 미설치 | repair 호출 시 존재 확인, 없으면 skip + 알림 |
| API 비용 과다 | 1회 실패당 1회만 시도, 프롬프트 최소화 |
| 잘못된 수정 PR | 머지는 CEO만 가능, PR 리뷰 필수 |
| repair 중 다른 ETL 실행 | lock 파일로 중복 방지 |

## 선행 조건

- 맥미니에 Claude Code CLI 설치 및 API 키 설정 (운영 환경 설정은 별도)
- 이 이슈는 인프라 코드만 작성, 실제 ETL job 연동은 후속 이슈

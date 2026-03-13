# console.log → logger 통합 마이그레이션

## 선행 맥락

메모리 검색 결과: logger 관련 선행 결정/실패 기록 없음.

`src/agent/logger.ts`는 이미 존재하며 `src/agent/` 하위의 토론·에이전트 파일 20여 개가 import하여 사용 중이다.
문제는 ETL job 26개와 lib/db 파일 4개가 logger를 아예 도입하지 않은 채 `console.log`를 직접 사용한다는 것이다.

## 골 정렬

SUPPORT — 간접 기여 (운영 품질 기반).

Phase 2 포착 알파는 ETL 파이프라인이 안정적으로 돌아야 실현된다. 현재 운영 중 ETL 오류가 발생해도 로그 레벨 제어 없이 stdout에 전부 뿌려지므로 장애 추적이 어렵다. logger 통합은 운영 관측성(observability)의 최소 기반이다.

우선순위는 새 알파 기능보다 낮지만, 운영 안정성의 전제 조건이다.

## 문제

프로덕션 소스(`src/`) 30개 파일에 `console.log` 161회가 산재한다. `src/agent/logger.ts`가 존재하나 ETL job 26개는 이를 전혀 사용하지 않는다. 결과적으로 운영 환경에서 로그 레벨 제어가 불가능하고, 장애 시 신호와 노이즈를 분리할 수 없다.

## Before → After

**Before**
- ETL job 26개 파일: `console.log()` 직접 호출, logger import 없음
- `src/lib/group-rs.ts`, `src/db/migrate.ts`, `src/issue-processor/index.ts`: 동일
- `src/agent/logger.ts`: `info/warn/error/step` 4개 메서드만 존재, 로그 레벨 제어 없음
- 운영환경과 개발환경 동일한 출력 — 조용한 운영 불가

**After**
- `src/` 전체에서 `console.log` 0회 (logger.ts 내부 구현 제외)
- `logger.ts`에 `LOG_LEVEL` 환경변수 기반 레벨 필터 추가 (`debug < info < warn < error`)
- ETL job 및 lib/db 파일 전체: `logger.info(tag, message)` 패턴으로 교체
- 운영환경: `LOG_LEVEL=warn` 설정 시 info 로그 억제 가능

## 변경 사항

### 1. `src/agent/logger.ts` 개선

현재 구현에 로그 레벨 필터를 추가한다. 인터페이스는 유지하되 `debug` 메서드를 신설하고, `LOG_LEVEL` 환경변수로 출력 기준을 제어한다.

```
레벨 우선순위: debug(0) < info(1) < warn(2) < error(3)
기본값: info (환경변수 미설정 시)
```

변경 범위: `logger.ts` 단일 파일, 기존 호출자 시그니처 변경 없음.

### 2. ETL jobs 마이그레이션 (26개 파일)

`import { logger } from "@/agent/logger"` 추가 후 `console.log(...)` → `logger.info(TAG, ...)` 교체.
각 파일의 job 이름을 TAG로 사용 (예: `"BUILD_SECTOR_RS"`, `"LOAD_DAILY_PRICES"`).

### 3. 기타 파일 마이그레이션 (4개 파일)

- `src/lib/group-rs.ts` (2회)
- `src/db/migrate.ts` (5회)
- `src/issue-processor/index.ts` (1회)

### 4. `logger.ts` 내부 `console.log` 2회

`logger.ts`의 `info`, `step` 메서드는 내부적으로 `console.log`를 호출한다. 이는 구현부이므로 예외 처리가 아닌 그대로 유지한다 — 완료 조건은 "외부 호출자에서 console.log 0회"이다.

## 작업 계획

### Phase 0: logger.ts 개선 (선행 필수)

**담당**: 구현 에이전트
**완료 기준**:
- `LOG_LEVEL` 환경변수 읽어 레벨 필터 동작
- `debug` 메서드 신설
- 기존 `info/warn/error/step` 시그니처 변경 없음
- 단위 테스트 추가 (각 레벨에서 하위 레벨 억제 검증)

### Phase 1: ETL jobs 마이그레이션 (26개 파일)

**담당**: 구현 에이전트
**파일 목록**:

| 파일 | console.log 횟수 |
|------|-----------------|
| `etl/jobs/validate-data.ts` | 12 |
| `etl/jobs/build-daily-ma.ts` | 10 |
| `etl/jobs/promote-learnings.ts` | 9 |
| `etl/jobs/load-us-symbols.ts` | 9 |
| `etl/jobs/generate-ceo-report.ts` | 9 |
| `etl/jobs/record-new-signals.ts` | 8 |
| `etl/jobs/load-daily-prices.ts` | 8 |
| `etl/jobs/collect-failure-patterns.ts` | 7 |
| `etl/jobs/track-phase-exits.ts` | 6 |
| `etl/jobs/load-ratios.ts` | 6 |
| `etl/jobs/detect-sector-phase-events.ts` | 6 |
| `etl/jobs/verify-theses.ts` | 5 |
| `etl/jobs/update-signal-returns.ts` | 5 |
| `etl/jobs/update-sector-lag-patterns.ts` | 5 |
| `etl/jobs/update-recommendation-status.ts` | 5 |
| `etl/jobs/calculate-daily-ratios.ts` | 5 |
| `etl/jobs/build-sector-rs.ts` | 5 |
| `etl/jobs/build-industry-rs.ts` | 5 |
| `etl/jobs/load-quarterly-financials.ts` | 4 |
| `etl/jobs/cleanup-invalid-symbols.ts` | 4 |
| `etl/jobs/build-stock-phases.ts` | 4 |
| `etl/jobs/build-rs.ts` | 4 |
| `etl/jobs/build-noise-signals.ts` | 3 |
| `etl/jobs/build-breakout-signals.ts` | 3 |
| `etl/jobs/collect-news.ts` | 2 |
| `etl/jobs/cleanup-news-archive.ts` | 2 |

**완료 기준**:
- 26개 파일 모두에서 `console.log` 0회
- 각 파일에 `import { logger } from "@/agent/logger"` 추가
- `logger.info("JOB_TAG", message)` 패턴 일관 적용
- 기존 로그 메시지 내용(문자열) 보존 — 정보 손실 없음

### Phase 2: 기타 파일 마이그레이션 (4개 파일)

**담당**: 구현 에이전트
**파일 목록**:

| 파일 | console.log 횟수 | 비고 |
|------|-----------------|------|
| `db/migrate.ts` | 5 | `"MIGRATE"` 태그 |
| `lib/group-rs.ts` | 2 | `"GROUP_RS"` 태그 |
| `issue-processor/index.ts` | 1 | `"ISSUE_PROCESSOR"` 태그 |

**완료 기준**:
- 3개 파일에서 `console.log` 0회
- logger import 경로는 상대 경로 사용 (각 파일 위치 기준)

### Phase 3: 검증

**담당**: 구현 에이전트
**완료 기준**:
- `grep -rn "console\.log" src/ --include="*.ts" | grep -v "__tests__" | grep -v ".test." | grep -v "logger.ts"` 결과 0건
- `yarn build` 타입 에러 없음
- `yarn test` 통과 (커버리지 80% 이상 유지)
- logger.ts 단위 테스트: `LOG_LEVEL=warn` 설정 시 `info` 호출이 출력되지 않음을 검증

## 리스크

**낮음 — 기계적 치환 작업**

- `console.log` → `logger.info`는 1:1 치환이므로 로직 변경 없음
- logger.ts의 기존 시그니처(`tag: string, message: string`)를 유지하므로 기존 호출자(agent 20개)에 영향 없음
- 단, `step(message)` 메서드는 태그 없는 단일 인자 시그니처 — ETL에서 이 패턴이 나오면 `logger.info("JOB_TAG", message)`로 표준화

**주의 사항**:
- ETL job 일부는 멀티라인 console.log를 사용함 (예: `validate-data.ts` 86번 줄). 단일 logger 호출로 합치거나 두 번 호출로 분리 — 내용 보존이 우선
- `db/migrate.ts`의 `console.log`는 이미 자체 타임스탬프 포맷을 가짐. logger.info로 교체 시 태그만 추가하면 충분

## 의사결정 필요

없음 — 바로 구현 가능.

(logger.ts 개선 범위를 `LOG_LEVEL` 환경변수 기반 레벨 필터로 한정한다. pino/winston 같은 외부 라이브러리 도입은 이번 스코프에서 제외. 현재 codebase 규모에서 오버엔지니어링이다.)

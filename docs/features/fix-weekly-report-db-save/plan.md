# Plan: fix-weekly-report-db-save

## 문제 정의

주간 리포트가 Discord로 발송되지만 DB(`daily_reports` 테이블)에 레코드가 생성되지 않음.
`type = 'weekly'` 행이 0건이라 QA 검증(`validate-weekly-report.sh`)이 불가능.

## 원인

- **일간**: 에이전트가 `save_report_log` 도구 호출 → `saveReportLog()` → DB INSERT → 리뷰 후 `updateReportFullContent()` → DB UPDATE
- **주간**: `save_report_log` 도구가 도구 목록에 있지만 에이전트가 호출하지 않음 → INSERT 없음 → `updateReportFullContent(targetDate, "weekly", fullContent)` UPDATE 대상 행 없음 → 무효

## Before → After

| | Before | After |
|---|---|---|
| DB `type='weekly'` 행 | 0건 | 주간 리포트 실행마다 1건 생성 |
| `validate-weekly-report.sh` | 조회 실패 | 정상 조회 |
| 주간 리포트 품질 이슈 | 미생성 | 자동 생성 |

## 변경 사항

### `src/agent/run-weekly-agent.ts`

리뷰 파이프라인 후, `updateReportFullContent()` 호출 전에 `saveReportLog()`로 DB INSERT를 코드 레벨에서 직접 수행.

일간 에이전트는 에이전트 루프 내에서 `save_report_log` 도구를 호출하여 INSERT하지만, 주간 에이전트는 이 도구를 안정적으로 호출하지 않으므로 **코드 레벨에서 직접 INSERT**하는 방식이 확실함.

INSERT 데이터:
- `reportDate`: targetDate
- `type`: `"weekly"`
- `reportedSymbols`: 빈 배열 (주간 리포트는 요약 리포트이므로 개별 종목 선정이 아님)
- `marketSummary`: 기본값
- `fullContent`: draftsToFullContent 결과

`saveReportLog()`는 `onConflictDoNothing`으로 중복 INSERT를 방지하므로, 에이전트가 도구 호출을 한 경우에도 안전.

## 리스크

- **낮음**: `saveReportLog()`는 `onConflictDoNothing` 사용 → 중복 INSERT 안전
- **낮음**: 파일 백업도 함께 생성되므로 데이터 유실 없음

## 골 정렬

- **ALIGNED**: QA 파이프라인 복구 → 주간 리포트 품질 자동 검증 → 리포트 신뢰도 향상
- **무효 판정**: N/A (버그픽스, 무효 판정 대상 아님)

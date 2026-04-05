# 구현 계획 — 주간 리포트 HTML 전환 + 섹션 구조 개편

GitHub Issue: #631

## Phase 1: 발행 파이프라인 수정

### 커밋 1-1: reportPublisher.ts — weekly 경로 지원

- 변경 파일: `src/lib/reportPublisher.ts`
- 내용: `publishHtmlReport(html, date, type?)` — `type: "daily" | "weekly"` 파라미터 추가. 기본값 `"daily"`. `"weekly"` 시 `weekly/{date}/index.html` 경로로 push.
- 완료 기준: 기존 일간 호출 무변경. `type: "weekly"` 시 `weekly/` 경로로 push 성공.
- 테스트: `publishHtmlReport` type 파라미터 유닛 테스트

### 커밋 1-2: reviewAgent.ts — reportType 전달

- 변경 파일: `src/agent/reviewAgent.ts`
- 내용: `tryPublishHtmlReport`에 `reportType` 파라미터 추가. `runReviewPipeline`이 `options.reportType`을 전달.
- 완료 기준: `reportType: "weekly"` 시 `publishHtmlReport(html, date, "weekly")` 호출.
- 테스트: 기존 테스트 통과 확인 (인터페이스 확장만)

## Phase 2: 업종 RS 주간 변화 쿼리 추가

의존성: 없음 (Phase 1과 병렬 가능)

### 커밋 2-1: sectorRepository — findIndustriesWeeklyChange 쿼리

- 변경 파일: `src/db/sectorRepository.ts` (또는 해당 레포지토리 파일)
- 내용: `findIndustriesWeeklyChange(date, prevWeekDate, limit)` 쿼리 추가. `industry_rs_daily` 테이블에서 현재 주 RS와 전주 RS의 차이(`changeWeek`)를 계산하여 변화량 내림차순 정렬.
- 완료 기준: 쿼리가 `changeWeek` 포함 결과 반환.
- 테스트: 쿼리 결과 구조 유닛 테스트

### 커밋 2-2: getLeadingSectors 도구 — changeWeek 필드 추가

- 변경 파일: `src/tools/getLeadingSectors.ts`
- 내용: `mode: "industry"` 호출 시 내부적으로 전주 날짜 조회 후 `findIndustriesWeeklyChange` 사용. 반환에 `changeWeek` 필드 포함.
- 완료 기준: `get_leading_sectors(mode: "industry")` 반환에 `changeWeek` 필드 존재.
- 테스트: 도구 반환 구조 테스트

## Phase 3: 주간 에이전트 + 프롬프트 재설계

의존성: Phase 1, Phase 2 완료 후

### 커밋 3-1: buildWeeklySystemPrompt() 전면 재작성

- 변경 파일: `src/agent/systemPrompt.ts`
- 내용: 기존 5섹션(시장구조/관심종목궤적/등록해제/Thesis적중률/시스템성과)을 신규 5섹션으로 교체:
  1. 주간 시장 구조 변화 (기존 + 업종 RS 참조 추가)
  2. 업종 RS 주간 변화 Top 10 (신규 — changeWeek 기준 정렬, 섹터당 제한 없음)
  3. 관심종목 궤적 (기존 + 서사 유효성 보강)
  4. 신규 관심종목 등록/해제 (기존 유지)
  5. 다음 주 관전 포인트 (신규 — Phase 1 후기→2 임박, RS 가속 업종, thesis 시나리오)
- Discord 발송: 단일 `send_discord_report` 호출 (요약 메시지 + `markdownContent`에 전체 리포트)
- 완료 기준: 프롬프트에 5개 섹션 워크플로우 + 리포트 포맷 + 규칙 포함.
- 테스트: 로컬 1회 실행으로 5개 섹션 출력 확인

### 커밋 3-2: run-weekly-agent.ts — date 전달 + reportType 추가

- 변경 파일: `src/agent/run-weekly-agent.ts`
- 내용:
  - `runReviewPipeline` 호출 시 `{ date: targetDate, reportType: "weekly" }` 전달 (기존 date 누락 버그 수정 포함)
  - Discord 발송 방식 변경에 따른 draft 처리 조정
- 완료 기준: 주간 실행 후 GitHub Pages에 `weekly/{date}/` HTML 발행 + Discord에 요약+링크 메시지 발송.
- 테스트: 로컬 실행 통합 테스트

## 의존성 요약

```
Phase 1 ──┐
           ├──→ Phase 3
Phase 2 ──┘
```

Phase 1과 Phase 2는 독립적이므로 병렬 실행 가능.

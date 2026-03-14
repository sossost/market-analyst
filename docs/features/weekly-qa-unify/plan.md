# Weekly QA 통일 — 이슈 #215

## 선행 맥락

- **qa-normalization (PR 미상)**: `run-weekly-qa.ts`와 크론 등록을 정상화. 현재 주간 QA는 GitHub Actions + 파일 저장(`data/qa-reports/`) + Discord 발송 구조로 동작 중.
- **daily-report-qa**: `dailyQA.ts`는 라이브러리로 설계되어 리뷰 파이프라인 내에서 호출됨. 결과를 반환만 하며 알림/저장을 스스로 하지 않음.
- **report-pipeline-map** (`memory/report_pipeline_map.md`): 투자브리핑 채널(`DISCORD_DEBATE_WEBHOOK_URL`)은 토론 요약·주간 리포트 발송 전용 채널. 주간 QA가 이 채널에 발송되면서 노이즈 발생.
- **daily-report-quality-guard (이슈 #200)**: `dailyQA`의 mismatch severity 기준을 `run-daily-agent.ts`에서 처리하는 방식 — QA 모듈 자체는 순수하게 결과만 반환, 알림은 호출부가 담당하는 패턴이 이미 확립됨.

## 골 정렬

**SUPPORT** — 간접 기여. 주간 QA 자체는 시스템 건강도 점검이 목적이므로 초입 포착에 직접 기여하지 않는다. 그러나 QA 결과가 투자브리핑 채널에 노이즈를 발생시키면 실제 투자 신호가 희석된다. 노이즈 제거 + 구조 통일은 운영 품질 향상에 기여한다.

## 문제

주간 QA(`run-weekly-qa.ts`)가 독립 스크립트로 구현되어 있어 다음 문제가 발생한다:

1. **Discord 직접 발송**: Claude API 분석 결과를 투자브리핑 채널(`DISCORD_DEBATE_WEBHOOK_URL`)에 직접 발송 → 채널 노이즈
2. **파일 저장만**: 결과가 `data/qa-reports/YYYY-MM-DD.md`에만 저장. DB 적재 없어서 대시보드/쿼리 접근 불가
3. **패턴 불일치**: `dailyQA.ts`는 라이브러리 패턴(결과 반환), `run-weekly-qa.ts`는 독립 스크립트 패턴(직접 발송). 두 QA 모듈이 다른 방식으로 동작

## Before → After

**Before**
- `run-weekly-qa.ts`: 독립 실행 → Claude API 분석 → `data/qa-reports/` 파일 저장 → Discord 투자브리핑 채널 발송
- DB: 주간 QA 결과 미저장
- 채널 노이즈: 주간 QA 요약이 투자 시그널과 혼재

**After**
- `run-weekly-qa.ts`: 독립 실행 → Claude API 분석 → DB 적재(`weekly_qa_reports` 테이블) → 파일 저장 유지(하위 호환) → Discord 발송 **제거**
- DB: `weekly_qa_reports` 테이블 신설, 날짜별 QA 결과 보존
- 이상 감지 시: GitHub 이슈 자동 생성 (종합 점수 6 미만 또는 의사결정 필요 사항 발견 시)
- 투자브리핑 채널: 주간 QA 노이즈 제거

## 변경 사항

### 1. DB 스키마 신설 — `src/db/schema/analyst.ts`

기존 테이블에 `weekly_qa_reports` 추가:

```typescript
export const weeklyQaReports = pgTable(
  "weekly_qa_reports",
  {
    id: serial("id").primaryKey(),
    qaDate: text("qa_date").notNull(),           // YYYY-MM-DD (실행일)
    score: integer("score"),                      // 종합 점수 (0~10), null이면 파싱 실패
    fullReport: text("full_report").notNull(),    // Claude 생성 전체 텍스트
    ceoSummary: text("ceo_summary"),             // "CEO 보고 요약" 섹션 추출
    needsDecision: boolean("needs_decision")      // 의사결정 필요 여부
      .notNull()
      .default(false),
    tokensInput: integer("tokens_input"),
    tokensOutput: integer("tokens_output"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    uqDate: unique("uq_weekly_qa_reports_date").on(t.qaDate),
    idxDate: index("idx_weekly_qa_reports_date").on(t.qaDate),
  }),
);
```

### 2. Drizzle 마이그레이션 생성

```bash
yarn drizzle-kit generate
```

새 마이그레이션 파일 생성 후 `yarn drizzle-kit migrate` 실행.

### 3. `run-weekly-qa.ts` 수정

**제거:**
- `sendDiscordMessage` 호출 전체 (단계 [5/5] Discord 발송 블록)
- `createGist` 호출 (Discord 발송용이므로 함께 제거)
- `sanitizeDiscordMentions` 함수 (Discord 미사용 시 불필요)
- `extractCeoSummary`, `extractScore` 함수는 DB 적재에 재사용하므로 유지
- `import { sendDiscordMessage, sendDiscordError }` 중 `sendDiscordMessage` 제거
- `import { createGist }` 제거
- 환경변수 검증에서 `DISCORD_DEBATE_WEBHOOK_URL` 관련 분기 제거

**추가:**
- DB 적재 함수 `saveToDb(qaDate, report, tokens)`:
  - `pool.query()` 또는 drizzle insert로 `weekly_qa_reports`에 upsert
  - `score`: `extractScore(report)` 파싱 결과 (실패 시 null)
  - `ceoSummary`: `extractCeoSummary(report)` 결과
  - `needsDecision`: "의사결정 필요" 섹션에 "없음" 외 내용이 있으면 true
- GitHub 이슈 자동 생성 `maybeCreateGithubIssue(score, ceoSummary)`:
  - 조건: score < 6 OR needsDecision === true
  - `gh issue create --label "qa,weekly"` (환경변수 `GH_TOKEN` 또는 `GITHUB_TOKEN` 필요)
  - 실패 시 warn 로그만 (이슈 생성 실패가 전체 실행을 막지 않음)

**수정:**
- `main()` 단계 레이블 변경: `[5/5] Discord 발송...` → `[5/5] DB 적재...`
- `validateEnvironment()`: `DATABASE_URL`, `ANTHROPIC_API_KEY`만 필수로 유지 (Discord 웹훅 불필요)

**유지:**
- 파일 저장 로직 (`data/qa-reports/YYYY-MM-DD.md`) — 하위 호환 목적
- `sendDiscordError` — fatal 에러 시 에러 채널 발송은 유지 (운영 모니터링 목적)
- `collectData()`, `buildUserPrompt()`, `SYSTEM_PROMPT` — 변경 없음

**단계별 흐름 (수정 후):**
```
[1/5] 환경변수 검증
[2/5] 데이터 수집
[3/5] Claude API 분석
[4/5] 리포트 파일 저장
[5/5] DB 적재 + (조건부) GitHub 이슈 생성
```

### 4. DB import 추가 — `run-weekly-qa.ts`

```typescript
import { db } from "@/db/client";  // drizzle 인스턴스 (pool과 별도)
import { weeklyQaReports } from "@/db/schema/analyst";
```

단, 현재 `run-weekly-qa.ts`는 `pool` 직접 사용 패턴. 일관성을 위해 기존처럼 `pool.query()`로 raw INSERT 사용 가능:

```typescript
await pool.query(
  `INSERT INTO weekly_qa_reports
     (qa_date, score, full_report, ceo_summary, needs_decision, tokens_input, tokens_output)
   VALUES ($1, $2, $3, $4, $5, $6, $7)
   ON CONFLICT (qa_date) DO UPDATE SET
     score = EXCLUDED.score,
     full_report = EXCLUDED.full_report,
     ceo_summary = EXCLUDED.ceo_summary,
     needs_decision = EXCLUDED.needs_decision,
     tokens_input = EXCLUDED.tokens_input,
     tokens_output = EXCLUDED.tokens_output`,
  [qaDate, score, report, ceoSummary, needsDecision, tokensInput, tokensOutput],
);
```

## DB 스키마 변경 필요 여부

**신규 테이블 필요**: 현재 스키마에 `weekly_qa_reports`에 해당하는 테이블이 없다.

기존 `daily_reports` 테이블을 재사용하는 방법도 검토했으나:
- `daily_reports`는 `reported_symbols`, `market_summary` 같은 구조화된 추천 데이터를 위한 스키마. 주간 QA는 성격이 다름 (분석 리포트 텍스트 + QA 점수).
- `type = 'weekly_qa'`로 끼워넣기 가능하지만, `reported_symbols`와 `market_summary`가 `notNull()`이어서 빈 값을 강제 삽입해야 함. 의미론적 오염이 크다.

결론: 신규 테이블 `weekly_qa_reports` 생성이 올바른 접근.

## 작업 계획

| 단계 | 파일 | 내용 | 완료 기준 |
|------|------|------|----------|
| 1 | `src/db/schema/analyst.ts` | `weeklyQaReports` 테이블 정의 추가 | TypeScript 컴파일 통과 |
| 2 | `db/migrations/` | `yarn drizzle-kit generate` → 마이그레이션 파일 생성 | 파일 생성 확인 |
| 3 | `run-weekly-qa.ts` | Discord 발송 블록 + Gist 로직 제거 | diff 확인 |
| 4 | `run-weekly-qa.ts` | `saveToDb()` 함수 구현 + main() 통합 | 로컬 실행 dry-run 확인 |
| 5 | `run-weekly-qa.ts` | `maybeCreateGithubIssue()` 구현 (score < 6 조건) | 로직 확인 |
| 6 | 마이그레이션 실행 | `yarn drizzle-kit migrate` (Supabase 적용) | DB 테이블 생성 확인 |

단계 1·2는 순차. 단계 3·4·5는 동일 파일 수정이므로 순차. 단계 6은 단계 2 완료 후 진행.

## 리스크

- **GitHub 이슈 생성 권한**: `GH_TOKEN`이 GitHub Actions 환경에서는 자동 제공되지만, 맥미니 launchd 실행 시에는 별도 설정 필요. 이슈 생성 실패는 warn 처리로 전체 실행에 영향 없음.
- **`sendDiscordError` 유지**: fatal 에러 시에는 여전히 에러 채널(`DISCORD_ERROR_WEBHOOK_URL`)로 발송. 에러 채널은 노이즈 문제가 없으므로 유지가 맞음.
- **파일 저장 병행**: `data/qa-reports/` 저장은 유지. DB 적재 실패 시 파일은 남아 있으므로 데이터 손실 없음.
- **마이그레이션 적용 타이밍**: 코드 배포 전 마이그레이션 적용 필요. GitHub Actions에서 마이그레이션 미실행 시 `weekly_qa_reports` INSERT 실패. 배포 순서: 마이그레이션 먼저 → 코드 배포.

## 의사결정 필요

없음 — 바로 구현 가능.

# Plan: 공용 유틸(discord, gist, reportLog, reviewFeedback) src/agent/ → src/lib/ 분리

**이슈:** #386
**유형:** Lite 트랙 (구조 이동, 기능 변경 없음)
**골 정렬:** SUPPORT — Phase 2 주도섹터/주도주 포착과 직접 관련 없음. PR #384(agent-module-separation) 리팩터링의 미완성 부분을 완결하여 순환 의존성을 제거하고 모듈 경계를 명확히 함.
**무효 판정:** 해당 없음

---

## 선행 맥락

PR #384 (`agent-module-separation`)에서 `src/agent/` 하위 debate/, tools/, fundamental/, corporateAnalyst/, lib/ 도메인을 분리했다. 그러나 공용 유틸 4개(discord, gist, reportLog, reviewFeedback)가 `src/agent/`에 잔류하여, 이미 분리된 `src/tools/`와 `src/fundamental/`이 `@/agent/`를 역방향 import하는 순환 의존성이 발생했다.

---

## 문제

`src/tools/`, `src/fundamental/`이 `@/agent/discord`, `@/agent/gist`, `@/agent/reportLog`, `@/agent/reviewFeedback`를 import한다. 이 4개 파일은 에이전트 오케스트레이션 로직이 없는 순수 I/O 유틸리티임에도 `src/agent/`에 위치하여 잘못된 계층 의존이 형성되어 있다.

---

## Before → After

### Before
```
src/agent/
├── discord.ts          ← src/tools/, src/fundamental/, src/etl/에서 import
├── gist.ts             ← src/tools/, src/fundamental/에서 import
├── reportLog.ts        ← src/tools/에서 import
├── reviewFeedback.ts   ← src/fundamental/에서 import
└── ...

src/tools/sendDiscordReport.ts  → @/agent/discord, @/agent/gist    (역방향 의존)
src/tools/saveReportLog.ts      → @/agent/reportLog                 (역방향 의존)
src/tools/readReportHistory.ts  → @/agent/reportLog                 (역방향 의존)
src/fundamental/stockReport.ts  → @/agent/discord, @/agent/gist    (역방향 의존)
src/fundamental/stockReportQA.ts → @/agent/reviewFeedback           (역방향 의존)
src/etl/jobs/generate-ceo-report.ts → @/agent/discord              (역방향 의존)
```

### After
```
src/lib/
├── discord.ts          ← 이동 완료
├── gist.ts             ← 이동 완료
├── reportLog.ts        ← 이동 완료
├── reviewFeedback.ts   ← 이동 완료
└── ...

src/agent/discord.ts    → 삭제
src/agent/gist.ts       → 삭제
src/agent/reportLog.ts  → 삭제
src/agent/reviewFeedback.ts → 삭제

모든 import 경로: @/agent/* → @/lib/*
```

**완료 기준:** `grep -r "from.*@/agent/discord\|from.*@/agent/gist\|from.*@/agent/reportLog\|from.*@/agent/reviewFeedback" src/ --include="*.ts"` 결과 0건.

---

## 변경 사항

### 1. 파일 이동 (4개)
| 원본 | 이동 대상 | 내부 의존성 |
|------|----------|------------|
| `src/agent/discord.ts` | `src/lib/discord.ts` | `@/lib/logger` (변경 없음) |
| `src/agent/gist.ts` | `src/lib/gist.ts` | `@/lib/logger` (변경 없음) |
| `src/agent/reportLog.ts` | `src/lib/reportLog.ts` | `@/types`, `@/db/client`, `@/db/schema/analyst`, `@/lib/logger` (변경 없음) |
| `src/agent/reviewFeedback.ts` | `src/lib/reviewFeedback.ts` | `@/lib/logger` (변경 없음) |

4개 파일 모두 내부에서 `@/agent/` 경로를 참조하지 않으므로 파일 내용 수정 없이 이동만으로 완결된다.

### 2. import 경로 업데이트 (8개 파일)

**src/tools/ (3개 파일)**
| 파일 | Before | After |
|------|--------|-------|
| `sendDiscordReport.ts` | `@/agent/discord`, `@/agent/gist` | `@/lib/discord`, `@/lib/gist` |
| `saveReportLog.ts` | `@/agent/reportLog` | `@/lib/reportLog` |
| `readReportHistory.ts` | `@/agent/reportLog` | `@/lib/reportLog` |

**src/fundamental/ (2개 파일 + 테스트 1개)**
| 파일 | Before | After |
|------|--------|-------|
| `stockReport.ts` | `@/agent/discord`, `@/agent/gist` | `@/lib/discord`, `@/lib/gist` |
| `stockReportQA.ts` | `@/agent/reviewFeedback` | `@/lib/reviewFeedback` |
| `__tests__/stockReportQA.test.ts` | `@/agent/reviewFeedback` | `@/lib/reviewFeedback` |

**src/etl/ (1개 파일)**
| 파일 | Before | After |
|------|--------|-------|
| `jobs/generate-ceo-report.ts` | `@/agent/discord` | `@/lib/discord` |

**src/agent/ — 상대경로 사용처 (4개 파일, 절대경로로 전환)**
| 파일 | Before | After |
|------|--------|-------|
| `reviewAgent.ts` | `"./discord"`, `"./gist"`, `"./reviewFeedback"` | `@/lib/discord`, `@/lib/gist`, `@/lib/reviewFeedback` |
| `run-debate-agent.ts` | `"./discord"`, `"./gist"`, `"./reportLog"` (dynamic) | `@/lib/discord`, `@/lib/gist`, `@/lib/reportLog` |
| `run-daily-agent.ts` | `"./discord"`, `"./reportLog"` (dynamic) | `@/lib/discord`, `@/lib/reportLog` |
| `run-weekly-agent.ts` | `"./discord"`, `"./reportLog"` (dynamic) | `@/lib/discord`, `@/lib/reportLog` |
| `run-weekly-qa.ts` | `"./discord"` | `@/lib/discord` |
| `run-corporate-analyst.ts` | `"./discord"` | `@/lib/discord` |
| `systemPrompt.ts` | `"./reviewFeedback"` | `@/lib/reviewFeedback` |

### 3. 원본 파일 삭제 (4개)
이동 완료 후 `src/agent/discord.ts`, `src/agent/gist.ts`, `src/agent/reportLog.ts`, `src/agent/reviewFeedback.ts` 삭제.

---

## 작업 계획

| 단계 | 내용 | 완료 기준 |
|------|------|----------|
| 1 | `src/lib/`에 4개 파일 복사 (내용 그대로) | `ls src/lib/discord.ts src/lib/gist.ts src/lib/reportLog.ts src/lib/reviewFeedback.ts` 존재 확인 |
| 2 | `src/agent/` 내부 상대경로 import를 `@/lib/` 절대경로로 전환 (7개 파일) | `grep -r '"./discord"\|"./gist"\|"./reportLog"\|"./reviewFeedback"' src/agent/` 0건 |
| 3 | `src/tools/`, `src/fundamental/`, `src/etl/`의 `@/agent/*` import를 `@/lib/*`으로 교체 | `grep -r "@/agent/discord\|@/agent/gist\|@/agent/reportLog\|@/agent/reviewFeedback" src/` 0건 |
| 4 | `src/agent/` 원본 4개 파일 삭제 | `ls src/agent/discord.ts` → 파일 없음 |
| 5 | `npx tsc --noEmit` 컴파일 에러 0건 검증 | TypeScript 컴파일 통과 |
| 6 | `npx vitest run` 전체 테스트 통과 검증 | 테스트 통과, 커버리지 80% 이상 |

---

## 리스크

| 리스크 | 평가 | 대응 |
|--------|------|------|
| dynamic import 경로 누락 | 낮음 | `run-debate-agent.ts`, `run-daily-agent.ts`, `run-weekly-agent.ts`의 dynamic `import("./reportLog")`를 grep으로 사전 식별 완료. 단계 2에서 처리. |
| src/agent/ 내 추가 참조 | 낮음 | 사전 grep 결과: `reviewAgent.ts`, `run-debate-agent.ts`, `run-daily-agent.ts`, `run-weekly-agent.ts`, `run-weekly-qa.ts`, `run-corporate-analyst.ts`, `systemPrompt.ts` 총 7개 파일 식별 완료 |
| src/lib/ 파일명 충돌 | 없음 | `src/lib/`에 discord.ts, gist.ts, reportLog.ts, reviewFeedback.ts 없음 확인 완료 |
| 기능 변경 | 없음 | 파일 내용 수정 없이 경로만 이동. 4개 파일 모두 내부 의존성이 `@/lib/`만 사용하므로 재작성 불필요 |

---

## 의사결정 필요

없음 — 바로 구현 가능.

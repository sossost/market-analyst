# 이슈 #120 구현 계획: 리포트 DB 마이그레이션 (파일 → DB)

**이슈**: #120
**연관 스펙**: `docs/features/report-debate-archive/01-spec.md`
**작성일**: 2026-03-09

---

## 선행 맥락

없음 — 신규 이슈. 단, F8 아카이빙 대시보드의 백엔드 선행 작업으로 식별됨.

## 골 정렬

**SUPPORT** — 직접 알파를 형성하지는 않으나, F8 대시보드(리포트 열람)의 필수 인프라.
대시보드 없이는 과거 리포트 맥락 추적이 불가능하므로 주도주 발굴 품질 개선에 간접 기여.

---

## 문제

현재 리포트가 `data/reports/{date}.json` 파일로만 저장되어 있어, 대시보드에서 열람하거나
API로 제공할 수 없다. DB에 저장되어야 프론트엔드 `/reports` 페이지가 동작할 수 있다.

## Before → After

**Before**
- `saveReportLog()` → `data/reports/YYYY-MM-DD.json` 파일 저장
- `readReportLogs(daysBack)` → 파일 시스템 순회하여 반환
- 현존 파일: `data/reports/2026-02-20.json` (1개 확인)
- 프론트엔드: `daily_reports` 테이블 없음 → 리포트 페이지 동작 불가

**After**
- `saveReportLog()` → DB `daily_reports` 테이블에 저장 (파일도 백업으로 유지)
- `readReportLogs(daysBack)` → DB에서 조회
- 기존 JSON 파일 전수 DB 이관 완료
- 프론트엔드: `daily_reports` 테이블 조회로 리포트 목록/상세 동작

---

## JSON 파일 구조 분석

`data/reports/2026-02-20.json` 기준:

```json
{
  "date": "2026-02-20",                   // YYYY-MM-DD
  "reportedSymbols": [                    // ReportedStock[]
    {
      "symbol": "LITE",
      "phase": 2,
      "rsScore": 98,
      "sector": "Technology",
      "industry": "Communication Equipment",
      "reason": "...",
      "firstReportedDate": "2026-02-20"
      // prevPhase 필드는 없을 수 있음 (선택적)
    }
  ],
  "marketSummary": {
    "phase2Ratio": 0,
    "leadingSectors": ["Energy", "Basic Materials", ...],
    "totalAnalyzed": 30
  },
  "metadata": {
    "model": "claude-opus-4-6",
    "tokensUsed": { "input": 0, "output": 0 },
    "toolCalls": 0,
    "executionTime": 0
  }
}
```

**타입 정의 위치**: `src/types/index.ts` — `DailyReportLog` 인터페이스

### 주간 리포트 대응

주간 에이전트(`run-weekly-agent.ts`)도 `saveReportLogTool`을 사용한다.
단, `DailyReportLog.type` 필드가 현재 **타입 정의에 없다**.
`01-spec.md`는 `type: 'daily' | 'weekly'` 컬럼을 요구하므로,
테이블에는 `type` 컬럼을 두되, 기존 파일에서 마이그레이션 시 기본값 `'daily'`를 적용하고,
에이전트 저장 시 호출 컨텍스트(일간/주간)에 따라 `type`을 전달하도록 수정한다.

**현존 파일의 type 판별**: 파일명이 모두 날짜 기반이고 type 필드가 없으므로,
마이그레이션 스크립트에서 주간 에이전트가 실행되는 요일(월요일 = 주간 리포트)로
추정하거나, 일괄 `'daily'`로 처리한다. **현실적으로 현존 파일 1개이므로 `'daily'`로 일괄 처리.**

---

## 변경 사항 (파일별)

### 신규 파일

| 파일 | 역할 |
|------|------|
| `src/db/schema/analyst.ts` | `dailyReports` 테이블 정의 추가 (기존 파일 내 append) |
| `db/migrations/0016_daily_reports.sql` | Drizzle 생성 마이그레이션 |
| `scripts/migrate-reports-to-db.ts` | JSON 파일 → DB 일괄 이관 스크립트 |

### 수정 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/agent/reportLog.ts` | `saveReportLog`: DB 저장 추가 (파일 백업 유지). `readReportLogs`: DB 우선 조회, fallback 파일 |
| `src/agent/tools/saveReportLog.ts` | `type` 파라미터 추가 (`'daily' \| 'weekly'`, 기본값 `'daily'`) |
| `src/agent/run-weekly-agent.ts` | `saveReportLogTool` 호출 시 `type: 'weekly'` 전달 |
| `src/types/index.ts` | `DailyReportLog`에 `type?: 'daily' \| 'weekly'` 필드 추가 |

---

## 작업 계획

### Phase 1: DB 스키마 + 마이그레이션 (독립 커밋)

**담당**: 실행팀 — 백엔드 구현

**작업**:
1. `src/db/schema/analyst.ts`에 `dailyReports` 테이블 추가:
   ```
   id: serial PK
   report_date: text NOT NULL (YYYY-MM-DD, UNIQUE)
   type: text NOT NULL DEFAULT 'daily'   -- 'daily' | 'weekly'
   reported_symbols: jsonb NOT NULL       -- ReportedStock[]
   market_summary: jsonb NOT NULL         -- { phase2Ratio, leadingSectors, totalAnalyzed }
   full_content: text                     -- 현재 없음, 향후 마크다운 저장용
   metadata: jsonb NOT NULL               -- { model, tokensUsed, toolCalls, executionTime }
   created_at: timestamptz DEFAULT now()
   ```
   인덱스: `report_date` (UNIQUE constraint), `type` + `report_date` 복합

2. `yarn drizzle-kit generate` 실행 → `0016_daily_reports.sql` 생성

3. Supabase에 마이그레이션 적용 (`yarn drizzle-kit migrate` 또는 Supabase 대시보드 직접 실행)

**완료 기준**:
- `0016_daily_reports.sql` 생성됨
- Supabase에 `daily_reports` 테이블 존재 확인 (`yarn drizzle-kit studio` 또는 Supabase 대시보드)

---

### Phase 2: 저장/조회 로직 DB 전환 (독립 커밋)

**담당**: 실행팀 — 백엔드 구현

**작업**:
1. `src/types/index.ts` — `DailyReportLog`에 `type?: 'daily' | 'weekly'` 추가

2. `src/agent/reportLog.ts` 수정:

   **`saveReportLog`**:
   - 기존 파일 저장 로직 유지 (백업)
   - DB `daily_reports` upsert 추가 (conflict on `report_date` → update)
   - DB 저장 실패 시 에러 로그만 남기고 계속 진행 (파일은 이미 저장됨)

   **`readReportLogs`**:
   - DB 우선 조회 (`ORDER BY report_date DESC LIMIT daysBack`)
   - DB 결과 없으면 기존 파일 시스템 fallback
   - DB 조회 실패 시 파일 시스템 fallback

3. `src/agent/tools/saveReportLog.ts` 수정:
   - `input_schema`에 `type` 파라미터 추가 (`'daily' | 'weekly'`, 선택적, 기본 `'daily'`)
   - `reportWithMetadata`에 `type` 포함

4. `src/agent/run-weekly-agent.ts` 수정:
   - `saveReportLogTool` 호출 시 에이전트 지시문에 `type: 'weekly'` 명시

**완료 기준**:
- `yarn agent:daily` 실행 후 `daily_reports` 테이블에 레코드 삽입 확인
- `read_report_history` 툴 호출 시 DB에서 올바른 데이터 반환
- 기존 테스트 전체 통과

---

### Phase 3: 기존 JSON 파일 DB 이관 스크립트 (독립 커밋)

**담당**: 실행팀 — 백엔드 구현

**작업**:
1. `scripts/migrate-reports-to-db.ts` 작성:
   ```
   1. data/reports/*.json 파일 전체 목록 수집
   2. 각 파일 파싱 → DailyReportLog 타입 검증
   3. daily_reports 테이블에 upsert (conflict on report_date → skip or update)
   4. 성공/실패 건수 로그
   5. 파싱 실패 파일은 data/reports/failed/ 로 이동
   ```

2. `package.json`에 스크립트 등록:
   ```json
   "migrate:reports": "tsx scripts/migrate-reports-to-db.ts"
   ```

3. 스크립트 실행 + 결과 검증

**완료 기준**:
- `yarn migrate:reports` 실행 후 기존 JSON 파일 수 == DB 레코드 수 일치
- 맥미니 서버에서도 동일하게 실행 가능 (SSH 실행 지시 포함)

---

### Phase 4: 테스트 보강 (Phase 2~3 완료 후 커밋)

**담당**: 실행팀 — 테스트

**작업**:
1. `src/agent/reportLog.ts` 테스트 추가:
   - DB 저장 성공 케이스 (mock DB)
   - DB 저장 실패 시 파일 백업 유지 케이스
   - DB 조회 성공 케이스
   - DB 조회 실패 시 파일 fallback 케이스

2. `scripts/migrate-reports-to-db.ts` 테스트:
   - 유효 JSON 이관 성공 케이스
   - 파싱 실패 파일 격리 케이스

**완료 기준**:
- 테스트 커버리지 80% 이상 유지
- `yarn test` 전체 통과

---

## 리스크

| 항목 | 내용 | 대응 |
|------|------|------|
| 파일 없는 날 처리 | `data/reports/`에 파일이 1개뿐 → 이관 후 DB도 1건 | 정상. 스크립트가 "이관 완료 1건" 로그 출력 |
| `full_content` 없음 | 기존 JSON에 전체 리포트 텍스트 없음 | `null`로 저장. 향후 에이전트 응답 원문 저장 시 추가 |
| 주간 리포트 type 판별 | 기존 파일에 type 정보 없음 | 현존 파일 전수 `'daily'`로 이관. 주간 에이전트 수정 후 신규 실행분부터 `'weekly'` 적용 |
| DB 저장 실패 시 서비스 중단 | 에이전트가 DB 오류로 멈추면 안 됨 | DB 저장 실패는 경고 로그만. 파일 백업이 항상 먼저 완료됨 |
| 맥미니 서버 마이그레이션 | 맥미니에도 기존 파일이 있을 수 있음 | `yarn migrate:reports` SSH로 맥미니에도 실행 필요 |
| `report_date` 컬럼 타입 | `date` vs `text` — 기존 스키마 패턴이 `text` 사용 | `text`로 통일 (기존 패턴 준수, 예: `recommendations.recommendationDate`) |

## 의사결정 필요

없음 — 바로 구현 가능.

단, 아래 사항은 구현 중 확인 필요:
- 맥미니 `data/reports/` 디렉토리에 추가 파일이 있는지 SSH로 확인 후 이관 실행

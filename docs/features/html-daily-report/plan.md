# HTML 일간 리포트 (이슈 #605 — 3~6번)

## 선행 맥락

PR #606에서 1~2번(프롬프트 섹션 재배치, 섹터 RS 표 컬럼 순서) 완료.
`sample-report.html`이 실데이터 기반 HTML 프로토타입으로 프로젝트 루트에 존재.
현재 발송 파이프라인: `markdownContent` → GitHub Gist 생성 → Discord에 Gist URL 포함 메시지 발송.
Supabase `@supabase/supabase-js` 패키지가 없음 — 신규 추가 필요.
`marked` 패키지도 없음 — 신규 추가 필요.

## 골 정렬

SUPPORT — HTML 리포트는 Phase 2 포착 알파 자체가 아니라, 분석 결과를 더 명확하게
전달하는 인프라 개선. 가독성 향상 → 판단 속도 향상 → 간접 기여.

## 문제

일간 브리핑이 GitHub Gist 마크다운으로 발송되어 모바일 가독성이 낮고, 섹터/업종 RS
테이블과 Phase 분포 시각화가 텍스트로만 표현된다. 에이전트가 생성하는 구조적 데이터
(업종 RS Top 10, 시장 레짐, BreadthScore)도 현재 리포트에 미포함.

## Before → After

**Before**: 에이전트 MD 생성 → GitHub Gist 업로드 → Discord에 Gist URL 발송.
업종 RS Top 10 미포함, 시장 레짐 미표시, BreadthScore 미표시.

**After**: 에이전트 MD 생성 (업종 RS Top 10 + 레짐 + BreadthScore 포함) →
marked로 HTML 변환 + 커스텀 CSS 래핑 → Supabase Storage 업로드 → Discord에
퍼블릭 URL 발송. GitHub Gist 발송 코드 제거.

## 변경 사항

### Phase 1 — 프롬프트 추가 개선 (에이전트 지시 확장)

파일: `src/agent/systemPrompt.ts` (또는 daily 프롬프트 파일)

1. **P2 비율 전일 변화량 표 포함 지시**
   - 섹터 RS 마크다운 표에 `△P2` 컬럼 추가 지시
   - `get_leading_sectors`의 `phase2Ratio`와 전일 비교값은 이미 `daily` 모드 응답에 없음
   - 단, `get_market_breadth`의 `phase2RatioChange`(시장 전체)는 이미 존재
   - 섹터별 P2 비율 전일 변화는 현재 DB/도구에서 직접 조회 불가 — 프롬프트에서 "당일 P2비율만 표기, 전일 비교는 시장 전체 기준으로 한정"으로 지시 범위 명확화

2. **업종 RS Top 10 테이블 추가 지시**
   - `get_leading_sectors` `mode=industry`를 호출하여 상위 10개 업종 테이블 생성 지시
   - 컬럼: 순위, 업종명, 소속섹터, RS, 4주 변화, Phase, P2 비율
   - 위치: 섹터 RS 표 바로 아래

3. **시장 레짐 표시 지시**
   - `get_market_breadth` 응답에는 레짐 정보 없음 → 별도 조회 필요
   - 방법: run-daily-agent.ts에서 `loadConfirmedRegime()`로 레짐 사전 로드 → systemPrompt에 주입
   - 프롬프트 지시: "시장 온도 섹션에 레짐(5단계) + 레짐 시작일을 표기"
   - 에이전트 도구 추가보다 사전 로드 방식이 간단하고 안전 (토론 에이전트의 기존 패턴과 동일)

4. **BreadthScore 표시 지시**
   - `get_market_breadth` 응답의 `breadthScore` 필드는 이미 존재 (null 가능)
   - 프롬프트에 "브레드스 stat 행에 BreadthScore(퍼센타일) 수치 포함" 지시 추가

### Phase 2 — HTML 템플릿 엔진

파일: `src/lib/htmlReport.ts` (신규)

의존성 추가: `marked` (MD → HTML 변환)

1. **마크다운 → HTML 변환**
   - `marked.parse(markdownContent)` 호출
   - 마크다운 테이블, 헤더, 볼드, 리스트 → 표준 HTML 태그로 변환

2. **HTML 래퍼 템플릿**
   - `sample-report.html`의 CSS를 인라인 `<style>` 블록으로 포함
   - CSS 변수: `--up: #cf222e`, `--down: #0969da`, `--phase2: #1a7f37` (한국식 색상)
   - 구조: `<!DOCTYPE html>` + `<head>` (CSS) + `<body>` (변환된 HTML)
   - 레이아웃: container max-width 860px, 화이트 모드, 반응형 (600px 브레이크포인트)
   - 제목/날짜는 `<header class="report-header">` 블록으로 별도 렌더링

3. **컴포넌트 스타일링**
   - 지수 카드: `.index-grid` 그리드 (`repeat(auto-fit, minmax(150px, 1fr))`)
   - 브레드스 stat 행: `.stat-row` + `.stat-chip` 플렉스
   - 섹터 RS 표: 표준 `<table>` 스타일링, Phase 배지 색상 코딩
   - 업종 RS Top 10: 섹터 표 바로 아래, 동일 테이블 스타일
   - Phase 분포 바: `.phase-bar` 스택 바 (높이 12px), 범례
   - 종목 카드: `.stock-card` + `.stock-tags` 태그 컬러 코딩
   - 부록 구분선: `.appendix-divider` (2px solid border)

4. **함수 시그니처**
   ```typescript
   export function buildHtmlReport(
     markdownContent: string,
     title: string,
     date: string,
   ): string
   ```

### Phase 3 — Supabase Storage 연동

파일: `src/lib/storageUpload.ts` (신규)

의존성 추가: `@supabase/supabase-js`
환경변수 추가: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (서비스 롤 키 — 업로드 권한)

1. **버킷 설정**
   - 버킷명: `reports` (퍼블릭)
   - 파일 경로: `daily/{date}/{filename}.html` (ex: `daily/2026-04-02/report-2026-04-02.html`)
   - 중복 날짜 업로드: upsert (같은 파일 경로 덮어쓰기)

2. **업로드 함수**
   ```typescript
   export async function uploadHtmlReport(
     html: string,
     date: string,
     filename: string,
   ): Promise<string | null>
   // 성공 시 퍼블릭 URL 반환, 실패 시 null (Gist fallback 처리)
   ```
   - 실패 시 null 반환 (비블로킹 fail-open) — Gist fallback으로 계속 진행

3. **퍼블릭 URL 생성**
   - `supabase.storage.from('reports').getPublicUrl(path).data.publicUrl`
   - URL 형태: `https://{project}.supabase.co/storage/v1/object/public/reports/daily/{date}/{filename}.html`

### Phase 4 — 발송 파이프라인 통합

파일: `src/agent/reviewAgent.ts` (`sendDrafts` 함수)

변경 전:
```
markdownContent → createGist() → Discord (Gist URL)
markdownContent가 없으면 → Discord (텍스트 직접)
```

변경 후:
```
markdownContent →
  1. buildHtmlReport(markdownContent) — HTML 생성
  2. uploadHtmlReport(html, date) — Supabase 업로드
  3. 성공 시: Discord (Storage URL)
  4. 실패 시: createGist(markdownContent) fallback → Discord (Gist URL)
  5. Gist도 실패 시: Discord (텍스트 직접)
```

- `sendDrafts` 함수 시그니처 변경: `date` 파라미터 추가 필요
  - `runReviewPipeline`에서 `targetDate` 전달
- Gist 코드 제거하지 않고 fallback으로 유지 (안전한 단계적 전환)
- `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` 미설정 시 자동으로 Gist fallback

## 작업 계획

### Step 1 — 레짐 사전 로드 + systemPrompt 주입 (실행팀)

**파일**: `src/agent/run-daily-agent.ts`, `src/agent/systemPrompt.ts`
**내용**:
- `run-daily-agent.ts`: `loadConfirmedRegime()` 호출 → `regimeContext` 생성 (레짐명 + 시작일 + 연속일수)
- `systemPrompt.ts`: `buildDailySystemPrompt` 파라미터에 `regimeContext` 추가, 시스템 프롬프트에 주입
- 프롬프트 지시 추가: 업종 RS Top 10 표 (`mode=industry`), BreadthScore, 레짐 표시 위치

**완료 기준**: 프롬프트에 4가지 지시가 명확하게 포함되고, 레짐 정보가 시스템 프롬프트에 주입됨

### Step 2 — HTML 템플릿 엔진 구현 (실행팀)

**파일**: `src/lib/htmlReport.ts` (신규), `package.json`
**내용**:
- `yarn add marked` 의존성 추가
- `buildHtmlReport(markdownContent, title, date): string` 구현
- `sample-report.html`의 CSS를 인라인 스타일 블록으로 이식
- `marked.parse()`로 본문 변환 후 HTML 래퍼에 삽입

**완료 기준**: 단위 테스트 — 마크다운 입력 → HTML 출력 검증 (테이블, 헤더, CSS 변수 포함 여부)

### Step 3 — Supabase Storage 연동 구현 (실행팀)

**파일**: `src/lib/storageUpload.ts` (신규), `package.json`
**내용**:
- `yarn add @supabase/supabase-js` 의존성 추가
- `uploadHtmlReport(html, date, filename): Promise<string | null>` 구현
- `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` 환경변수 검증 (없으면 null 반환)
- `reports` 버킷에 `daily/{date}/{filename}.html` 경로로 upsert

**완료 기준**: 단위 테스트 — 환경변수 미설정 시 null 반환 검증. 통합 테스트는 로컬 `.env`로 수동 확인.

### Step 4 — sendDrafts 파이프라인 교체 (실행팀)

**파일**: `src/agent/reviewAgent.ts`
**내용**:
- `sendDrafts(drafts, webhookEnvVar, date)` 시그니처에 `date` 파라미터 추가
- 기존 Gist 분기를 HTML 변환 → Storage 업로드 → Gist fallback 순서로 재구성
- `runReviewPipeline`에서 `targetDate` → `sendDrafts`로 전달
- `run-daily-agent.ts`의 `runReviewPipeline` 호출부에 `targetDate` 추가

**완료 기준**: 기존 Gist fallback 동작 유지 (Storage 실패 시). `sendDrafts` 단위 테스트 업데이트.

## 리스크

1. **Supabase 버킷 미생성**: `reports` 퍼블릭 버킷을 Supabase 콘솔에서 수동 생성해야 함. 코드로 자동 생성하지 않는다.
2. **환경변수 누락**: `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` 맥미니 서버 `.env`에 추가 필요. 미추가 시 Gist fallback 동작.
3. **HTML 이메일 호환성**: Discord는 링크 클릭 → 브라우저 열기 방식이므로 이메일 클라이언트 호환성은 무관.
4. **marked 버전**: v9+ API는 `marked.parse()`가 Promise 반환. `await marked.parse()` 또는 `parseSync()` 사용 필요. 버전 확인 후 선택.
5. **CSS 인라인 vs 파일 분리**: 단일 HTML 파일 자급자족이 더 단순. 외부 CSS 파일 없이 인라인 `<style>` 블록으로 처리.
6. **섹터별 P2 비율 전일 변화**: DB/도구에서 직접 제공되지 않음. 현재 스냅샷에 전일 비교 없음. 프롬프트 지시를 "시장 전체 P2 변화량만 표기"로 범위 제한해야 함.

## 의사결정 필요

없음 — 바로 구현 가능.

단, 구현 시 확인 필요한 선행 작업:
- Supabase 콘솔에서 `reports` 퍼블릭 버킷 생성 (CEO 또는 인프라 담당)
- 맥미니 서버 `.env`에 `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` 추가

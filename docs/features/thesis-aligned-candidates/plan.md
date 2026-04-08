# Plan: Thesis-Aligned Candidates

## 문제 정의

ACTIVE thesis가 섹터/종목 방향을 가리키지만, 해당 수혜주의 현재 기술적 상태(Phase, RS, SEPA)를 자동으로 연결해서 보여주는 기능이 없다.

- narrative_chains.beneficiary_tickers에 종목 데이터가 있지만 stock_phases와 조인되지 않음
- 9개 ACTIVE chain 중 7개가 beneficiary_tickers/beneficiary_sectors 빈 배열

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 수혜주 기술적 상태 | narrative_chains 컨텍스트에 텍스트로만 존재 | Phase/RS/SEPA 조인 후 데이터 테이블로 리포트 표시 |
| 일간 리포트 | thesis 방향만 알고 종목 상태 모름 | "Thesis-Aligned Candidates" 섹션 신설 |
| narrative_chains 데이터 | 빈 배열 허용 | 토론 프롬프트에서 structural_narrative일 때 필수 필드로 강제 |

## 골 정렬

- **판정: ALIGNED**
- Phase 2 초입 포착의 핵심 갭 해소. thesis가 방향을 가리키는데 수혜주 연결이 끊겨 있으면 절반짜리 시스템.

## 무효 판정

- **판정: VALID**
- narrative_chains 테이블에 beneficiary_tickers 데이터 존재 (7/9 빈 배열이지만 구조는 있음)
- stock_phases, fundamental_scores 테이블과 조인 가능
- 초기에 표시할 종목이 적을 수 있으나 정상 — 기준을 낮추지 않음

## 변경 사항

### 1. DB 쿼리 — thesis-aligned candidates 조회 함수

**파일**: `src/db/repositories/stockPhaseRepository.ts`

새 함수 `findThesisAlignedCandidates(date)`:
- narrative_chains에서 status IN ('ACTIVE', 'RESOLVING') AND beneficiary_tickers IS NOT NULL 조회
- beneficiary_tickers를 unnest하여 stock_phases + fundamental_scores LEFT JOIN
- Phase ≥ 2, RS ≥ 70 필터 (최소 기술적 기준)
- 반환: symbol, phase, rs_score, sepa_grade, sector, industry, megatrend, bottleneck, chain_status

### 2. 타입 정의

**파일**: `src/tools/schemas/dailyReportSchema.ts`

- `ThesisAlignedCandidate` 인터페이스 추가
- `DailyReportData`에 `thesisAlignedCandidates` 필드 추가
- `DailyReportInsight`에 `thesisAlignedNarrative` 필드 추가
- `fillInsightDefaults`에 기본값 추가

### 3. 데이터 수집

**파일**: `src/agent/run-daily-agent.ts`

- `collectDailyData()`에서 `findThesisAlignedCandidates(targetDate)` 병렬 호출 추가

### 4. HTML 렌더링

**파일**: `src/lib/daily-html-builder.ts`

- `renderThesisAlignedSection()` 함수 추가 — thesis별 그룹핑, Phase badge/RS/SEPA 표시
- `buildDailyHtml()`에서 RS 상승 초기 종목 섹션 뒤에 배치

### 5. LLM 프롬프트

**파일**: `src/agent/prompts/daily.ts`

- `buildInsightPrompt()`에 thesis-aligned candidates 데이터 블록 추가
- LLM에 `thesisAlignedNarrative` 필드 요청 추가

### 6. 토론 엔진 beneficiary 필수화

**파일**: `src/debate/round3-synthesis.ts`

- structural_narrative 카테고리의 beneficiarySectors/beneficiaryTickers 필수 필드 강조 (프롬프트 보강)
- 빈 배열 방지를 위한 validation 경고 추가

## 작업 계획

1. DB 쿼리 함수 + 타입 정의
2. 데이터 수집 + HTML 렌더링
3. LLM 프롬프트 수정
4. 토론 엔진 프롬프트 보강
5. 테스트 작성
6. 코드 리뷰 + 문서 업데이트

## 리스크

- **빈 배열 문제**: 9개 중 7개가 빈 배열이므로 초기에 표시할 종목이 적을 수 있음. 정상 동작이며, 다음 토론 사이클에서 자연 보강됨.
- **Shell Companies 오염**: beneficiary_tickers에 SPAC 등이 포함될 수 있음 → Phase ≥ 2 + RS ≥ 70 필터가 자연 방어. 별도 industry 필터는 불필요 (과도한 제약 회피).
- **DB 스키마 변경 없음**: 기존 테이블 조인만 사용.

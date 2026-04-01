# Plan: 고RS Phase 2 클러스터 리포트 누락 해결

> Lite 트랙 — 구조적 사각지대 버그 수정
> Issue: #550

## 문제 정의

고RS Phase 2 업종 클러스터(예: 반도체 장비 ICHR RS96, UCTT RS96, TER RS94)가 데일리/주간 리포트에서 체계적으로 누락됨.

**근본 원인**: thesis 부재 → LLM 선택 편향
- 도구(`get_unusual_stocks`)는 해당 종목을 정상 반환
- 동일 조건의 광통신(AAOI, LITE)은 CONFIRMED thesis가 있어 리포트에 매번 등장
- 반도체 장비는 thesis 없음 → LLM이 서사를 붙일 수 없어 skip
- `narrative_chains`에 ACTIVE 서사가 있으나 일간 프롬프트에 수혜 종목이 노출되지 않음

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 일간 프롬프트 | thesis 컨텍스트만 주입 | thesis + 업종 클러스터 컨텍스트 동시 주입 |
| 주간 프롬프트 | thesis 게이트에 의존 | thesis + 업종 클러스터 별도 분석 지시 |
| 서사 체인 (일간) | 체인명/상태만 표시 | 수혜 섹터/종목까지 표시 |
| 고RS 클러스터 가시성 | LLM에 보이지 않음 | 명시적 데이터 + 분석 지시 |

## 변경 사항

### 1. 업종 클러스터 컨텍스트 주입 (핵심)

**새 파일: `src/db/repositories/sectorClusterRepository.ts`**
- Phase 2 비율 40%+ AND group_phase = 2 섹터 조회
- 해당 섹터의 RS 80+ Phase 2 종목 조회 (섹터당 최대 5개)
- RS 상한 없음 (추천 게이트와 달리, 가시성 목적이므로 RS 95+ 포함)

**새 파일: `src/lib/sectorClusterContext.ts`**
- DB 쿼리 결과를 프롬프트 주입용 문자열로 포맷
- 일간/주간 공용 포맷

**수정: `src/agent/systemPrompt.ts`**
- `buildDailySystemPrompt`: `sectorClusterContext` 파라미터 추가, 주입 섹션 추가
- `buildWeeklySystemPrompt`: `sectorClusterContext` 파라미터 추가, 주입 섹션 추가
- 일간 워크플로우에 "업종 클러스터 분석" 단계 추가 (기존 도구 활용)
- 주간 프롬프트에 thesis 없는 클러스터도 별도 언급하라는 지시 추가

**수정: `src/agent/run-daily-agent.ts`**
- 업종 클러스터 컨텍스트 로드 + 프롬프트에 전달

**수정: `src/agent/run-weekly-agent.ts`**
- 업종 클러스터 컨텍스트 로드 + 프롬프트에 전달

### 2. 서사 체인 일간 포맷 강화 (보조)

**수정: `src/lib/narrativeChainStats.ts`**
- `formatChainsForDailyPrompt()`: 기존 테이블에 수혜 섹터/종목 컬럼 추가
- 주간 포맷에는 이미 있으나 일간에만 누락된 정보

### 3. 건드리지 않는 것

- `watchlistGate.ts` — thesis 게이트는 설계 의도대로 유지 (관심종목 등록 ≠ 리포트 언급)
- `recommendationGates.ts` — RS > 95 과열 차단은 유지 (추천 ≠ 리포트 분석)
- `getPhase2Stocks.ts` — MAX_RS 95 기본값 유지 (이슈의 부차적 문제, 별도 판단 필요)
- `getRisingRS.ts` — RS_MAX 70은 "초입 포착" 목적에 맞음

## 작업 계획

| # | 작업 | 파일 | 의존 |
|---|------|------|------|
| 1 | DB 쿼리 생성 | `src/db/repositories/sectorClusterRepository.ts` | — |
| 2 | 포맷 함수 생성 | `src/lib/sectorClusterContext.ts` | 1 |
| 3 | 서사 체인 일간 포맷 강화 | `src/lib/narrativeChainStats.ts` | — |
| 4 | 프롬프트 수정 | `src/agent/systemPrompt.ts` | 2 |
| 5 | 일간 에이전트 수정 | `src/agent/run-daily-agent.ts` | 2, 4 |
| 6 | 주간 에이전트 수정 | `src/agent/run-weekly-agent.ts` | 2, 4 |
| 7 | 테스트 작성 | `src/lib/__tests__/sectorClusterContext.test.ts` | 2 |

## 리스크

- **프롬프트 길이 증가**: 업종 클러스터 컨텍스트 추가로 토큰 사용량 증가. 최대 5개 섹터 × 5개 종목 = 25행 수준으로 제한하여 관리.
- **DB 쿼리 부하**: 기존 `sector_rs_daily` + `stock_phases` 조인. 인덱스 존재하므로 문제없음.
- **LLM 행동 변화**: 프롬프트 변경은 LLM 출력에 비결정적 영향. 기존 규칙과 충돌 없도록 설계.

## 골 정렬

- **판정: ALIGNED** — "Phase 2 주도섹터/주도주 초입 포착"이 프로젝트 궁극 목표. 고RS Phase 2 클러스터가 리포트에서 누락되는 것은 이 목표에 직접 반하는 구조적 결함.

## 무효 판정

- **해당 없음** — LLM 백테스트나 시뮬레이션 의존 없음. DB 팩트 기반 컨텍스트 주입 + 프롬프트 지시 변경.

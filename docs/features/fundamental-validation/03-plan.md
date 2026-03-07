# Plan: 펀더멘탈 검증 + 종목 리포트 시스템

## 전제 조건 확인

- [x] FMP API 키 확보 (환경변수에 존재)
- [x] `quarterly_financials` 최신 데이터 존재 (86K rows, 최신 2026-05-25)
- [x] `quarterly_ratios` 데이터 존재 (65K rows, 마진/밸류에이션)
- [x] 기존 FMP ETL 코드 재활용 가능 (`load-quarterly-financials.ts`)

## Phase 1: 펀더멘탈 스코어러 (정량 로직)

### Task 1.1 — 타입 정의
- `src/types/fundamental.ts`
- `FundamentalScore`, `FundamentalGrade` (A/B/C/F), `SEPACriteria`
- AC: 타입 컴파일 통과

### Task 1.2 — 펀더멘탈 스코어러 함수 (TDD)
- `src/lib/fundamental-scorer.ts`
- 입력: 종목의 최근 8분기 실적 데이터
- 로직:
  - EPS YoY 성장률 계산 (최근 분기 vs 작년 동분기)
  - EPS 가속 판정 (최근 3분기 성장률 추세)
  - 매출 YoY 성장률 계산
  - 이익률 추세 (최근 4분기 net_margin 방향)
  - ROE 추정 (가능한 경우)
- 출력: 점수 + 등급 (A/B/C/F)
- AC: 단위 테스트 15개 이상, 엣지케이스 포함

### Task 1.3 — DB에서 실적 데이터 로드
- `src/lib/fundamental-data-loader.ts`
- Phase 2 종목 리스트 → 최근 8분기 quarterly_financials + quarterly_ratios 조회
- AC: 쿼리 성능 1초 이내 (200종목 기준)

## Phase 2: FMP 보충 데이터

### Task 2.1 — 어닝 서프라이즈 수집
- `src/etl/jobs/fetch-earnings-surprises.ts`
- FMP `/api/v3/earnings-surprises/{symbol}` 호출
- Phase 2 종목만 대상, DB 저장 (새 테이블 `earnings_surprises`)
- AC: Phase 2 종목의 최근 4분기 서프라이즈 데이터 수집

### Task 2.2 — 스코어러에 서프라이즈 통합
- `fundamental-scorer.ts`에 어닝 beat/miss 가점 반영
- AC: 서프라이즈 데이터 있으면 점수에 반영, 없으면 무시

### Task 2.3 — (선택) 기관 보유 수집
- Phase 2가 잘 작동한 뒤 추가 고려
- 우선순위 낮음

## Phase 3: 펀더멘탈 애널리스트 페르소나

### Task 3.1 — 페르소나 정의
- `.claude/agents/fundamental-analyst.md`
- 역할: Minervini SEPA 전문가, 정량 데이터를 투자 내러티브로 해석
- AC: 페르소나 파일 작성, personas.ts에 등록

### Task 3.2 — 펀더멘탈 에이전트 호출 로직
- `src/agent/fundamental/fundamentalAgent.ts`
- 입력: 종목 + 스코어 + 원시 실적 데이터
- LLM이 해석하여 내러티브 생성
- AC: A/B급 종목에 대해 2-3문단 분석 생성

## Phase 4: 종목 리포트 발행

### Task 4.1 — 종목 리포트 생성기
- `src/agent/fundamental/stockReport.ts`
- 기술적 현황 (Phase, RS, 거래량) + 펀더멘탈 (등급, 실적 추세) + LLM 분석
- 마크다운 형식 리포트 생성
- AC: A급 종목에 대해 구조화된 리포트 생성

### Task 4.2 — Discord + Gist 발송
- 기존 `discord.ts`, `gist.ts` 재활용
- 별도 Discord 채널/웹훅 (선택)
- AC: A급 종목 리포트가 Discord로 발송됨

## Phase 5: 주간 파이프라인 통합

### Task 5.1 — 주간 에이전트 통합
- `run-weekly-agent.ts`에 펀더멘탈 검증 단계 추가
- 추천 종목 → 스코어링 → 등급 부여 → 리포트 발행
- AC: 주간 에이전트 실행 시 펀더멘탈 검증이 자동 수행됨

### Task 5.2 — 주간 리포트에 펀더멘탈 보조 표시
- 추천 종목에 등급 표시 (A~F)
- B 이상: 핵심 실적 한 줄 추가
- C/F: 경고 표시
- AC: 주간 리포트에 펀더멘탈 등급이 포함됨

## 구현 순서

```
Phase 1 (핵심) → Phase 3 → Phase 4 → Phase 5 → Phase 2 (보충)
```

Phase 2 (FMP 보충)는 마지막에 — 기존 DB 데이터만으로 Phase 1~4가 충분히 작동함.
어닝 서프라이즈는 "있으면 좋은" 가점이지 필수가 아님.

## 예상 파일 구조

```
src/
├── types/
│   └── fundamental.ts                    # NEW
├── lib/
│   ├── fundamental-scorer.ts             # NEW — 정량 스코어링
│   └── fundamental-data-loader.ts        # NEW — DB 쿼리
├── agent/
│   └── fundamental/
│       ├── fundamentalAgent.ts           # NEW — LLM 해석
│       └── stockReport.ts               # NEW — 리포트 생성
├── etl/
│   └── jobs/
│       └── fetch-earnings-surprises.ts   # NEW (Phase 2)
.claude/agents/
    └── fundamental-analyst.md            # NEW — 페르소나
```

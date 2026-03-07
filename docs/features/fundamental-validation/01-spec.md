# Spec: 펀더멘탈 검증 + 종목 리포트 시스템

## Purpose

기술적 Phase 2 스크리닝만으로는 실적이 뒷받침되지 않는 종목(바닥 반등, 테마 거품)이 포함됨.
Minervini SEPA 기준의 펀더멘탈 검증을 추가하여 **기술 + 실적 모두 우수한 슈퍼퍼포머 후보**를 선별하고,
핵심 종목에 대해 **개별 종목 리포트**를 발행한다.

## 핵심 원칙

> 시장을 장기로 이기려면 펀더멘탈이 받쳐줘야 한다.
> NVDA, PLTR, MU — 모두 실적이 괴랄하게 성장했다.

## Requirements

### Functional

- [ ] Phase 2 종목에 대해 Minervini SEPA 기준 펀더멘탈 점수(A/B/C/F) 산출
- [ ] 기존 DB 데이터(`quarterly_financials`, `quarterly_ratios`) 우선 활용
- [ ] FMP API로 어닝 서프라이즈, 기관 보유 등 보충 데이터 수집 (Phase 2 종목만)
- [ ] 펀더멘탈 애널리스트 페르소나가 정량 점수 + 맥락을 해석하여 내러티브 생성
- [ ] 주간 리포트에 펀더멘탈 분석 보조 제공
- [ ] 기술 A급 + 펀더멘탈 A급 종목에 대해 **개별 종목 리포트** 발행

### Non-Functional

- [ ] FMP API 호출은 Phase 2 종목만 대상 (일 ~200건, 비용 최소화)
- [ ] 펀더멘탈 스코어링은 정량 로직 (LLM 의존 X)
- [ ] 종목 리포트는 Discord 발송 + Gist 저장

## Scope

**In scope:**
- 펀더멘탈 스코어러 (정량 함수)
- 펀더멘탈 애널리스트 페르소나
- 종목 리포트 생성 및 발송
- FMP API 연동 (어닝 서프라이즈, 기관 보유)

**Out of scope:**
- screener 웹앱 UI 변경
- FMP 외 데이터 소스 추가 (추후)
- 자동 매매 시그널 생성

## Design

### Minervini SEPA 펀더멘탈 기준

| # | 기준 | 데이터 소스 | 판정 |
|---|------|-----------|------|
| 1 | EPS 성장 (최근 분기 YoY > 25%) | `quarterly_financials.eps_diluted` | 필수 |
| 2 | EPS 가속 (성장률이 분기마다 증가) | 최근 4분기 eps 비교 | 가점 |
| 3 | 매출 성장 (YoY > 25% 또는 가속) | `quarterly_financials.revenue` | 필수 |
| 4 | 이익률 확대 추세 | `quarterly_ratios.net_margin` | 가점 |
| 5 | ROE > 17% | 계산: net_income / equity | 가점 |
| 6 | 어닝 서프라이즈 (최근 2분기 beat) | FMP `/earnings-surprises` | 가점 |
| 7 | 기관 보유 증가 | FMP `/institutional-holder` | 가점 |

### 등급 체계

| 등급 | 조건 | 의미 |
|------|------|------|
| **A** | 필수 2개 + 가점 3개 이상 | 슈퍼퍼포머 후보 → 종목 리포트 발행 |
| **B** | 필수 1개 + 가점 2개 이상 | 양호 — 주간 리포트에 펀더멘탈 보조 |
| **C** | 필수 미충족, 가점 일부 | 기술적으로만 Phase 2 — 주의 필요 |
| **F** | 데이터 부족 또는 실적 악화 | 펀더멘탈 미달 — 경고 표시 |

### 시스템 아키텍처

```
[주간 에이전트]
    ↓ 추천 종목 리스트
[fundamentalScorer] ← quarterly_financials, quarterly_ratios (기존 DB)
    ↓                ← FMP API (서프라이즈, 기관 — Phase 2만)
    ↓ 종목별 점수 + 등급
[펀더멘탈 애널리스트] (LLM)
    ↓ 정량 데이터 해석 + 내러티브
    ├── 주간 리포트 보조 (B 이상)
    └── 종목 리포트 발행 (A급만)
         → Discord 발송 + Gist 저장
```

### 파일 구조 (예상)

```
src/
├── lib/
│   └── fundamental-scorer.ts      # 정량 스코어링 로직
├── agent/
│   ├── debate/
│   │   └── fundamentalAgent.ts     # 펀더멘탈 애널리스트 호출
│   └── stockReport.ts             # 종목 리포트 생성 + 발송
├── etl/
│   └── jobs/
│       └── fetch-fmp-supplements.ts # FMP 보충 데이터 수집
└── types/
    └── fundamental.ts              # 펀더멘탈 관련 타입
```

### 종목 리포트 구조

```markdown
# [NVDA] 종목 심층 분석

## 1. 기술적 현황
- Phase 2 진입 N일차, RS 95, 거래량 확인
- 52주 고점 대비 -5.2%, 시총 $2.8T

## 2. 펀더멘탈 등급: A
- EPS: $0.82 → $1.27 → $1.89 (3분기 연속 가속, YoY +120%)
- 매출: $35.1B (YoY +94%), 가속 추세
- 이익률: 56% → 61% → 65% (지속 확대)
- 어닝 서프라이즈: 최근 4분기 연속 beat (평균 +12%)
- 기관 보유: 전분기 대비 +2.3%

## 3. 펀더멘탈 애널리스트 분석
AI capex 사이클의 핵심 수혜주로...

## 4. 리스크 요인
- 밸류에이션 PEG 2.1 (다소 부담)
- ...

## 5. 종합 판단
기술적 Phase 2 + 펀더멘탈 A급. 구조적 성장이 확인된 슈퍼퍼포머 후보.
```

### 데이터 흐름

1. **기존 DB 쿼리** (비용 0): Phase 2 종목의 최근 8분기 실적 + 비율
2. **FMP API** (Phase 2만, ~200건/일): 어닝 서프라이즈, 기관 보유
3. **점수 산출**: 정량 로직, LLM 불필요
4. **LLM 해석**: A/B급 종목에 대해서만 펀더멘탈 애널리스트 호출
5. **리포트 생성**: A급만 종목 리포트 발행

### FMP API 엔드포인트

| 엔드포인트 | 용도 | 호출 빈도 |
|-----------|------|----------|
| `/api/v3/earnings-surprises/{symbol}` | 어닝 beat/miss 이력 | 주 1회 |
| `/api/v3/institutional-holder/{symbol}` | 기관 보유 변화 | 주 1회 |
| (선택) `/api/v3/analyst-estimates/{symbol}` | 컨센서스 EPS | 주 1회 |

## Acceptance Criteria

- [ ] Phase 2 종목에 대해 펀더멘탈 A/B/C/F 등급이 산출됨
- [ ] 주간 리포트에 추천 종목의 펀더멘탈 등급이 표시됨
- [ ] A급 종목에 대해 종목 리포트가 Discord로 발송됨
- [ ] FMP API 호출이 Phase 2 종목으로 제한됨 (비용 통제)
- [ ] 기존 quarterly_financials 데이터가 없는 종목은 F등급 (데이터 부족)

## Open Questions

- [ ] FMP API 키 확보 상태? 무료 tier 제한 확인 필요
- [ ] 종목 리포트 발행 빈도: 주 1회? 신규 A급 진입 시마다?
- [ ] screener ETL의 quarterly_financials 업데이트 주기 확인 필요

# How It Works

Market Analyst Engine의 파이프라인 상세 문서.

---

## 파이프라인 흐름

```
1. ETL 파이프라인 (매일 장 마감 후)
   → 미장 휴일 자동 감지: Phase 1(가격 수집) 직후 DB MAX(date) 비교 → 휴일이면 Phase 2 이후 전체 스킵
   → 토론 에이전트 자동 재시도: 일시적 인증 실패 시 3분 간격 최대 3회 + 최종 실패 시 Discord 알림
   → FRED 신용 스프레드/금융 스트레스 지표 수집 (HY OAS, CCC, BBB, STLFSI4) + z-score 이상 감지
   → 뉴스 수집 후 LLM 테마 추출 자동 실행 (인과적 섹터 영향 매핑)
   → LLM 사각지대 감지: Haiku가 thesis·신용이상·RS·카테고리 분포를 종합하여 미수집 테마 식별 → 동적 쿼리 자동 생성
   → Weinstein Phase 판별, 섹터/산업 RS 계산, 브레드스 분석

2. 멀티 모델 애널리스트 토론 (매일 22:00 UTC)
   → 매크로(GPT-4o) / 테크(Gemini 2.5 Flash) / 지정학(Claude) / 심리(Claude) 4명이 3라운드 토론
   → 멀티 모델 다양성으로 확증편향 구조적 완화 + 외부 API 장애 시 Claude 자동 폴백
   → 조기포착 도구 3종(Phase1Late / RisingRS / 펀더멘탈가속) 결과를 Round 1·3에 주입
   → 교집합 필터: 2+도구에 동시 등장하는 종목을 "고확신 후보"로 별도 태깅
   → 촉매 데이터(종목 뉴스 / 실적 서프라이즈 비트율 / 임박 실적 발표) 주입
   → CREDIT 카테고리 뉴스 수집: 신용 스프레드 / CLO / 하이일드 / PE 리스크 → 신용 경색 시그널
   → LLM 뉴스 테마 추출: HIGH 테마 토론 컨텍스트 주입
   → 추론 방향: RS 귀납(강한 종목 → 이유 역추적) → 공급망 연역(병목 식별 → 수혜 종목 선행 예측)
   → 수요-공급-병목 프레임으로 구조적 서사 도출
   → N+1 병목 예측: "현재 병목 해소 후 다음 제약은?"
   → 공급 과잉 전환 감지: 병목 해소 → 과잉 전환 조기 포착
   → 병목 체인 추적: narrative_chains 테이블에 병목 생애주기 기록 + N+1 수혜 섹터/종목 저장
   → 국면(Meta-Regime) 계층: 체인 간 순차 활성화 순서 + 전파 유형 모델링
   → 국면 자동 관리: 토론 완료 후 상태 전이(ACTIVE→PEAKED→RESOLVED) + 미연결 체인 자동 연결
   → narrative_chain_regimes junction table: LLM이 chain↔regime 연결을 직접 판단하여 저장
   → 서사 체인 + 국면 컨텍스트를 Round 3 합성 프롬프트에 주입
   → 모더레이터(Claude)가 thesis 구조화 + 합의도(consensus_score) 기록
   → Consensus 알고리즘 검증: Round 1 에이전트 출력 키워드 매칭으로 합의도 교차 검증
   → Cross-thesis 모순 탐지: 방향성 상반 thesis 쌍 감지 → contradiction_detected 플래그

3. 학습 루프 (자동)
   → ACTIVE thesis를 시장 데이터로 검증 (CONFIRMED / INVALIDATED)
   → 원인 분석: LLM이 "왜 맞았는지/틀렸는지" 인과 체인 추출
   → 반복 적중 패턴 → 장기 기억(agent_learnings)으로 승격
   → 실패 패턴 자동 축적: 실패율 70%+ 패턴 → 필터링 규칙 승격 → 추천 스캔 시 자동 차단
   → 현상유지 thesis 필터: 생성 시점에 이미 충족된 thesis → is_status_quo 태깅 → 학습 루프 제외
   → 유사 시장 조건의 과거 세션을 few-shot으로 주입

4. 섹터 시차 패턴 (자동)
   → 섹터/산업 Phase 전이 이벤트 매일 감지 + 기록
   → 섹터 쌍별 시차 통계 축적 (평균, 표준편차, 신뢰 구간)
   → "A 섹터 Phase 2 진입 → N주 후 B 섹터 주시" 선행 경보
   → 신뢰 가능 패턴(5회+ 관측)만 주간 에이전트에 주입

5. 품질 관리 (자동)
   → 일간 리포트 품질 검증 파이프라인 (Claude Code CLI 기반)
   → 조건부 발송 게이트: 품질 미달 시 발송 차단
   → bull-bias 감지 + Phase 2 ratio 이중 변환 방어
   → QA 이슈 기준: 총점 ≤32 OR factConsistency < 7 → GitHub 이슈 자동 생성
   → 교차 리포트 정합성: 일간/토론 reported_symbols 불일치 감지
   → 급락 종목 경고: -5% + 거래량 1.5x 시 Discord 경고 삽입
   → 도구 에러 자동 감지: Discord 즉시 알림 + GitHub 이슈 자동 생성
   → 콘텐츠 QA: 나레이션 존재 검증 + 데이터-해석 톤 일관성 + HTML 렌더링 완전성

6. 기업 애널리스트 (featured 종목 한정)
   → 피어 멀티플(P/E · EV/EBITDA · P/S) 가중 평균 기반 정량 목표주가 산출
   → 월가 컨센서스 교차 검증 (ALIGNED / DIVERGENT / LARGE_DIVERGENT)
   → LLM은 정량 결과를 해석만 — 숫자를 만들어내지 않음
   → 어닝콜 핵심 발언, 포워드 EPS, 피어 비교 등 Seeking Alpha 수준 리포트
```

---

## Agent Tools

| 도구 | 일간 | 주간 | 설명 |
|------|:----:|:----:|------|
| `getIndexReturns` | O | O | 4대 지수 + VIX + US 10Y + DXY + 공포탐욕지수 (주간: 누적 + 고저 위치) |
| `getMarketBreadth` | O | O | Phase 분포, Phase 2 비율, A/D ratio (주간: 5일 추이 + Phase 1→2 전환) |
| `getLeadingSectors` | O | O | RS 상위 섹터/업종 (주간: 순위 변동 + 신규 진입/이탈; 업종 드릴다운 포함) |
| `getPhase2Stocks` | | O | Phase 2 초입 종목 리스트 (RS 필터링) |
| `getPhase1LateStocks` | O | O | Phase 1 후기 종목 — VDU + 거래량 회복 패턴으로 Phase 2 진입 선행 포착 |
| `getRisingRS` | O | O | RS 30~70 상승 가속 종목 — 초기 모멘텀 포착 (SEPA 등급 + 시총 포함) |
| `getFundamentalAcceleration` | | O | EPS/매출 성장 가속 종목 (Phase 1~2 대상) |
| `getUnusualStocks` | O | | 복합 조건 특이종목 스크리닝 (등락률 · 거래량 · Phase 전환) |
| `getStockDetail` | O | O | 개별 종목 상세 분석 (Phase, RS, MA, 섹터 컨텍스트) |
| `searchCatalyst` | O | O | Brave Search 뉴스 기반 카탈리스트 |
| `readReportHistory` | | O | 과거 리포트 이력 (중복 방지) |
| `readRecommendationPerformance` | | O | 추천 성과 트래킹 (신규/종료/Phase 이탈 집계) |
| `getWatchlistStatus` | O | O | 관심종목 현황 + Phase 궤적 (일간: 현재 상태, 주간: 90일 궤적) |
| `saveWatchlist` | | O | 관심종목 DB 저장 |
| `readRegimePerformance` | | O | 레짐별 신호 성과 통계 |
| `saveRecommendations` | O | O | 추천 종목 DB 저장 (팩터 스냅샷 포함) |
| `saveReportLog` | O | O | 리포트 결과 저장 |
| `getVCPCandidates` | | O | VCP(변동성 수축 패턴) 후보 — BB width 수축 기반 피벗 진입 신호 |
| `getConfirmedBreakouts` | | O | 거래량 확인된 돌파 종목 |
| `getSectorLagPatterns` | | O | 섹터 간 Phase 전환 래그 패턴 — 후행 섹터 선제 예측 |
| `sendDiscordReport` | — | — | Discord + Gist 리포트 발송 (리뷰 파이프라인 내부 전용) |

---

## Learning Loop 구성

```
토론에서 thesis 추출
  → ACTIVE 상태로 DB 저장
  → 매일 시장 데이터로 자동 검증 (CONFIRMED / INVALIDATED / HOLD)
  → 원인 분석: "왜 맞았는지/틀렸는지" LLM 분석 → causal_analysis 저장
  → 3회+ 적중 패턴 → agent_learnings으로 승격
  → 유사 시장 조건 과거 세션 → few-shot 주입
```

| 구성 요소 | 파일 | 역할 |
|-----------|------|------|
| Thesis Store | `thesisStore.ts` | thesis 저장, 만료, 에이전트별 ACTIVE 상한(10건) |
| Thesis Verifier | `thesisVerifier.ts` | LLM 기반 자동 검증 |
| Causal Analyzer | `causalAnalyzer.ts` | 검증 결과 원인 분석, 패턴 추출 |
| Session Store | `sessionStore.ts` | 토론 세션 저장, 유사 세션 검색 |
| Memory Loader | `memoryLoader.ts` | 학습 + 검증 결과 프롬프트 주입 |
| Catalyst Loader | `catalystLoader.ts` | 종목 뉴스/실적 서프라이즈/임박 실적 발표 → 촉매 컨텍스트 |
| Promote Learnings | `promote-learnings.ts` | 반복 적중 패턴 → 장기 기억 승격 |
| Failure Tracker | `collect-failure-patterns.ts` | Phase 2 실패 조건 자동 기록 + 패턴 축적 |
| Narrative Chain | `narrativeChainService.ts` | 병목 생애주기 추적 + 동의어 정규화 키워드 매칭 |
| Sector Lag Stats | `sectorLagStats.ts` | 섹터 쌍별 Phase 전이 시차 통계 + 선행 경보 |
| Bias Detector | `biasDetector.ts` | bull-bias 80% 초과 경고 |
| Statistical Tests | `statisticalTests.ts` | 이항 검정 + Cohen's h 유의성 필터 |

---

## Thesis 카테고리

| 카테고리 | 설명 | 기본 검증 주기 |
|----------|------|---------------|
| `structural_narrative` | 수요-공급-병목 구조적 서사 | 8~12주 |
| `sector_rotation` | 섹터 로테이션 전망 | 2~4주 |

---

## Fundamental Validation (Minervini SEPA)

| 등급 | 조건 | 액션 |
|------|------|------|
| **S** | A등급 상위 Top 3 (rankScore) | 개별 종목 심층 리포트 (Discord + Gist) |
| **A** | EPS/매출 YoY >25% + 가속 + 마진 | 주간 리포트 포함 + LLM 내러티브 |
| **B** | 필수 2개 충족 | 주간 리포트 포함 |
| **C** | 필수 1개만 충족 | 기술적으로만 Phase 2 경고 |
| **F** | 미충족 또는 데이터 부족 | 펀더멘탈 미달 표시 |

Non-GAAP EPS 우선 (`eps_surprises.actual_eps`), GAAP EPS 폴백 (`quarterly_financials.eps_diluted`).

# fundamental-report-quality

## 선행 맥락

- **fix-fundamental-report** (PR #189/#190): `canSkipScoring` 시 S등급 리포트 미발행 버그 수정 완료. 리포트 발행 자체는 이제 정상 작동.
- **리포트 사후 검증** (PR #180): `validate-fundamental-report.sh` — 4항목 40점, 이슈 기준 ≤28. 데이터 오류가 있으면 자동 이슈 생성되는 구조.
- **fundamental-analyst.md 페르소나**: "2-3문단을 넘지 않는다" 제약이 명시되어 있어 LLM이 짧은 분석만 출력.
- **GitHub 이슈**: #191

## 골 정렬

**ALIGNED** — S등급 리포트는 주간 투자 판단의 핵심 인풋이다. 이 리포트의 퀄리티가 투자 판단 인풋으로 쓰기에 미달이면 프로젝트 골(Phase 2 초입 포착)이 직접 훼손된다. 데이터 오류 수정은 신뢰성 확보, 분석 깊이 개선은 실질 알파 기여 강화.

## 문제

S등급 종목 상세 리포트에 6가지 문제가 동시 존재:
- **데이터 오류**: 이익률 포맷 버그(×100 미적용), 반기→분기 중복 데이터, 통화 단위 미반영 — LLM이 오류 데이터를 그대로 흡수하여 판단 오염
- **분석 깊이 부족**: 종합 판단이 기계적 한 줄 요약, 카탈리스트/섹터 포지셔닝/밸류에이션/액션 가이드 없음, LLM 2048 토큰 제약

## Before → After

**Before**:
- `stockReport.ts` L87: `${q.netMargin}%` → DB 값 0.15가 `0.15%`로 출력 (실제 15%)
- `fundamentalAgent.ts` L51: `마진 ${q.netMargin}%` → LLM에 0.15%를 사실로 전달
- `fundamental-analyst.md`: "2-3문단" 제약 + MAX_TOKENS=2048 → 카탈리스트/액션 가이드 없음
- `buildSummary()`: "기술적 Phase 2 + 펀더멘탈 S급" 한 줄 — 투자 판단 가치 없음

**After**:
- `${(q.netMargin * 100).toFixed(1)}%` — 정확한 이익률 표시
- LLM 프롬프트에도 정확한 퍼센트 전달
- 페르소나 재작성: S등급용 심층 분석 (카탈리스트, 섹터 포지셔닝, 밸류에이션 맥락, 액션 가이드)
- MAX_TOKENS=4096, MAX_NARRATIVE_LENGTH=6000
- `buildSummary()` → 구조화된 투자 판단 섹션

## 변경 사항

### Phase 1 — 데이터 오류 수정 (3개 파일, 즉시 가능)

#### `src/agent/fundamental/stockReport.ts`

1. **L87 이익률 포맷 수정** (CRITICAL):
   ```
   변경 전: const margin = q.netMargin != null ? `${q.netMargin}%` : "N/A";
   변경 후: const margin = q.netMargin != null ? `${(q.netMargin * 100).toFixed(1)}%` : "N/A";
   ```
   - `quarterly_ratios.net_margin`은 0~1 소수로 저장됨. ×100 변환 필요.

2. **`buildSummary()` 구조 개선**:
   - 기존 한 줄 요약 → 구조화된 투자 판단 (기술적 + 펀더멘탈 조합 해석)
   - Phase 1 + S등급 조합: "Phase 2 초입 + 실적 최상위 — 최우선 관찰 대상" 수준으로

#### `src/agent/fundamental/fundamentalAgent.ts`

3. **L51 LLM 프롬프트 이익률 수정**:
   ```
   변경 전: const margin = q.netMargin != null ? `마진 ${q.netMargin}%` : "마진 N/A";
   변경 후: const margin = q.netMargin != null ? `마진 ${(q.netMargin * 100).toFixed(1)}%` : "마진 N/A";
   ```

4. **기술적 데이터 LLM 전달** (현재 미전달):
   - `analyzeFundamentals()` 시그니처에 `technical?: StockReportContext["technical"]` 추가
   - `buildUserMessage()`에 Phase, RS, 52주 고점 대비 등 기술적 데이터 섹션 추가
   - `runFundamentalValidation.ts`에서 `loadTechnicalData()` 먼저 호출하여 전달

#### 데이터 중복 문제 (반기→분기 잘못 분할, 통화 단위)

- **반기보고 데이터 분기 중복 (CYD 등)**: ETL 레이어 문제. `fundamental-data-loader.ts`에서 같은 `as_of_q` 값이 2개 존재하면 첫 번째만 사용하는 중복 제거 로직 추가.
- **통화 단위 혼란 (SMFG 등)**: `symbols` 테이블에 `currency` 컬럼 존재 여부 확인 후, 달러 이외 통화는 단위 명시. 단기적으로 매출 포맷에 "단위 불명확 가능" 노트 추가.

### Phase 2 — 분석 깊이 개선 (2개 파일)

#### `.claude/agents/fundamental-analyst.md`

5. **S등급 전용 심층 분석 포맷 추가**:
   - 기존 A/B급 "2-3문단" 포맷 유지
   - S등급 전용 섹션 신설:
     ```
     ### S등급 종목 심층 분석 (5-6문단)
     1. 핵심 판단 (1줄): 이 종목을 지금 주목하는 이유
     2. 실적 모멘텀 해석: 성장 패턴과 지속 가능성
     3. 카탈리스트: 이 실적을 만든 구조적 요인
     4. 섹터 포지셔닝: 섹터 내 경쟁 위치, 시장 점유율 변화
     5. 밸류에이션 맥락: PEG 또는 PS 기반 상대 평가 (데이터 있는 경우)
     6. 리스크 + 액션 가이드: 경고 신호 + 관찰 포인트
     ```
   - "간결하게. 2-3문단을 넘지 않는다" 제약 → S등급은 예외

#### `src/agent/fundamental/fundamentalAgent.ts`

6. **토큰 한도 상향**:
   - `MAX_TOKENS`: 2048 → 4096
   - `MAX_NARRATIVE_LENGTH`: 3000 → 6000
   - S등급 여부를 `buildUserMessage()`에 명시하여 LLM이 심층 분석 포맷 사용하도록 유도

## 작업 계획

### Phase 1: 데이터 오류 수정 [backend-engineer]

#### 단계 1-A — 이익률 포맷 버그 수정 (CRITICAL)
- `stockReport.ts` L87 수정
- `fundamentalAgent.ts` L51 수정
- 완료 기준: 리포트 테이블에 `15.0%` 형태로 출력됨 (0.15% 아님)

#### 단계 1-B — 기술적 데이터 LLM 전달
- `analyzeFundamentals()` 시그니처 변경 — `technical?` 파라미터 추가
- `buildUserMessage()`에 기술적 현황 섹션 추가 (Phase, RS, 52주 고점 대비)
- `runFundamentalValidation.ts`에서 `loadTechnicalData()` 앞으로 이동 (LLM 분석 전 호출)
- 완료 기준: LLM 프롬프트에 Phase/RS 정보 포함됨

#### 단계 1-C — 데이터 중복 제거
- `fundamental-data-loader.ts` `groupBySymbol()` 내에 같은 `as_of_q` 중복 로우 제거 로직 추가
- 완료 기준: 동일 `as_of_q`가 2개 이상 있으면 첫 번째(`period_end_date` 최신) 유지

#### 단계 1-D — 테스트 추가
- `__tests__/lib/fundamental-data-loader.test.ts`: 중복 `as_of_q` 제거 검증
- `__tests__/agent/fundamental/stockReport.test.ts`: 이익률 포맷 0→% 변환 검증
- `__tests__/agent/fundamental/fundamentalAgent.test.ts`: 이익률 프롬프트 문자열 검증
- 완료 기준: 신규 테스트 통과, 기존 555 테스트 회귀 없음

### Phase 2: 분석 깊이 개선 [backend-engineer]

#### 단계 2-A — 페르소나 재작성
- `.claude/agents/fundamental-analyst.md` S등급 전용 심층 분석 포맷 추가
- "2-3문단" 제약을 S등급 예외로 명시
- 완료 기준: 페르소나 문서에 S등급 전용 6섹션 포맷 존재

#### 단계 2-B — 토큰/길이 한도 상향 + S등급 프롬프트 구분
- `MAX_TOKENS` 2048 → 4096
- `MAX_NARRATIVE_LENGTH` 3000 → 6000
- `buildUserMessage()`에 `isTopGrade` 플래그 → S등급이면 심층 분석 요청 문구 삽입
- 완료 기준: S등급 LLM 출력이 6섹션 구조를 따름

#### 단계 2-C — `buildSummary()` 개선
- `stockReport.ts` `buildSummary()` 함수 재작성
- Phase + 등급 + RS + 52주 고점 대비 조합 기반 투자 판단 문장 생성
- 완료 기준: "Phase 2 + S등급 + RS 90+ + 고점 -5% 이내: 최우선 관찰 대상" 수준의 판단 텍스트

## 리스크

- **이익률 수정 → 스코어링 로직 영향**: `fundamental-scorer.ts`의 `checkMarginExpansion()`은 0~1 소수 값 그대로 비교. 수정 대상은 출력 포맷(stockReport, fundamentalAgent)뿐이며 스코어러 로직은 건드리지 않음. 단, `calcRankScore()`에서 `criteria.marginExpansion.value`를 0~1 값으로 가산하는 부분이 있음 — 이는 랭킹용으로만 사용되며 기존 동작 유지.
- **토큰 증가 비용**: MAX_TOKENS 2배 → S등급 종목 수(2~4개) 기준 주당 추가 비용 미미.
- **통화 단위 문제**: ETL 소스 데이터 레이어 문제. 이번 범위에서는 UI 노트 추가에 그침. 근본 수정은 별도 이슈.
- **반기→분기 중복**: 로더 레이어 중복 제거로 방어하지만, ETL이 잘못 분할했다면 데이터 자체가 오류. 이번 범위에서는 중복 제거(같은 `as_of_q` 중 하나만 표시)로 증상 완화.

## 의사결정 필요

없음 — 바로 구현 가능

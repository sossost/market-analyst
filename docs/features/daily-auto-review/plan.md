# Daily Auto Review — 자율 전략 참모 인프라

## 선행 맥락

### 이전 기획서와의 차이

이전 기획서(2025년 작성)는 "코드 품질/린트/커버리지/의존성 감사" 중심이었다.
**이번 기획은 그 방향을 전면 폐기하고, 전략적 인사이트 생성으로 완전 전환한다.**

코드 품질 감사는 CI/PR 단계에서 처리한다. 여기서 다룰 것은 단 하나다:
**"프로젝트 골 달성을 위해 무엇을 개선/추가해야 하는가?"**

### 기존 스케줄 인프라

```
ETL Daily:    KST 08:30 화-토
Debate Daily: KST 07:00 화-금
Agent Weekly: KST 10:00 토
QA Weekly:    KST 12:00 토
Log Cleanup:  KST 09:00 일
News Collect: KST 00/06/12/18:00 매일
Issue Proc:   KST 10~16:00 평일 4회
```

새 슬롯: **KST 06:00 매일** — Debate Daily(07:00)보다 1시간 앞서,
리뷰에서 생성된 이슈가 당일 Debate 전에 맥락에 반영될 수 있도록.

### 현재 시스템 구조 파악

핵심 파이프라인:
- `run-daily-agent.ts` — 일간 에이전트 루프 (종목 분석 → 리포트)
- `debateEngine.ts` — 5명 토론 3라운드 (macro/tech/geopolitics/sentiment + moderator)
- `thesisVerifier.ts` — ACTIVE theses 자동 검증 (CONFIRMED/INVALIDATED/HOLD)
- `memoryLoader.ts` — agentLearnings DB에서 검증된/경계 패턴 주입
- `narrativeChainService.ts` — 메가트렌드 → 섹터 서사 체인 추적
- `phase-detection.ts` — Weinstein Phase 판정 (알려진 결함: Phase 1 관대 판정)
- `getPhase1LateStocks.ts` — MA150 기울기 양전환 + 거래량 증가 종목 조회
- `getRisingRS.ts` — RS 30~60 범위 가속 종목 조회 (초입 포착 핵심 신호)
- `getFundamentalAcceleration.ts`, `fundamental-scorer.ts` — SEPA 스코어링 (S/A/B/C/F)

알려진 구조적 취약점:
- `phase-detection.ts` Phase 1 관대 판정 → Phase 3→1 오판 가능 (보류 중)
- `round3-synthesis.ts` 프롬프트에 DB/LLM 데이터 직접 삽입 (인젝션 위험)
- 토론 에이전트 4명이 독립적으로 작동 — 서로 다른 데이터 소스 기반 시 발산 가능성

---

## 골 정렬

**ALIGNED** — 이 인프라는 프로젝트 골(Phase 2 주도주 남들보다 먼저 포착)에 직접 기여한다.

근거:
1. 시스템이 골을 향해 올바르게 진화하는지 매일 점검하지 않으면, 엉뚱한 방향의 피처가 쌓인다.
2. 포착 도구의 맹점(예: Phase 1 오판, 프롬프트 맹점, 누락된 데이터 소스)을 발견하고 이슈화한다.
3. 발견된 인사이트가 이슈 → issue-processor 파이프라인으로 흘러들어가 자율 구현된다.

---

## 문제

프로젝트가 빠르게 피처를 추가하면서, **시스템이 골에 잘 맞게 진화하고 있는지**를 점검하는 루틴이 없다.
weekly strategic-aide가 있지만 주 1회로는 부족하다. 작은 맹점들이 일주일 동안 방치된다.

구체적으로 방치되는 것들:
- 분석 파이프라인에서 빠진 데이터 소스나 필터 조건
- 토론 에이전트 프롬프트의 편향 또는 맹점
- 최근 시장 구조 변화에 따른 포착 로직 갱신 필요성
- 학습 루프(agentLearnings)의 오염 또는 신뢰도 저하
- thesis 검증 로직의 구조적 결함

---

## Before → After

### Before

| 영역 | 현재 상태 |
|------|----------|
| 전략 점검 | 주 1회 (strategic-aide). 일주일 지연 누적 |
| 포착 도구 감사 | 없음. Phase 1 오판 이슈 방치 |
| 프롬프트 맹점 감지 | 없음. LLM이 놓치는 패턴 발견 불가 |
| 데이터 소스 갭 발견 | 없음. 추가 가능한 신호 소스 논의 없음 |
| 학습 루프 건강도 | 없음. agentLearnings 오염 감지 불가 |
| 인사이트 → 이슈 연결 | 수동. 발견해도 즉시 이슈화 안 하면 사라짐 |

### After

| 영역 | 목표 상태 |
|------|----------|
| 전략 점검 | 매일 06:00. 6개 리뷰어 병렬 실행, 전 영역 스캔 |
| 포착 도구 감사 | 매일. 포착 로직 조건/파라미터 감사 + 이슈 생성 |
| 프롬프트 맹점 감지 | 매일. 에이전트 프롬프트 + 토론 엔진 구조 분석 |
| 데이터 소스 갭 발견 | 매일. 누락 신호 소스 탐색 |
| 학습 루프 건강도 | 매일. agentLearnings 오염/편향 감사 |
| 인사이트 → 이슈 연결 | 발견 즉시 P1/P2 GitHub 이슈 자동 생성 (중복 자동 필터) |

---

## 아키텍처 설계

### 전체 흐름

```
[launchd: KST 06:00 매일]
        │
        ▼
scripts/cron/strategic-review.sh
        │
        ├── 1. git pull (최신화)
        ├── 2. npx tsx src/strategic-review/index.ts
        │
        ▼
src/strategic-review/index.ts (오케스트레이터)
        │
        ├── 모든 리뷰어 병렬 실행 (매일 전 영역 스캔)
        │       ├── learningLoopAuditor()      — 학습 루프 건강도
        │       ├── promptInsightReviewer()    — 에이전트 프롬프트 맹점
        │       ├── debateStructureReviewer()  — 토론 엔진 구조 분석
        │       ├── dataSourceGapFinder()      — 누락 데이터 소스 탐색
        │       ├── captureLogicAuditor()      — 포착 로직 감사
        │       └── marketStructureReviewer()  — 시장 구조 vs 시스템 정합성
        │
        ├── insights[] 수집 (전체 리뷰어 결과 합산)
        │
        ├── qualityFilter()      ← 인사이트 품질 필터 (12점 미달 폐기)
        │
        ├── deduplicator()       ← 기존 오픈 이슈와 중복 체크
        │
        └── issueCreator()       ← GitHub 이슈 자동 생성
```

### 컴포넌트 구성

```
src/strategic-review/
├── index.ts                       — 오케스트레이터 (매일 전 리뷰어 병렬 실행)
├── types.ts                       — Insight, Priority 타입
├── reviewers/
│   ├── learningLoopAuditor.ts     — 학습 루프 감사
│   ├── promptInsightReviewer.ts   — 프롬프트 맹점 분석
│   ├── debateStructureReviewer.ts — 토론 엔진 구조 분석
│   ├── dataSourceGapFinder.ts     — 데이터 소스 갭 탐색
│   ├── captureLogicAuditor.ts     — 포착 로직 감사
│   └── marketStructureReviewer.ts — 시장 구조 정합성
├── issueCreator.ts                — GitHub 이슈 생성 + 라벨링
├── deduplicator.ts                — 기존 이슈 중복 체크
└── qualityFilter.ts               — 인사이트 품질 검증
```

---

## 리뷰어 6개 — 매일 전부 실행

요일별 로테이션 없이, **매일 6개 리뷰어를 병렬로 전부 실행**한다.
토큰 제약 없고, 중복 인사이트는 deduplicator가 걸러내므로 매일 전 영역을 스캔하는 게 맞다.

### 1. 학습 루프 감사 (learningLoopAuditor)

**질문**: 시스템이 올바르게 학습하고 있는가?

분석 대상:
- `agentLearnings` DB의 최근 30개 항목: 근거가 충분한가? (N회 관측, 적중률 X%)
- `theses` DB: ACTIVE thesis 중 판정 지연이 과도한 것 (30일+ HOLD) 식별
- 같은 LLM이 생성+검증하는 루프 징후 탐지 — `thesisVerifier`가 자신이 생성한 thesis를 검증하는 패턴

산출 인사이트 예시:
- "agentLearnings 중 관측 횟수 2회 미만 항목 N개 — 근거 불충분으로 강등 검토 필요"
- "thesis ID 42 HOLD 45일 초과 — invalidation 조건 재정의 필요"

### 2. 프롬프트 맹점 분석 (promptInsightReviewer)

**질문**: 에이전트들이 놓치고 있는 관점이 있는가?

분석 대상:
- `.claude/agents/` 내 4개 전문가 페르소나 파일 정독
- `round1-independent.ts`, `round2-crossfire.ts`, `round3-synthesis.ts` 프롬프트 구조
- 4명의 관점이 커버하지 못하는 시장 분석 영역

산출 인사이트 예시:
- "macro 에이전트가 달러 강세→섹터 로테이션 연결고리를 다루지 않음"
- "round3 synthesis 프롬프트가 minority opinion을 기각하는 편향 구조"

### 3. 토론 엔진 구조 분석 (debateStructureReviewer)

**질문**: 토론 엔진이 구조적으로 올바른 결론을 도출하는가?

분석 대상:
- `debateEngine.ts` 3라운드 구조
- `regimeStore.ts` 시장 레짐 분류 5단계: 현재 시장과 정합성
- `narrativeChainService.ts` 서사 체인: 예측과 실제 RS 상승 일치율

산출 인사이트 예시:
- "레짐 분류에 TRANSITION 상태 없음 — 전환 초기 신호 포착 불가"
- "round3 프롬프트에 fundamentalContext 없으면 SEPA 스코어가 합성에 반영 안 됨"

### 4. 데이터 소스 갭 탐색 (dataSourceGapFinder)

**질문**: 포착력을 높일 수 있는 추가 데이터 소스가 있는가?

분석 대상:
- 현재 에이전트 툴 목록 (`src/agent/tools/`) 전체 매핑
- Phase 2 초입 포착에 유효하지만 현재 없는 신호 (공매도 비율, 옵션 흐름, 섹터 ETF 자금 유입 등)

산출 인사이트 예시:
- "현재 포착 도구에 공매도 비율 감소 신호 없음 — Phase 1→2 전환의 선행 지표"
- "섹터 ETF 자금 유입 데이터 없음 — 기관이 섹터를 인식하는 시점 포착 불가"

### 5. 포착 로직 감사 (captureLogicAuditor)

**질문**: Phase 2 초입 포착 도구들이 정확하게 작동하는가?

분석 대상:
- `phase-detection.ts`: Phase 1 관대 판정 이슈 현황
- `getPhase1LateStocks.ts`, `getRisingRS.ts`, `getFundamentalAcceleration.ts` 조건 검토
- 포착 도구들의 교집합 필터 효과

산출 인사이트 예시:
- "getRisingRS에서 RS_MIN=30 기준 근거 없음 — 다른 범위 비교 검증 필요"
- "포착 도구 동시 충족 종목 비율과 실제 Phase 2 전환율 상관관계 측정 미비"

### 6. 시장 구조 정합성 (marketStructureReviewer)

**질문**: 최근 시장 흐름과 시스템 설계 가정이 일치하는가?

분석 대상:
- 최근 1개월 `market_regimes` 이력: 레짐 전환 패턴
- 최근 추천 종목 성과(`recommendations`): Phase 2 정확도
- 시스템이 가정하는 "Phase 2 초입 특성"이 최근 실제 시장에서도 유효한가?

산출 인사이트 예시:
- "최근 3개월 추천 종목 Phase 2 진입 성공률 40% — RS 기준 재조정 검토"
- "SEPA S/A 등급 종목 중 실제 Phase 2 전환율: S등급 70%, A등급 45% — 차별화 부족"

---

## 인사이트 품질 보장

### 가치 없는 인사이트 차단

다음 패턴은 이슈 생성 전에 필터링한다:

| 패턴 | 예시 | 처리 |
|------|------|------|
| 모호한 개선 제안 | "프롬프트를 더 잘 작성해야 한다" | 폐기 |
| 측정 불가 주장 | "분석 품질이 낮다" | 폐기 |
| 근거 없는 추측 | "아마 데이터가 부족할 것이다" | 폐기 |
| 이미 이슈화된 것 | phase-detection.ts Phase 1 오판 (알려진 이슈) | 중복 체크 후 스킵 |
| 코드 품질/린트 지적 | "이 파일이 너무 길다" | 범위 밖, 폐기 |

### 가치 있는 인사이트 조건

이슈로 생성할 수 있으려면 다음을 모두 충족해야 한다:

1. **구체적 파일/함수 지목** — "어떤 파일의 어느 부분"
2. **골과의 연결 설명** — "이것이 Phase 2 포착에 어떻게 영향"
3. **실행 가능한 개선안** — "이렇게 바꾸면 된다"
4. **데이터 또는 코드 근거** — 주장을 뒷받침하는 증거

### 인사이트 품질 검증 프롬프트

`qualityFilter.ts`가 각 인사이트를 다음 기준으로 평가:

```
이 인사이트를 평가한다:
[인사이트 내용]

평가 기준:
1. 구체성 (1-5): 파일명/함수명/조건값이 포함되는가?
2. 골 연결성 (1-5): Phase 2 초입 포착에 직접 영향하는가?
3. 실행 가능성 (1-5): 개발자가 다음 스프린트에 처리할 수 있는가?
4. 근거 충분성 (1-5): 코드/데이터 증거가 있는가?

총점 12점 이상만 이슈 생성. 미달 시 폐기.
```

---

## 이슈/PR 생성 기준

### 이슈 우선순위 → 라벨 매핑

| 우선순위 | 라벨 | 조건 | issue-processor 처리 |
|----------|------|------|---------------------|
| P1 | `P1`, `strategic-review` | 골 달성에 직접적 블로커 | 처리 대상 |
| P2 | `P2`, `strategic-review` | 포착력 향상 기회 | 처리 대상 |
| P3 | `P3`, `strategic-review` | 장기 개선 항목 | 토요일 요약 이슈에만 |

**중요**: `strategic-review` 라벨 이슈는 issue-processor가 **처리 가능**으로 설정.
(이전 기획의 `auto-review` 라벨 처리 제외 방침과 다름 — 전략 인사이트는 구현 가치가 있음)

### 이슈 제목 포맷

```
[strategic-review/{포커스}] {구체적 개선 내용}

예시:
[strategic-review/capture-logic] getPhase1LateStocks — MA150 기울기 판정 임계값 재검토
[strategic-review/prompt-insight] macro 에이전트 프롬프트 — 달러 강세/섹터 로테이션 연결 추가
[strategic-review/data-source] 공매도 비율 감소 신호 툴 추가 — Phase 1→2 선행 지표
```

### 중복 방지

```
이슈 생성 전 확인:
1. 라벨 `strategic-review`를 가진 오픈 이슈 전체 제목 조회
2. Jaccard 유사도 0.6 이상이면 스킵 (narrativeChainService의 기존 유사도 로직 재사용)
3. 동일 파일/함수 + 동일 문제 유형이면 스킵
4. 기존 이슈가 있고 7일+ 미처리 시 코멘트만 추가
```

### PR 자동 생성 기준

전략적 인사이트의 성격상, PR 자동 생성은 매우 제한적으로만:

| 케이스 | PR 생성 | 이유 |
|--------|---------|------|
| 프롬프트 파일 개선 | O (조건부) | `.claude/agents/` 파일은 텍스트. 명확한 개선이면 PR 생성 |
| 수치 파라미터 조정 | X | 통계적 검증 없이 자동 변경 금지 |
| 새 툴 추가 | X | 비즈니스 로직 구현 필요. 이슈만 생성 |
| DB 쿼리 조건 변경 | X | 데이터 정합성 검증 필요. 이슈만 생성 |

---

## 실행 방식 — launchd 통합

### 신규 cron 스크립트

`scripts/cron/strategic-review.sh`:
- `common.sh` source
- lock file 패턴 (issue-processor와 동일, `/tmp/market-analyst-strategic-review.lock`)
- `npx tsx src/strategic-review/index.ts` 실행
- 실패 시 Discord 에러 알림
- 로그: `logs/strategic-review-YYYY-MM-DD.log`

### 신규 plist

`scripts/launchd/com.market-analyst.strategic-review.plist`:
- 시각: **KST 06:00 매일 (UTC 21:00 전날)**
- 7일 모두 실행 (Weekday 0~6)

### setup-launchd.sh 수정

`PLISTS` 배열에 `com.market-analyst.strategic-review` 추가.
스케줄 안내 출력에 한 줄 추가:
```bash
echo "  Strategic Review: KST 06:00 매일"
```

---

## 구현 페이즈

### Phase 1: 뼈대 + 핵심 리뷰어 2개 (즉시 가치)

| # | 작업 | 완료 기준 | 비고 |
|---|------|----------|------|
| 1-1 | `types.ts` — Insight, Focus, Priority 타입 | 타입 컴파일 통과 | — |
| 1-2 | `deduplicator.ts` — 기존 이슈 중복 체크 | Jaccard 유사도 로직, gh API 호출 | 1-1 후 |
| 1-3 | `issueCreator.ts` — GitHub 이슈 생성 + 라벨링 | P1/P2/P3 라벨, strategic-review 태그 | 1-2와 병렬 |
| 1-4 | `qualityFilter.ts` — 인사이트 품질 검증 | 12점 미달 폐기 로직 | 1-1 후 |
| 1-5 | `captureLogicAuditor.ts` — 포착 로직 감사 | phase-detection/getRisingRS/getPhase1LateStocks 분석 | 1-1 후 |
| 1-6 | `learningLoopAuditor.ts` — 학습 루프 감사 | agentLearnings DB 쿼리 + 분석 | 1-1 후 |
| 1-7 | `index.ts` 오케스트레이터 | 6개 리뷰어 병렬 실행 + 품질 필터 + 이슈 생성 | 1-2~6 후 |
| 1-8 | `scripts/cron/strategic-review.sh` | 로컬 실행 성공, 로그 기록 확인 | 1-7 후 |
| 1-9 | plist + setup-launchd.sh 수정 | `--status`에서 strategic-review 항목 노출 | 1-8 후 |

### Phase 2: 리뷰어 확장 (포착력 직결)

| # | 작업 | 완료 기준 | 비고 |
|---|------|----------|------|
| 2-1 | `promptInsightReviewer.ts` — 프롬프트 맹점 분석 | 4개 페르소나 파일 분석 + 인사이트 생성 | — |
| 2-2 | `debateStructureReviewer.ts` — 토론 엔진 구조 분석 | 3라운드 구조 + 레짐 분류 분석 | 2-1과 병렬 |
| 2-3 | `dataSourceGapFinder.ts` — 데이터 소스 갭 탐색 | 현재 툴 매핑 + 누락 신호 목록 생성 | 2-1과 병렬 |
| 2-4 | `marketStructureReviewer.ts` — 시장 구조 정합성 | recommendations 성과 분석 + 레짐 이력 연동 | 2-1과 병렬 |

### Phase 3: 고도화 (선택)

| # | 작업 | 완료 기준 | 비고 |
|---|------|----------|------|
| 3-1 | 프롬프트 개선 PR 자동 생성 | `.claude/agents/` 파일 수정 PR | — |

---

## 리스크와 대응

| 리스크 | 가능성 | 대응 |
|--------|--------|------|
| LLM 자기참조 루프 — 같은 LLM이 코드를 작성하고 코드를 리뷰 | 중간 | 리뷰어가 비즈니스 로직 정확성 판단 금지. 구조/갭/조건값 분석만. `qualityFilter`로 추상적 판단 차단 |
| 이슈 노이즈 — 매일 P2 이슈가 쏟아져 issue-processor가 포화 | 중간 | 1일 최대 3건 이슈 생성 제한. P3는 토요일 요약에만 배치 |
| 낮은 인사이트 품질 — 모호한 제안이 이슈화 | 중간 | qualityFilter 12점 임계값. Phase 1에서 3일간 로그만 확인 후 임계값 튜닝 |
| phase-detection 오판 감지 반복 — 이미 아는 문제를 매주 재이슈화 | 낮음 | 알려진 이슈 스킵 목록 관리 (`knownIssues` 설정 파일) |
| 맥미니 리소스 경합 — 06:00 실행 시 다른 프로세스와 충돌 | 낮음 | lock file. 06:00은 기존 스케줄 공백 시간대 |

---

## 의사결정 필요

없음 — 다음 사항은 내가 판단하여 반영했다.

1. **strategic-aide와의 중복 처리**: strategic-aide(주간)는 "골 달성 진척도 + 낭비 감지"에 집중. 본 시스템은 "구체적 개선 인사이트 → 이슈화"에 집중. 중복 없음.

2. **issue-processor 연동**: `strategic-review` 라벨 이슈를 issue-processor 처리 대상으로 포함. 코드 품질 이슈(`auto-review`)와 달리, 전략 인사이트는 구현 가치가 있어 자율 처리가 적절하다.

3. **PR 자동 생성 범위**: 프롬프트 파일(`.claude/agents/`) 개선만 자동 PR. 수치 파라미터와 로직 변경은 통계적 검증 없이 자동화 불가.

4. **실행 시각**: KST 06:00. Debate Daily(07:00) 1시간 전. 생성된 이슈가 당일 debate에 영향을 주진 않지만, issue-processor(10:00~)가 처리할 수 있는 시간을 확보한다.

# Decisions: 시장 레짐 분류기 Phase 1

**Date:** 2026-03-09
**Status:** accepted
**Participants:** mission-planner (자율 판단)

---

## Decision 1: Wave 3 대기 없이 Phase 1 선행 착수

**Context**
RFC-narrative-layer.md에서 레짐 분류기는 Wave 3(학습+메타 시스템) 항목으로 분류됨.
Wave 1~2 데이터가 4주 이상 축적된 후 착수하는 것이 원래 계획이었음.
Issue #94에서 LLM 정성 태깅만 먼저 시작하는 Phase 1을 선행 착수하는 방향으로 CEO가 판단.

**Options Considered**

Option A: Wave 3 순서대로 대기
- Pros: Wave 2 데이터가 있어야 레짐 분류 품질이 높아짐
- Cons: 데이터 축적 대기 중에도 레짐 무감각 상태로 운영됨. 정성 태깅은 데이터 의존성 없음.
- Effort: 0일 (대기)
- Risk: 기회비용 — 축적 시작이 늦을수록 레짐별 적중률 분석도 늦어짐

Option B: LLM 정성 태깅만 선행 착수 (Phase 1)
- Pros: 추가 데이터 파이프라인 없이 시작 가능. 데이터 축적 시작이 빠름. Phase 2(정량 분류기) 설계를 위한 실전 경험 확보.
- Cons: 정성 태깅의 일관성 낮을 수 있음. Phase 2에서 재설계 필요.
- Effort: 3~4일
- Risk: 낮음. 기존 토론 흐름에 JSON 필드 하나 추가하는 수준.

**Decision**
Option B 채택. 정성 태깅은 데이터 의존성이 없으므로 지금 시작해도 품질 훼손 없음.
레짐 데이터 축적이 하루라도 빨리 시작되어야 Phase 2 설계 근거를 빨리 얻는다.

---

## Decision 2: 레짐 분류 5단계 체계

**Context**
RFC에서 5단계(EARLY_BULL / MID_BULL / LATE_BULL / EARLY_BEAR / BEAR)를 제안.
단계 수를 줄이면 판정이 쉬워지지만 세밀도 감소. 늘리면 LLM 판정 일관성 저하.

**Options Considered**

Option A: 3단계 (BULL / NEUTRAL / BEAR)
- Pros: 판정 오류 감소, 에이전트에게 단순한 신호
- Cons: "강세장 초입"과 "강세장 후기" 구분 불가. 이 구분이 핵심 목적.
- Risk: 시스템의 핵심 목적인 "초입 포착"에 레짐 정보가 의미 없어짐

Option B: 5단계 RFC 원안
- Pros: EARLY_BULL(적극 포착)과 LATE_BULL(경계)의 구분 가능. 프로젝트 골과 직결.
- Cons: EARLY_BULL vs MID_BULL 경계가 모호할 수 있음.
- Risk: 초기에는 두 단계 간 오판 발생 가능. 단, 이것도 데이터가 되어 향후 분류 기준 개선에 활용.

Option C: 7단계 이상
- Pros: 세밀한 구분
- Cons: LLM이 일관되게 판정하기 어려움. 데이터가 적을 때 각 단계별 샘플이 부족해 분석 불가.
- Risk: 높음

**Decision**
Option B 채택. 5단계가 프로젝트 골(Phase 2 초입 포착)과 가장 직결되며, Phase 1 정성 태깅에 적합한 세밀도.
EARLY_BULL / MID_BULL 경계 모호성은 실운영 데이터를 보며 판정 기준을 문서화하는 방식으로 개선.

---

## Decision 3: 저장 위치 — 별도 테이블 vs theses 컬럼

**Context**
레짐 정보를 어디에 저장할 것인가. 두 가지 후보:
(a) `theses` 테이블에 `market_regime` 컬럼 추가
(b) 별도 `market_regimes` 테이블

**Options Considered**

Option A: theses 테이블 컬럼 추가
- Pros: 테이블 추가 없음, 기존 인프라 그대로
- Cons: 레짐은 debate-level 속성인데 thesis-level 테이블에 중복 저장됨. 같은 날 5개 thesis가 있으면 같은 레짐이 5번 저장. 레짐별 집계 쿼리가 복잡해짐.
- Risk: 중복 저장 + 일관성 문제 (5개 thesis의 regime이 다를 수는 없는데 그렇게 보임)

Option B: 별도 market_regimes 테이블 (debate_date UNIQUE)
- Pros: 레짐이 debate-level 엔티티로 명확히 분리. 집계 쿼리 단순. 향후 정량 분류기로 교체 시 이 테이블만 변경.
- Cons: 테이블 하나 더 추가.
- Risk: 낮음

**Decision**
Option B 채택. 레짐은 per-debate 속성이고 per-thesis 속성이 아님.
논리적 분리가 향후 Phase 2(정량 분류기) 교체 시에도 인터페이스 유지를 쉽게 한다.

---

## Decision 4: 태깅 주체 — macro-economist 직접 호출 vs moderator 종합

**Context**
레짐 판정을 누가 할 것인가. macro-economist가 가장 적합한 역할이지만, 구현 방식이 다름:
(a) round3에서 moderator가 macro-economist의 round1 분석을 참조하여 태그 출력
(b) 토론 후 macro-economist를 별도로 한 번 더 호출하여 레짐 판정

**Options Considered**

Option A: moderator가 round3에서 종합 출력 (현재 구조 활용)
- Pros: 추가 API 호출 없음. 비용 동일. moderator가 모든 라운드 분석을 종합한 후 판정하므로 더 많은 컨텍스트 활용.
- Cons: moderator의 판정이 macro 관점보다 "종합적 타협점"에 가까울 수 있음.
- Effort: 낮음 (프롬프트 수정만)

Option B: macro-economist 별도 호출
- Pros: 레짐 판정 전문성 높음
- Cons: API 호출 1회 추가 (~$0.05/일 = ~$1.5/월). 현재 구조에서 round3 이후 별도 단계 추가 필요.
- Effort: 중간

**Decision**
Option A 채택. moderator는 이미 모든 라운드를 종합하는 역할이며, macro-economist의 round1 분석이 인풋으로 들어가 있음. 레짐 판정에 필요한 정보는 충분히 전달됨. 비용 절감 + 구현 단순성.
Phase 2에서 정량 분류기로 교체되면 이 결정은 자연스럽게 obsolete됨.

---

## Decision 5: Phase 1 행동 조정 방식 — 자동 차단 vs 컨텍스트 주입

**Context**
레짐 정보를 어떻게 시스템 행동에 반영할 것인가.
RFC에서는 EARLY_BEAR 시 "신규 추천 중단"까지 제안했음.

**Options Considered**

Option A: 자동 행동 조정 (레짐에 따라 추천 차단/허용)
- Pros: 레짐 효과가 즉시 나타남. 약세장에서 위양성 감소.
- Cons: 레짐 판정이 틀렸을 때 좋은 기회를 놓침. 정성 태깅의 신뢰도가 아직 검증되지 않음.
- Risk: 높음 — 검증 전 자동화는 RFC에서도 경고됨 ("초기에는 참고 정보로만 사용")

Option B: 컨텍스트 주입만 (에이전트 자율 판단)
- Pros: 안전함. 에이전트가 레짐을 참고하여 스스로 판단 조절. 레짐 오판 시 에이전트가 다른 정보로 보정 가능.
- Cons: 에이전트가 레짐 정보를 무시할 수도 있음.
- Risk: 낮음

**Decision**
Option B 채택. Phase 1은 데이터 축적 단계. 레짐별 적중률이 실제로 유의미하게 다른지 먼저 확인한 후(3개월+), 그 데이터를 근거로 Phase 2에서 자동 행동 조정을 결정.
검증 없는 자동화는 "LLM 백테스트"와 유사한 오류 경로.

---

## Architecture Summary

```
토론 실행 (기존)
  ↓
round3-synthesis.ts
  ├── theses 추출 (기존)
  └── marketRegime 추출 (신규) ─→ regimeStore.saveRegime()
                                        ↓
                               market_regimes 테이블

주간 에이전트 실행
  ├── loadRecentRegimes(30) ─→ formatRegimeForPrompt()
  └── 시스템 프롬프트에 주입 → 에이전트 자율 판단

추천 저장
  ├── loadLatestRegime()
  └── recommendations.market_regime 에 스냅샷 기록
```

**Phase 2 (향후, 데이터 축적 후)**
- 정량 지표(브레드스, VIX, 금리) 기반 분류기로 정성 태깅을 보완/대체
- 레짐별 적중률 통계 분석 후 자동 행동 조정 여부 결정
- `market_regimes` 테이블 인터페이스는 그대로 유지

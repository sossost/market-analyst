# 서사 레이어 Wave 2a — N+1 병목 예측 + 공급 과잉 전환 신호

**이슈**: #89
**날짜**: 2026-03-08
**작성**: mission-planner

---

## 선행 맥락

**Wave 1 완료 현황 (코드베이스 분석 기반):**

Round3 프롬프트(`round3-synthesis.ts`)에 이미 다음이 구현되어 있다:
- `nextBottleneck` 필드: structural_narrative thesis에만 작성하는 "다음 병목 예측"
- `dissentReason` 필드: 반대 의견 요약
- `consensusScore` DB 필드: 합의도 정수값
- thesis `category` 3분류: `structural_narrative` / `sector_rotation` / `short_term_outlook`

애널리스트 페르소나 4명 모두 시스템 프롬프트에 "### 5. 수요-공급-병목 구조 분석" 섹션이 추가되어 있다 (macro-economist.md, tech-analyst.md, geopolitics.md, sentiment-analyst.md 확인).

**현재 갭:**
- `nextBottleneck`이 round3 JSON에 필드로 존재하지만, **라운드 1·2 프롬프트에서 N+1 예측을 명시적으로 요구하지 않는다**. 결과적으로 애널리스트들이 병목을 식별하더라도 "다음에 어디가 병목이 될 것인가"를 체계적으로 추론하지 않는다.
- **공급 과잉 전환 신호(CAPEX 급증, 신규 공장 착공, 경쟁사 진입)**를 뉴스에서 감지하는 프레임이 없다. `news_archive`에 `CAPEX` 카테고리가 존재하고 tech persona가 구독하지만, "이것이 병목 해소 신호인가"로 해석하는 프롬프트 로직이 없다.
- 토론 라운드 1에서 병목 생애주기(ACTIVE → RESOLVING → RESOLVED → OVERSUPPLY)를 명시적으로 판단하지 않는다.

**RFC 로드맵 위치**: Wave 2 (1-E 병목 생애주기 추적 + 1-F N+1 병목 예측 + 이탈 타이밍 판단). Wave 1은 완료.

---

## 골 정렬

**ALIGNED**

- **N+1 예측**: "현재 병목이 해소되면 다음 병목은 어디인가"를 지금 식별하면, 다음 주도섹터 후보를 시장보다 먼저 리스트에 올릴 수 있다. Phase 2 초입 포착의 직접 도구.
- **공급 과잉 감지**: 병목 해소 → 공급 과잉 전환 신호를 포착하면 이탈 타이밍 판단이 가능해진다. 알파 보존의 핵심. "언제 들어가는가"만큼 "언제 나오는가"가 알파를 결정한다.

두 기능 모두 프로젝트 골의 핵심 두 축(초기 진입 + 이탈 타이밍)에 직접 기여한다.

---

## 문제

현재 시스템은 "어디로 자금이 들어가는가"는 보지만 "병목이 언제 끝나는가"와 "다음 병목은 어디인가"를 체계적으로 추론하지 않는다. 결과적으로 진입은 포착하지만 이탈 타이밍과 다음 알파 기회를 놓친다.

---

## Before → After

**Before**
- 라운드 1: 4명 애널리스트가 병목을 식별하지만 생애주기 상태(ACTIVE/RESOLVING/OVERSUPPLY)를 판단하지 않음
- 라운드 2: 크로스파이어에서 병목 관련 반박은 있지만 "공급 과잉 신호인가" 프레임 없음
- 라운드 3: `nextBottleneck` 필드는 있지만 라운드 1·2에서 데이터가 축적되지 않아 생성률이 낮음
- news_archive CAPEX 뉴스: tech persona가 구독하지만 "병목 해소 신호"로 해석되지 않음

**After**
- 라운드 1: 각 애널리스트가 담당 영역에서 현재 병목 상태를 명시적으로 판단하고, N+1 병목 후보를 추론
- 라운드 2: 크로스파이어에서 "이 CAPEX/뉴스는 병목 해소 신호인가, 아니면 아직 초기인가"를 반박 포인트로 활용
- 라운드 3: 충분한 라운드 1·2 데이터를 바탕으로 `nextBottleneck`이 실질적 예측값을 가짐
- 전체 토론: 병목 생애주기(ACTIVE→RESOLVING→RESOLVED→OVERSUPPLY) 용어와 판단 기준이 프롬프트에 명시됨

---

## 변경 사항

### 변경 1: 라운드 1 질문 프레임 추가 (`debateEngine.ts` 또는 질문 생성 로직)

**현재 상태 파악 필요**: `debateEngine.ts`를 확인하여 라운드 1에 전달되는 `question` 문자열이 어디서 생성되는지 확인. `run-daily-agent.ts` 또는 `run-weekly-agent.ts`에서 생성될 가능성이 높음.

**변경 내용**: 라운드 1 질문에 다음 섹션을 추가한다.

```
## 병목 생애주기 판단 (필수)

당신의 전문 영역에서 현재 주요 병목에 대해 다음을 명시적으로 판단하라:

1. **현재 병목 상태**: 아래 중 하나로 분류
   - ACTIVE: 병목 진행 중. 수혜주 상승 구간.
   - RESOLVING: 병목 해소 진행 중. 다음 신호 감지 시작.
     신호 예시: 대규모 CAPEX 발표, 경쟁사 진입, 신규 공장 착공, 리드타임 단축 뉴스
   - RESOLVED: 공급 충족. 수혜주 모멘텀 둔화 시작.
   - OVERSUPPLY: 공급 과잉. 수혜주 하락 위험.

2. **RESOLVING/OVERSUPPLY 신호**: 다음 중 하나라도 해당하면 주의 표기
   - 동일 분야 CAPEX 발표가 최근 3개월간 3건 이상
   - 과거에 없던 경쟁사 진입 발표
   - 신규 공장 착공 또는 증설 발표
   - 리드타임 단축 또는 재고 증가 뉴스

3. **N+1 병목 예측**: 현재 병목이 해소된다면 공급 체인의 다음 제약 지점은 어디인가?
   예시: GPU 병목 해소 → 다음 제약은 HBM인가, 광트랜시버인가, 데이터센터 전력인가?
   확신이 없으면 "불명확"으로 표기. 억지로 예측하지 말 것.
```

### 변경 2: 라운드 2 크로스파이어 프롬프트 추가 (`round2-crossfire.ts`)

`buildCrossfirePrompt` 함수의 반박 섹션에 추가:

```
### 4. 병목 판단 교차 검증 (선택, 이견이 있을 경우)
라운드 1에서 서로 다른 병목 상태 판단이 있을 경우:
- 어느 판단이 더 근거가 있는가?
- RESOLVING 신호로 제시된 뉴스가 실제 신호인가, 아직 초기 투자인가?
  (CAPEX 발표는 병목 해소 시그널이 아니라 수요 확인 시그널일 수 있다)
- 각자가 제시한 N+1 병목 예측 중 더 가능성 높은 것은?
```

### 변경 3: 라운드 3 합성 프롬프트 강화 (`round3-synthesis.ts`)

`buildSynthesisPrompt` 함수 내 "### 4. 주도섹터/주도주 전망" 섹션에 하위 항목 추가:

```
#### 병목 생애주기 현황
- 현재 주요 병목의 상태: ACTIVE / RESOLVING / RESOLVED / OVERSUPPLY
- RESOLVING 이상 신호가 감지된 경우: "이탈 준비 시점 검토" 명시
- N+1 병목 예측: 애널리스트들의 예측을 종합하여 다음 주목할 공급 체인 노드 제시
  (3명 이상이 동일 지점을 지목한 경우 "강한 예측"으로 표기)
```

thesis JSON의 `nextBottleneck` 작성 규칙 보강:

```
**nextBottleneck 작성 규칙 (강화):**
- structural_narrative 카테고리에만 작성.
- 라운드 1·2에서 2명 이상이 동일 지점을 언급한 경우에만 작성. 그 외는 null.
- 형식: "공급 체인 노드 + 예상 시점" (예: "HBM 용량 제한 — GPU 병목 해소 후 2~3분기 내")
- 현재 병목이 ACTIVE 초기 단계라면 null (아직 N+1을 논하기 이름)
```

### 변경 4: 뉴스 로더 CAPEX 카테고리 해석 강화 (`newsLoader.ts`)

`PERSONA_CATEGORY_MAP`에서 tech만 CAPEX를 구독하는 현황 유지. 단, 뉴스 포맷 문자열에 CAPEX 뉴스임을 명시하여 애널리스트가 병목 해소 판단에 활용하도록 한다.

현재:
```typescript
return `- ${title}\n  ${description}\n  (source: ${source}, category: ${row.category})`;
```

변경:
```typescript
const capexNote = row.category === "CAPEX" ? " [CAPEX/설비투자 뉴스 — 병목 해소 신호 가능성 검토]" : "";
return `- ${title}${capexNote}\n  ${description}\n  (source: ${source}, category: ${row.category})`;
```

이것만으로도 애널리스트가 CAPEX 뉴스를 병목 판단에 연결하는 빈도가 높아진다. DB 스키마 변경 없음.

### 변경 5: DB 스키마 — narrative_chains 테이블 (선택적, Wave 2b로 연기 권고)

RFC 1-C에서 제안한 `narrative_chains` 테이블은 **이번 Wave 2a에서 구현하지 않는다.**

**판단 근거:**
- 프롬프트 변경만으로 N+1 예측과 공급 과잉 감지 기능이 작동한다. DB 테이블 없이도 `theses.nextBottleneck` 필드에 축적된다.
- `narrative_chains`는 서사 체인을 독립 엔티티로 관리할 때 필요하다. 현재 thesis 1개당 nextBottleneck 1개를 저장하는 구조로 충분히 데이터를 축적할 수 있다.
- DB 스키마 변경은 마이그레이션 비용이 발생하고, 데이터 없이 테이블만 만드는 것은 의미가 없다.
- 프롬프트 변경으로 4주 이상 데이터를 축적한 뒤, nextBottleneck 패턴이 실제로 나타나는지 확인 후 Wave 2b에서 narrative_chains 도입을 검토하는 것이 올바른 순서다.

---

## 작업 계획

### Phase 1: 코드 탐색 (탐색 에이전트)

**목적**: debateEngine.ts에서 라운드 1 질문이 어디서 생성되는지 확인.

**완료 기준**: 라운드 1 질문 문자열의 생성 위치 파악 + 변경할 파일·함수·라인 번호 명시.

**예상 파일**: `src/agent/debate/debateEngine.ts`, `src/agent/run-daily-agent.ts`, `src/agent/run-weekly-agent.ts`

### Phase 2: 구현 (구현 에이전트, Phase 1 완료 후)

**2-A. 라운드 1 질문 프레임 추가**
- 변경 파일: Phase 1에서 확인된 질문 생성 위치
- 변경 내용: "변경 1" 텍스트 추가
- 완료 기준: 라운드 1 질문에 병목 생애주기 판단 섹션이 포함됨

**2-B. 라운드 2 크로스파이어 프롬프트 추가**
- 변경 파일: `src/agent/debate/round2-crossfire.ts`
- 변경 함수: `buildCrossfirePrompt`
- 완료 기준: 병목 판단 교차 검증 섹션이 반박 프롬프트에 추가됨

**2-C. 라운드 3 합성 프롬프트 강화**
- 변경 파일: `src/agent/debate/round3-synthesis.ts`
- 변경 함수: `buildSynthesisPrompt`
- 완료 기준: 병목 생애주기 현황 섹션 추가 + nextBottleneck 규칙 보강

**2-D. 뉴스 로더 CAPEX 표기 추가**
- 변경 파일: `src/agent/debate/newsLoader.ts`
- 변경 함수: `loadNewsForPersona` 내 포맷 문자열
- 완료 기준: CAPEX 카테고리 뉴스에 `[CAPEX/설비투자 뉴스]` 태그 추가

**2-A~2-D는 서로 독립적이므로 병렬 구현 가능.**

### Phase 3: 테스트 (구현 에이전트, Phase 2 완료 후)

기존 테스트가 있는 함수의 회귀 검증:
- `buildCrossfirePrompt` — 반환 문자열에 병목 섹션 포함 여부
- `buildSynthesisPrompt` — 병목 생애주기 섹션 포함 여부
- `loadNewsForPersona` — CAPEX 뉴스에 태그 추가 여부
- `extractThesesFromText` — nextBottleneck null/string 정규화 기존 동작 유지

**신규 테스트 대상:**
- CAPEX 태그 추가 로직 단위 테스트

---

## 수용 기준 (Acceptance Criteria)

- [ ] 라운드 1 프롬프트에서 애널리스트가 ACTIVE/RESOLVING/RESOLVED/OVERSUPPLY 중 하나로 병목 상태를 명시할 수 있는 구조적 유도가 있다
- [ ] 라운드 1 프롬프트에서 "현재 병목이 해소된다면 다음 제약 지점은?" 질문이 명시적으로 포함된다
- [ ] 라운드 2 프롬프트에서 병목 판단 이견이 있을 경우 교차 검증하는 섹션이 있다
- [ ] 라운드 3 합성 프롬프트에서 병목 생애주기 현황을 요약하는 섹션이 있다
- [ ] `nextBottleneck` 작성 기준이 "2명 이상 동일 지점"으로 명확화되었다
- [ ] `news_archive`의 CAPEX 뉴스가 프롬프트에서 병목 해소 판단 자료로 식별된다
- [ ] 기존 테스트 전체 통과 (회귀 없음)
- [ ] 신규 로직에 대한 단위 테스트 추가

---

## 리스크

| 리스크 | 수준 | 대응 |
|--------|------|------|
| LLM이 프롬프트를 무시하고 ACTIVE만 선택 | 중간 | 첫 토론 실행 후 출력 모니터링. 무시 비율 높으면 few-shot 예시 추가 검토 |
| 라운드 1 프롬프트 길이 증가로 토큰 비용 상승 | 낮음 | 병목 섹션은 약 200토큰 추가. 4명 × 1회 = ~800토큰. 허용 범위 |
| CAPEX 뉴스를 병목 해소 신호로 오해 | 중간 | 라운드 2에서 명시적으로 "CAPEX는 수요 확인 신호일 수 있다"를 크로스파이어에 포함 |
| `nextBottleneck` 생성률이 낮아 데이터 축적 속도가 느림 | 낮음 | 주 5회 토론 × "2명 이상 동의"라는 엄격한 기준이 낮은 생성률로 이어질 수 있음. 기준을 "1명 이상"으로 완화할지는 데이터 확인 후 결정 |
| narrative_chains 없이 병목 생애주기를 추적할 데이터 구조 부재 | 낮음 | theses.nextBottleneck에 축적. 이후 Wave 2b에서 별도 집계 로직 추가 |

---

## 의사결정 필요

없음 — 이슈의 "프롬프트 레벨 변경 위주, DB 스키마 변경 최소화" 방향과 완전히 일치. 자율 판단하여 진행 가능.

단, 구현 후 참고 사항:
- `nextBottleneck` 생성 기준("2명 이상")이 엄격하다면, 첫 4주 데이터 확인 후 "1명 이상"으로 완화 여부를 결정할 것.
- `narrative_chains` 테이블은 Wave 2b에서 재검토. 이번에는 생략.

# Decisions: 주간 리포트 전면 재설계

GitHub Issue: #69

## Decision 1: 도구 분리 vs 파라미터 추가

**Date:** 2026-03-08
**Status:** accepted

### Context
주간 집계를 지원하기 위해 (A) 기존 도구에 `mode` 파라미터 추가 vs (B) `getWeeklyIndexReturns` 등 별도 도구 생성.

### Options
| | 파라미터 추가 | 도구 분리 |
|--|-------------|----------|
| 호환성 | 기본값 "daily"로 하위 호환 | 기존 도구 불변, 새 도구 추가 |
| 코드 중복 | 없음 | 쿼리/파싱 로직 중복 |
| 프롬프트 | tool 목록 불변 | 새 도구 설명 추가 필요 → 토큰 증가 |
| 복잡도 | 분기 로직 추가 | 파일 증가 |

### Decision
**파라미터 추가.** 코드 중복 방지 + 프롬프트 토큰 절약 + 일간 에이전트 무영향.

---

## Decision 2: 주간 기준일 고정 vs 에이전트 판단

**Date:** 2026-03-08
**Status:** accepted

### Context
주간 모드 호출 시 "이번 주"의 기준을 누가 결정하는가.

### Decision
**직전 금요일 고정.** 도구 내부에서 `targetDate` 기준 직전 5거래일을 자동 계산. 에이전트가 날짜를 직접 계산하면 실수 리스크가 있다. 에이전트는 `mode: "weekly"`만 지정하면 된다.

---

## Decision 3: 신규 도구 추가 여부

**Date:** 2026-03-08
**Status:** accepted

### Context
섹터 로테이션 전용 도구(`getWeeklySectorRotation`) 등 신규 도구 필요성.

### Decision
**이번엔 안 함.** 기존 `getLeadingSectors`에 전주 비교를 추가하면 로테이션 분석 충분. 과잉 설계 방지. 추후 로테이션 분석이 더 깊어져야 하면 그때 분리.

---

## Decision 4: 주간 리포트의 역할 정의

**Date:** 2026-03-08
**Status:** accepted
**Participants:** macro-economist, tech-analyst, sentiment-analyst, mission-planner, chief-of-staff

### Context
주간 리포트가 일간과 어떻게 차별화되어야 하는가.

### Decision

일간 = "오늘의 시그널" / 주간 = "이번 주 구조가 어떻게 바뀌었는가"

주간 고유 콘텐츠 5가지:
1. 섹터 RS 순위 주간 변동 → 로테이션 방향 판단
2. Phase 2 비율 5일 추이선 → 모멘텀 가속/감속
3. 신규 Phase 2 전환 x 섹터 RS 동반 상승 교집합 → 핵심 주도주 후보
4. 추천 코호트 주간 성과 + 오판 공개 → 시스템 신뢰도
5. 전주 판단 사후 검증 → 매크로 예측의 가치는 추적과 복기에서 나온다

### Consequences
- 프롬프트에서 "절대값 나열" 지시 제거, "방향과 속도" 해석 지시로 교체
- 도구 반환값에 전주 비교 데이터 추가 필요
- thesis 충돌 시 에이전트의 컨트래리안 판단 허용

---

## Decision 5: 구조적 변화 vs 일회성 구분 기준

**Date:** 2026-03-08
**Status:** accepted
**Participants:** sentiment-analyst

### Context
주간에서 노이즈를 걸러내는 기준이 필요.

### Decision
**섹터 RS 4주 추세와 이번 주 상위 섹터의 일치 여부로 판단.**
- 일치 = 구조적 변화 (추세 지속)
- 불일치 = 일회성 이벤트 (뉴스 드리븐)
- 이 규칙을 프롬프트에 명시. 도구 변경 불필요 (기존 `change_4w` 컬럼 활용).

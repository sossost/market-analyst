# Plan: tech 에이전트 thesis ACTIVE 적체 해소 — 에이전트별 ACTIVE 상한

## 문제 정의

tech 에이전트의 ACTIVE thesis가 16건으로 전체 ACTIVE 34건 중 47% 차지. 검증 파이프라인 병목 형성.

- tech confirmed+invalidated = 5건, ACTIVE = 16건 → 76% 미검증
- 다른 에이전트는 ACTIVE 비율 38~50%로 정상 범위
- tech thesis가 개별 종목/AI 인프라 트렌드에 집중 → 검증 조건이 장기(90일, +30%)라 검증 지연
- 미검증 thesis 누적 → 학습 루프(agent_learnings) 정체 → 같은 패턴 재생산 자기강화 루프 위험

## 골 정렬

- **판정**: ALIGNED
- **근거**: 학습 루프는 시스템의 핵심 피드백 경로. thesis가 검증되지 않으면 agent_learnings에 반영되지 않고, 시스템이 동일한 패턴의 thesis를 맹목적으로 재생산한다. ACTIVE 상한 도입은 학습 루프 건강도를 직접 개선하여 주도섹터/주도주 포착 정확도 향상에 기여.

## 무효 판정

- **판정**: 해당 없음
- **근거**: DB 실데이터 기반 (tech ACTIVE 16건, 전체 34건). LLM 백테스트가 아닌 운영 데이터에서 병목이 관측됨.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| ACTIVE thesis 상한 | 없음 (무제한 누적) | 에이전트당 MAX 10건 |
| 상한 초과 시 | 해당 없음 | 가장 오래된 ACTIVE thesis를 EXPIRED 처리 (closeReason: `cap_exceeded`) |
| 적용 시점 | 해당 없음 | `saveTheses()` 실행 시 새 thesis 삽입 후 자동 적용 |
| 기존 적체 16건 | 수동 정리 필요 | 다음 토론 실행 시 자동으로 10건 이하로 정리 |

## 변경 사항

### 1. `src/debate/thesisStore.ts` — ACTIVE 상한 로직

- `MAX_ACTIVE_THESES_PER_AGENT = 10` 상수 추가
- `enforceActiveThesisCap(today: string): Promise<number>` 함수 추가:
  - 에이전트별 ACTIVE 카운트 조회
  - 상한 초과 에이전트의 가장 오래된 thesis를 EXPIRED 처리
  - closeReason: `cap_exceeded`
  - 만료된 건수 반환
- `saveTheses()` 내부에서 새 thesis 삽입 후 `enforceActiveThesisCap()` 호출

### 2. `src/debate/__tests__/thesisActiveCap.test.ts` — 단위 테스트

- 상한 이하 → 만료 없음
- 상한 초과 → 초과분만 만료
- 복수 에이전트 → 초과 에이전트만 영향
- 정확히 상한 = 만료 없음

## 작업 계획

1. `thesisStore.ts`에 상수 및 `enforceActiveThesisCap()` 함수 추가
2. `saveTheses()`에 cap enforcement 통합
3. 단위 테스트 작성 및 실행
4. 전체 테스트 스위트 통과 확인

## 리스크

- **유효 thesis 조기 만료**: 오래된 thesis가 아직 유효할 수 있으나, ACTIVE 상한 없이는 학습 루프가 정체됨. 상한 10건은 다른 에이전트(5~8건)와 비교해 충분한 여유.
- **기존 데이터 일괄 처리**: 다음 `saveTheses()` 호출 시 자동 정리되므로 별도 마이그레이션 불필요.

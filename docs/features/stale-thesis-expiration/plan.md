# Plan: Stale Thesis 자동 만료

## 문제 정의

ACTIVE 상태로 30일 이상 판정 지연된 thesis 5건(id 2,7,8,10,15)이 존재한다.

**근본 원인**: 정량 검증 불가 + LLM HOLD 반환 시 80% 진행률까지 만료되지 않는 구조적 공백.
- id 2,7,8: targetCondition이 정성적 → 정량 검증기 불가, LLM도 HOLD 반환
- id 10,15: 수치 목표 있으나 시장가 괴리 커 HOLD 지속

**영향**:
1. 에이전트별 ACTIVE 상한(10건) 슬롯 점유 → 새 thesis 생성 차단
2. 학습 루프(agent_learnings) 갱신 지연
3. 불필요한 LLM 검증 비용

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| Stale thesis 5건 | ACTIVE (32일째) | EXPIRED (즉시) |
| HOLD 강제 만료 임계 | 진행률 80% (90일 thesis → 72일) | 진행률 50% (90일 thesis → 45일) |
| 안전망 | 없음 | `expireStalledTheses()` — 진행률 50%+ 무판정 thesis 자동 만료 |
| 슬롯 회수 | 90일 후 | 최대 timeframe의 50% 후 |

## 변경 사항

### Phase 1: 즉시 데이터 수정 (Migration)

- `db/migrations/0031_stale_thesis_expiration.sql`
- thesis id 2,7,8,10,15를 EXPIRED로 전환
- closeReason: `stale_unverifiable`
- verificationDate: `2026-04-06`

### Phase 2: 구조적 예방 (Code)

1. **`src/debate/thesisVerifier.ts`**
   - `HOLD_EXPIRE_PROGRESS` 상수: 0.8 → 0.5
   - LLM HOLD 판정 시 진행률 50% 이상이면 즉시 강제 만료

2. **`src/debate/thesisStore.ts`**
   - `STALE_EXPIRE_PROGRESS = 0.5` 상수 추가
   - `expireStalledTheses(today)` 함수 추가
   - 진행률 50%+ AND timeframe 미초과 AND status=ACTIVE → EXPIRED
   - closeReason: `stale_no_resolution`
   - LLM 검증 실패 시에도 독립적으로 동작하는 안전망

3. **`src/agent/run-debate-agent.ts`**
   - step [2.6] 이후에 `expireStalledTheses()` 호출 추가

### Phase 3: 테스트

- `expireStalledTheses()` 단위 테스트
- `HOLD_EXPIRE_PROGRESS = 0.5` 반영된 `findHighProgressHolds` 테스트 업데이트

## 작업 계획

1. Migration SQL 작성 → Phase 1 완료
2. thesisVerifier.ts 상수 변경 → Phase 2-1
3. thesisStore.ts 함수 추가 → Phase 2-2
4. run-debate-agent.ts 통합 → Phase 2-3
5. 테스트 작성/업데이트 → Phase 3
6. 전체 테스트 통과 확인

## 리스크

| 리스크 | 대응 |
|--------|------|
| 50% 임계가 정당한 HOLD thesis를 조기 만료 | 30/60/90일 thesis 기준 15/30/45일 — 판정 불가 thesis 제거 이득이 더 큼 |
| Migration이 이미 만료된 thesis를 건드릴 가능성 | `status = 'ACTIVE'` 조건으로 방어 |
| `expireStalledTheses`가 `resolveOrExpireStaleTheses`와 중복 | timeframe 초과 조건 제외로 분리 |

## 골 정렬

- **ALIGNED** — thesis 슬롯 회수로 Phase 2 주도섹터 포착 역량 직접 복구. 학습 루프 정상화.

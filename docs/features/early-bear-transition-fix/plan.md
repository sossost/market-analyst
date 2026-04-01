# Plan: EARLY_BEAR → EARLY_BULL 전환 경로 복원

> Closes #535 | Lite 트랙 (단순 수정)

## 문제 정의

`ALLOWED_TRANSITIONS` 맵에서 `EARLY_BEAR`의 허용 전환이 `["BEAR", "LATE_BULL"]`로 정의되어 있어:

1. **EARLY_BULL 누락**: 약세 → 회복 경로(EARLY_BEAR → EARLY_BULL)가 없음. 시장이 회복 국면에 진입해도 시스템이 EARLY_BEAR에 영구 잠김
2. **LATE_BULL 직행 경로**: EARLY_BEAR → LATE_BULL은 Weinstein Phase 모델에 위배. 초기 약세에서 후기 강세로 2단계를 건너뛸 수 없음

**영향**: Bear Gate가 영원히 닫혀 신규 추천 불가 → Phase 2 포착 골에 직접적 장애.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| EARLY_BEAR 허용 전환 | `["BEAR", "LATE_BULL"]` | `["BEAR", "EARLY_BULL"]` |
| 약세 회복 경로 | 차단됨 | EARLY_BEAR → EARLY_BULL → MID_BULL |
| LATE_BULL 직행 | 허용 (비논리적) | 차단 |

## 변경 사항

### 1. `src/debate/regimeStore.ts`
- **71행**: `EARLY_BEAR: new Set(["BEAR", "LATE_BULL"])` → `new Set(["BEAR", "EARLY_BULL"])`
- **60-66행**: 설계 원칙 주석에 약세 회복 경로(`EARLY_BEAR → EARLY_BULL`) 추가, LATE_BULL 직행 관련 제거

### 2. `src/debate/__tests__/regimeHysteresis.test.ts`
- **추가**: EARLY_BEAR → EARLY_BULL 허용 전환 테스트
- **추가**: EARLY_BEAR → LATE_BULL 금지 전환 테스트

## 골 정렬

- **ALIGNED** — Phase 2 포착 골의 전제조건(약세 회복 감지)을 복원하는 P0 수정

## 무효 판정

- **해당 없음** — 기존 버그 수정이며, 새 기능 추가가 아님

## 리스크

| 리스크 | 판단 |
|--------|------|
| 기존 dwell time/cooldown 간섭 | 없음 — 히스테리시스 로직은 전환 맵과 독립 |
| DB pending 데이터 영향 | 없음 — 다음 applyHysteresis 실행 시 자연 재평가 |
| 스트레스 교차검증 | 무관 — EARLY_BULL은 BULL_REGIMES에 포함되어 VIX+공포탐욕 AND 조건 시 여전히 차단 |

## 작업 계획

1. `regimeStore.ts` — ALLOWED_TRANSITIONS 수정 + 주석 갱신
2. `regimeHysteresis.test.ts` — 허용/금지 전환 테스트 추가
3. 전체 테스트 실행 → 통과 확인
4. 커밋 → PR

# Plan: 학습 루프 퇴화 해소 (#427)

## 문제 정의

`agent_learnings` 활성 항목 2건. 같은 기간 thesis 판정 완료 24건(CONFIRMED 13 + INVALIDATED 11). 학습 추출률 8.3%.

**근본 원인**: 기존 학습의 `sourceThesisIds`에 포함되지 않은 새 thesis가 같은 persona+metric 패턴이어도 기존 학습에 흡수되지 않음. 새 thesis 단독으로는 cold start 기준(minHits=2, minTotal=3)을 충족 못 해 영구 고아 상태.

구체적 흐름:
1. Learning A가 thesis [1, 2]로 생성됨 (hitCount=2)
2. 새 thesis #10 (같은 persona+metric) CONFIRMED
3. thesis #10은 Learning A의 sourceThesisIds에 없으므로 `existingSourceIds`에서 제외 → 후보 풀로 진입
4. 하지만 #10 혼자서는 minHits=2 미달 → 승격 불가
5. Learning A의 hitCount는 영원히 2 → 성숙도 게이트(hitCount < 3)에 취약

**부차 원인**: 메트릭 정규화 누락 (WTI 등 commodity 관련 별칭 부재)

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 새 thesis 흡수 | 기존 학습에 미흡수, 고아 상태 | 같은 persona+metric thesis 자동 흡수 |
| 메트릭 정규화 | 지수+섹터만 지원 | WTI, Gold 등 commodity 추가 |
| 헬스체크 | 활성 0건 경고만 | 추출률(learnings/judged) 로깅 추가 |

## 변경 사항

### 1. `absorbNewTheses` 함수 추가 (`promote-learnings.ts`)
- `updateLearningStats` 직후 실행
- 기존 활성 학습의 principle에서 persona+metric 추출
- 새 thesis(existingSourceIds에 없는)가 같은 persona+metric이면 sourceThesisIds에 추가
- hitCount/missCount 재계산

### 2. 메트릭 정규화 확장 (`promote-learnings.ts`)
- `METRIC_ALIASES`에 WTI, gold, crude oil 등 commodity 별칭 추가

### 3. 헬스체크 개선 (`promote-learnings.ts`)
- `checkLearningLoopHealth`에 추출률 로깅 추가
- 추출률 < 20% 시 경고

## 작업 계획

1. `absorbNewTheses` 구현 + main() 파이프라인에 삽입
2. `METRIC_ALIASES` 확장
3. 헬스체크 개선
4. 테스트 작성/업데이트

## 리스크

- **이중 카운트**: sourceThesisIds 중복 삽입 방지 필요 → Set으로 dedup
- **기존 학습 principle 변경**: 흡수 시 principle 텍스트 업데이트 필요 (적중 횟수/관측수 갱신)

## 골 정렬

**ALIGNED** — 학습 루프는 Phase 2 주도섹터/주도주 초입 포착의 핵심 피드백 메커니즘. 학습이 축적되지 않으면 동일 실패 패턴 반복.

## 무효 판정

해당 없음 — LLM 백테스트, 정량 편향 조작 등 무효 패턴에 해당하지 않음. 실제 파이프라인 로직 수정.

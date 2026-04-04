# Plan: 포착 도구 임계값 구조적 교정

**이슈**: #621
**트랙**: Lite (구조적 버그픽스/강화)
**날짜**: 2026-04-04

## 문제 정의

Phase 2 포착 도구의 핵심 임계값들이 통계적 근거 없이 설정되어 있고, 구조적 허점이 존재:

1. **group-phase 최소 종목 수 부재**: `phase2Ratio >= 0.3`만 검사하여 섹터 내 종목 3개 중 1개만 Phase 2여도 통과 (33% > 30%). 소규모 섹터에서 noise Phase 2 판정 위험.
2. **fundamental Grade B 조건 허술**: `requiredMet >= 1 && bonusMet >= 1`이면 B등급. EPS 성장만 통과 + bonus 1개(epsAcceleration 또는 marginExpansion)면 revenue 성장 없이도 B등급 획득 가능.
3. **교집합 필터 convictionLevel 미비**: `computeOverlapStocks`가 이미 교집합을 계산하나, 확신 수준(conviction level)이 프로그래밍적으로 명시되지 않아 다른 모듈에서 활용하기 어려움.

## Before → After

### P1: group-phase 최소 종목 수 게이트

| | Before | After |
|---|--------|-------|
| 조건 | `phase2Ratio >= 0.3` | `phase2Ratio >= 0.3 AND totalStocks >= 5` |
| 문제 | 종목 3개 중 1개 = 33% → Phase 2 판정 | 최소 5개 종목 필요 → noise 방지 |

### P2: fundamental Grade B 조건 강화

| | Before | After |
|---|--------|-------|
| B 조건 | `requiredMet >= 1 && bonusMet >= 1` | `requiredMet >= 1 && bonusMet >= 2` |
| 의미 | EPS만 + bonus 1개 → B | EPS만이면 bonus 2개 모두 필요, 또는 required 2개 충족 |
| 등급표 (1,1) | B | C (강등) |

변경 전 등급 매트릭스:
```
required\bonus | 0 | 1 | 2
      0        | F | C | C
      1        | C | B | B
      2        | B | B | A
```

변경 후:
```
required\bonus | 0 | 1 | 2
      0        | F | C | C
      1        | C | C | B  ← (1,1) B→C
      2        | B | B | A
```

### P3: overlap convictionLevel 타입 추가

| | Before | After |
|---|--------|-------|
| OverlapStock | `overlapCount: number` | `overlapCount: number`, `convictionLevel: 'high' \| 'medium'` |
| 활용 | 숫자만 → 해석 필요 | 타입으로 의미 명시, 다른 모듈에서 즉시 사용 가능 |

## 변경 사항

### 파일 목록

| 파일 | 변경 |
|------|------|
| `src/lib/group-phase.ts` | `GroupPhaseInput`에 `totalStocks?` 추가, Phase 2 조건에 min stock 게이트 |
| `src/lib/group-rs.ts` | `detectGroupPhase` 호출 시 `totalStocks` 전달 |
| `src/lib/fundamental-scorer.ts` | `determineGrade` 조건 변경 (1,1)→C |
| `src/debate/earlyDetectionLoader.ts` | `OverlapStock`에 `convictionLevel` 필드 추가 |
| `__tests__/lib/group-phase.test.ts` | min stock 게이트 테스트 추가 |
| `__tests__/lib/fundamental-scorer.test.ts` | (1,1)→C 테스트 수정, 관련 통합 테스트 확인 |
| `src/debate/__tests__/earlyDetectionLoader.test.ts` | convictionLevel 테스트 추가 |

## 골 정렬

**ALIGNED** — Phase 2 포착 정밀도 향상은 프로젝트의 핵심 골(정확한 추천)에 직결. 전략 브리핑에서 "포착 임계값 무근거"를 미해결 전략 이슈 상위 3건에 포함.

## 무효 판정

**PROCEED** — 임계값 숫자 자체(RS 50→70 등)는 백테스트 데이터 없이 변경하지 않음. 이번 변경은 구조적 허점(min stock gate 부재, Grade B 너무 관대, conviction level 미명시)만 교정. 새로운 근거 없는 숫자를 도입하지 않음.

## 리스크

1. **Grade B→C 강등 영향**: 기존 `requiredMet=1, bonusMet=1` 종목이 C로 떨어짐. 의도된 것이나 recommendation 파이프라인의 Fundamental Gate (A/S/B만 통과)에서 걸러지는 종목 증가 예상.
2. **group-phase Phase 2 섹터 수 감소**: 소규모 섹터가 Phase 2에서 제외됨. 이것도 의도된 것 — noise 제거.
3. **totalStocks optional**: 기존 호출부 외 직접 호출 시 totalStocks 미전달하면 게이트 비활성. 유일한 프로덕션 호출부(group-rs.ts)에서는 항상 전달.

## 작업 계획

1. P1: group-phase min stock gate 구현 + 테스트
2. P2: Grade B 조건 변경 + 테스트 수정
3. P3: OverlapStock convictionLevel 추가 + 테스트
4. 전체 테스트 실행, 커버리지 확인
5. 커밋 + PR

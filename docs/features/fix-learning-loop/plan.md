# 학습 루프 단절 수리

이슈: #288

## 선행 맥락

**`docs/features/fix-learning-cold-start/plan.md` (이슈 #268, 완료):**
- graduated threshold(cold start 시 minHits=3, hitRate=0.60, minTotal=5) 이미 도입됨
- 검증-만료 순서 역전 완료: verifyTheses → resolveOrExpireStaleTheses 순서로 동작 중
- `resolveOrExpireStaleTheses()` 함수로 만료 전 정량 판정 시도 로직 구현 완료

**현재 상태 (코드 분석 기반):**
- `agent_learnings` 0건: CONFIRMED thesis가 존재하지 않으므로 graduated threshold도 충족 불가
- tech thesis 13건 전량 ACTIVE: 검증 자체가 작동하지 않는 상태
- `etl:promote-learnings` 스크립트가 `package.json`에 정의되어 있으나, `debate-daily.sh`와 `agent-weekly.sh` 어디에도 호출되지 않음

## 골 정렬

**ALIGNED** — 직접 기여.

학습 루프는 시스템의 자기개선 엔진이다. thesis 검증이 전량 HOLD/미작동이면 CONFIRMED/INVALIDATED 데이터가 쌓이지 않고, CONFIRMED 데이터가 없으면 promote-learnings도 작동하지 않으며, 설령 작동해도 스케줄에 등록되지 않아 실행 자체가 안 된다. 이 파이프라인이 작동해야 시스템이 경험에서 배우고 Phase 2 초입 포착 정밀도가 향상된다.

## 문제

#268에서 코드 수정은 완료됐지만 실제로 학습이 쌓이지 않고 있다. 세 가지 원인이 중첩된 구조적 단절:

1. **tech thesis targetCondition이 정량 매핑 불가**: `quantitativeVerifier.ts`의 `resolveMetricValue()`는 인덱스(S&P 500, NASDAQ, VIX 등)와 섹터 RS만 인식한다. tech 에이전트는 "AI 반도체 섹터 RS", "반도체 섹터 RS 상승 지속", "Technology RS > 50" 같은 조건을 생성한다. "Technology"가 아닌 "Technology sector RS"처럼 정확한 형식이 아니면 정량 매핑 실패 → LLM fallback. LLM은 시장 스냅샷 텍스트에 해당 종목 가격이나 RS 수치가 없으면 전량 HOLD 판정.

2. **LLM 검증이 HOLD를 과다 생성**: verifier 프롬프트 규칙이 "확실한 경우에만 CONFIRMED/INVALIDATED, 애매하면 HOLD"로 보수적으로 설정되어 있다. tech thesis의 targetCondition은 "AI 인프라 capex 지속 확인" 같은 정성적 표현이 많아, LLM이 시장 스냅샷만으로 판정할 수 없어 전량 HOLD.

3. **promote-learnings가 스케줄에 없음**: `yarn etl:promote-learnings`를 수동 실행하지 않으면 CONFIRMED thesis가 쌓여도 learning으로 승격되지 않는다. `debate-daily.sh`에서 토론 후 자동 실행되어야 하나 누락됨.

## Before → After

**Before**
- tech thesis 13건 전량 ACTIVE: 정량 매핑 실패 + LLM HOLD 과다
- promote-learnings 스케줄 미등록 → 수동 실행 없이는 학습 승격 불가
- agent_learnings 0건
- 시스템이 경험에서 배우지 못하는 구조적 정지 상태

**After**
- tech thesis의 targetCondition이 정량 검증 가능한 형식으로 생성됨 (섹터 RS, 인덱스 기반)
- 정량 매핑 불가 thesis는 LLM verifier에서 더 적극적으로 판정 (HOLD 과다 방지)
- promote-learnings가 debate 완료 후 자동 실행됨
- CONFIRMED/INVALIDATED thesis가 쌓이기 시작하고, 학습이 단계적으로 승격됨

## 변경 사항

### Phase 1 — tech thesis targetCondition 정량화 유도

**파일**: `.claude/agents/tech-analyst.md`

**변경**: 출력 형식 섹션에 정량 조건 작성 가이드 추가.
현재 tech-analyst.md의 출력 형식(섹션 1~5)에는 thesis JSON 작성 규칙이 없다.
moderator(round3-synthesis.ts)의 thesis 생성 프롬프트에는 이미 정량 조건 작성 규칙이 있지만,
moderator는 각 전문가의 분석을 종합하는 역할이라 tech 에이전트가 직접 thesis를 쓰지 않는다.
따라서 round3 프롬프트의 targetCondition 작성 규칙을 보강한다.

**파일**: `src/agent/debate/round3-synthesis.ts`

**변경**: thesis JSON 작성 지침에 tech/sector 전망용 정량 조건 예시 추가.
현재 예시: `"S&P 500 > 5800"`, `"VIX < 20"`
추가 예시:
```
"Technology RS > 60"    (섹터 RS 비교 — quantitativeVerifier가 인식하는 형식)
"Semiconductor RS > 55" (산업 RS — 현재는 미지원, Phase 2에서 확장 검토)
"NASDAQ > 18000"        (지수 기반)
```

정성적 조건의 불가피한 사용 규칙도 명확화:
- 수치 비교 불가능한 경우에만 정성적 조건 허용
- 정성적 조건 작성 시 "LLM이 시장 스냅샷에서 직접 판단 가능한 내용"으로 한정

### Phase 2 — LLM verifier HOLD 과다 방지

**파일**: `src/agent/debate/thesisVerifier.ts`

**변경**: LLM verifier 프롬프트의 HOLD 기준 명확화.

현재 프롬프트:
```
- HOLD: 아직 판단하기 이름. 데이터가 부족하거나 방향이 불명확.
```

변경:
- HOLD는 "timeframe이 남아 있어 판단이 시기상조"인 경우로 한정.
- thesis 생성 후 50% 이상 시간이 경과했고, 시장 방향이 targetCondition과 반대로 명확히 움직인 경우 → INVALIDATED 판정 가이드 추가.
- LLM verifier가 판단할 수 있는 정성적 신호 예시 추가 (섹터 분위기, 뉴스 흐름).

**추가 검토 항목 (코드 분석 중 발견)**:
- `loadActiveTheses()`는 모든 ACTIVE thesis를 반환함. timeframe이 오래 경과한 thesis도 포함.
- LLM verifier에 각 thesis의 경과 일수(elapsed days)를 명시적으로 제공하면 HOLD/INVALIDATED 판단 품질이 향상됨.
- `calcExpiry()` 결과를 `thesesText` 포맷에 이미 포함하고 있으나, 경과 일수를 추가로 명시.

### Phase 3 — promote-learnings 스케줄 등록

**파일**: `scripts/cron/debate-daily.sh`

**변경**: `run-debate-agent.ts` 성공 후 `yarn etl:promote-learnings` 자동 실행 추가.

현재 구조:
```
run-debate-agent.ts → validate-debate-report.sh
```

변경 후:
```
run-debate-agent.ts → yarn etl:promote-learnings → validate-debate-report.sh
```

실행 원칙:
- promote-learnings 실패 시 debate 결과에 영향 없도록 비블로킹(실패해도 계속 진행)
- promote-learnings 성공/실패 로그 기록

## 작업 계획

### 태스크 1 — round3 thesis 정량 조건 예시 보강 [실행팀]

**파일**: `src/agent/debate/round3-synthesis.ts`

**변경 내용**:
- `buildSynthesisPrompt()` 내 thesis JSON 예시에 섹터 RS 기반 조건 추가
- targetCondition 정성적 사용 제한 규칙 명확화
- verificationMetric에 지원 형식 목록 주석 추가 (지수명, 섹터명 + RS 접미사)

**완료 기준**:
- 변경된 프롬프트로 생성된 thesis의 targetCondition이 정량 비교 형식 비율 증가
- 기존 `extractDebateOutput` 관련 테스트 통과
- 코드 변경이 런타임 동작에 영향 없음 (프롬프트 텍스트 변경만)

**의존성**: 없음

### 태스크 2 — LLM verifier HOLD 기준 명확화 [실행팀]

**파일**: `src/agent/debate/thesisVerifier.ts`

**변경 내용**:
- LLM verifier `systemPrompt`의 HOLD 판정 기준을 "timeframe 미경과"로 한정
- `thesesText` 포맷에 경과 일수 추가: `기한: 30일 (경과: 12일, 만료: ~2025-04-01)`
- INVALIDATED 적극 판정 가이드: "timeframe 50% 이상 경과 + 시장이 반대 방향 명확" → INVALIDATED 권장

**완료 기준**:
- `calcExpiry()` 외에 경과 일수 계산 추가
- 기존 `parseJudgments` 테스트 통과
- 정성적 tech thesis가 만료 임박 시 HOLD 대신 INVALIDATED 판정을 받는 케이스 확인 가능

**의존성**: 없음 (태스크 1과 병렬)

### 태스크 3 — promote-learnings 스케줄 등록 [실행팀]

**파일**: `scripts/cron/debate-daily.sh`

**변경 내용**:
```bash
# run-debate-agent.ts 성공 후 삽입
log "▶ Promote learnings"
if yarn etl:promote-learnings >> "$LOG_FILE" 2>&1; then
  log "✓ Learnings 승격 완료"
else
  log "✗ Learnings 승격 실패 (비블로킹 — 계속 진행)"
fi
```

**완료 기준**:
- debate-daily 실행 시 promote-learnings가 자동 호출됨
- 실패 시 debate 결과에 영향 없음
- 로그에 promote-learnings 실행 결과 기록

**의존성**: 없음 (태스크 1, 2와 병렬)

### 태스크 4 — quantitativeVerifier 섹터 RS 매핑 확장 검토 [실행팀]

**파일**: `src/agent/debate/quantitativeVerifier.ts`

**목적**: 현재 `resolveMetricValue()`의 섹터 RS 매핑이 정확히 어떤 형식을 인식하는지 확인하고, 누락된 형식을 추가.

**현재 지원 형식** (코드 분석):
- `"Technology RS"` → `Technology sector.avgRs` (대소문자 무시 정규표현식 매칭)
- `"S&P 500"` → indices close
- `"VIX"` → indices close

**확인 및 추가 항목**:
- `"Technology sector RS"` 처리 가능 여부: 정규식 `/^(.+?)\s*(?:sector\s+)?RS$/i`이 `sector RS`를 처리하나 공백 포함 형식 테스트
- DB의 실제 섹터 이름과 일치 여부: `sectorRsDaily.sector` 값(예: "Information Technology", "Technology") vs thesis의 verificationMetric
- 불일치 시 섹터 이름 alias 매핑 추가 또는 정규표현식 개선

**완료 기준**:
- 주요 tech 관련 섹터 이름(Technology, Information Technology, Semiconductors)을 RS 비교 조건으로 사용 가능
- 기존 `parseQuantitativeCondition`/`evaluateQuantitativeCondition` 테스트 통과
- 신규 섹터 형식 테스트 추가

**의존성**: 없음 (태스크 1, 2, 3과 병렬)

### 태스크 5 — 통합 검증 [검증팀]

**작업**:
- 전체 테스트 통과 확인 (vitest)
- 커버리지 80%+ 유지 확인
- 변경된 thesis 생성 프롬프트로 나올 thesis 형식 예시 검토 (정량 조건 비율 증가 여부)
- debate-daily.sh에서 promote-learnings 실행 경로 로그 시뮬레이션

**완료 기준**:
- 테스트 전체 통과
- 코드 리뷰 CRITICAL/HIGH 이슈 없음

**의존성**: 태스크 1~4 완료 후

## 병렬 실행 계획

```
태스크 1 (round3 정량 조건 예시)    ──┐
태스크 2 (verifier HOLD 기준)        ──├── 태스크 5 (통합 검증)
태스크 3 (promote-learnings 스케줄)  ──┤
태스크 4 (quantitativeVerifier 확장) ──┘
```

태스크 1~4 독립적, 병렬 실행 가능. 태스크 5는 전체 완료 후.

## 리스크

1. **프롬프트 변경 효과의 불확실성**: moderator가 thesis의 targetCondition을 생성하는 방식은 LLM이므로, 예시 추가만으로 즉시 정량 조건 비율이 크게 오르지 않을 수 있다. 이 경우 targetCondition 형식이 올바르지 않은 thesis를 주기적으로 모니터링하여 추가 프롬프트 튜닝 필요.

2. **HOLD → INVALIDATED 전환의 FP 증가**: verifier를 더 적극적으로 만들면 실제 아직 유효한 thesis가 INVALIDATED 처리될 수 있다. 완화: timeframe 50% 경과 조건을 명시하여 신규 thesis는 보호.

3. **promote-learnings 지연 실행**: debate 완료 후 promote-learnings를 실행해도, thesis가 CONFIRMED 데이터가 축적된 이후에만 실제 learning이 생성된다. 스케줄 등록은 즉시 학습 생성을 보장하지 않으며, 수 주 뒤 CONFIRMED 데이터가 쌓인 후 효과가 나타난다.

4. **섹터 이름 불일치**: DB의 GICS 섹터 이름과 LLM이 생성하는 verificationMetric이 다를 수 있다 (예: "Information Technology" vs "Tech"). 태스크 4에서 실제 DB 값 확인 후 alias 매핑 여부 결정.

## 의사결정 필요

없음 — 자율 판단 완료.

- **geopolitics 프롬프트 개선**: 이번 스코프 외. 별도 이슈로 추적.
- **모델 교체**: 이번 스코프 외. 별도 이슈로 추적.
- **LLM verifier 적극성 수준**: timeframe 50% 경과 + 반대 방향 명확 조건으로 균형 잡음. 너무 공격적이면 유효 thesis 손실, 너무 보수적이면 현재 상태 유지. 이 기준으로 시작하여 결과 모니터링.

# Plan: 리포트 팩트 일관성 + 전일 시그널 후속 추적

## 문제 정의

2026-03-26 리포트 감사에서 2가지 구조적 결함 확인:

### A. 팩트 불일치 (CRITICAL + HIGH)
1. **Phase 방향 모순**: 섹터 테이블의 `Phase 2→3`(악화)과 서술의 `Phase 3→2 개선`이 정반대
2. **데이터 유무 자기모순**: RS 수치가 테이블에 있으면서 "정확한 수치 확인 불가"라고 서술

### B. 전일 시그널 후속 추적 누락 (HIGH)
3. **핵심 인사이트 후속 추적 없음**: 전일 리포트의 핵심 인사이트(Financial Services 72건 Phase 1→2 전환)가 익일 리포트에서 유효/무효 판정 없이 무시됨
4. **Phase 2 비율 변화 미포착**: 전일 대비 6.5p 하락했는데 미언급

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| Phase 방향 모순 | 감지 불가 — 발송 후 수동 감사로만 발견 | `reportValidator`가 `Phase X→Y` + 방향 서술 불일치를 ERROR로 차단 |
| 데이터 유무 모순 | 감지 불가 | `reportValidator`가 수치 존재 + "확인 불가" 동시 등장을 ERROR로 차단 |
| 전일 핵심 인사이트 후속 추적 | `previousReportContext`에 인사이트 미포함 | fullContent에서 핵심 인사이트 추출 → previous-report 컨텍스트에 포함 |
| Phase 2 비율 변동 강제 | 시스템 프롬프트 규칙 없음 | ±3p 이상 변동 시 명시적 언급 규칙 추가 |

## 변경 사항

### 1. `src/lib/reportValidator.ts` — 검증 로직 2건 추가

#### O. Phase 방향 크로스체크 (`checkPhaseDirectionConsistency`)
- 마크다운에서 `Phase X→Y` 패턴을 모두 추출
- 같은 문단/섹션 내에서 방향 서술(개선/악화)이 X→Y의 실제 방향과 일치하는지 검증
- Phase 1→2 = 개선, Phase 2→3/3→4 = 악화. 반대 서술 시 ERROR

#### P. 데이터 유무 일관성 (`checkDataPresenceConsistency`)
- 마크다운에서 "확인 불가", "조회 오류", "데이터 없음" 등의 표현을 추출
- 같은 엔티티(섹터명/티커)에 대해 수치가 동시에 존재하면 ERROR

### 2. `src/lib/previousReportContext.ts` — 핵심 인사이트 추출 추가

#### `extractKeyInsights(fullContent)` 함수 추가
- 전일 리포트 fullContent에서 "💡 오늘의 인사이트" 섹션 추출
- `formatPreviousReportContext()`에 "### 직전 핵심 인사이트" 블록 추가
- 에이전트가 전일 인사이트의 유효/무효를 판정할 수 있는 근거 제공

### 3. `src/agent/systemPrompt.ts` — 규칙 2건 추가

- **전일 핵심 인사이트 후속 추적 의무화**: `<previous-report>` 내 핵심 인사이트가 있으면 익일 "전일 대비 변화 요약" 섹션에서 유효/무효/진행중 판정 필수
- **Phase 2 비율 변동 명시 규칙**: 전일 대비 ±3p 이상 변동 시 "Phase 2 비율 X% → Y% (Zp 변동)" 형태로 명시

### 4. 테스트

- `checkPhaseDirectionConsistency`: Phase 방향 모순 감지/정상 통과 테스트
- `checkDataPresenceConsistency`: 데이터 유무 모순 감지/정상 통과 테스트
- `extractKeyInsights`: fullContent에서 인사이트 추출 정상 동작 테스트

## 작업 계획

1. `reportValidator.ts`에 검증 O, P 추가
2. `previousReportContext.ts`에 `extractKeyInsights` + 포맷 변경
3. `systemPrompt.ts`에 규칙 2건 추가
4. 테스트 작성 + 실행
5. 커밋

## 골 정렬

**SUPPORT** — 리포트 품질 개선은 "Phase 2 주도섹터/주도주 초입 포착" 핵심 골의 전달 수단(리포트)의 신뢰도를 높인다. 팩트 모순이 있으면 정확한 Phase 전환 시그널도 불신받게 됨.

## 무효 판정

**해당 없음** — LLM 백테스트가 아닌 검증 로직(정규식 기반 팩트 체크) + 데이터 보강이므로 무효 패턴에 해당하지 않음.

## 리스크

- **False positive 가능성**: Phase 방향 크로스체크에서 의도적으로 "Phase 2→3이나 개선 조짐" 같은 복합 서술을 잘못 잡을 수 있음 → 같은 줄 범위로 제한하여 최소화
- **인사이트 추출 regex 깨짐**: fullContent 형식이 변하면 추출 실패 → fail-open 설계(추출 실패 시 빈 배열)

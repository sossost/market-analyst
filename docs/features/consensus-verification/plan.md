# Plan: Moderator consensus_level 알고리즘 검증

## 문제 정의

Round 3 Moderator가 thesis별 `consensusLevel`("4/4", "3/4" 등)을 할당하지만, Round 1 에이전트 4명의 실제 발언과 대조하는 알고리즘 검증이 없다. Moderator LLM이 실제 2명만 지지한 thesis에 "4/4 합의"를 부여할 수 있으며, 다운스트림(학습 루프, thesis 우선순위)이 이 값을 그대로 신뢰한다.

## 골 정렬

- **ALIGNED**: thesis 적중률 추적과 학습 루프 품질은 시스템의 핵심 가치. consensus 정확도가 오염되면 학습 루프 전체가 오염된다.
- strategic-briefing에서 "학습 루프 활성 6건" + "Thesis 적중률 61.5%" — consensus 정확도 검증은 이 수치의 신뢰도를 직접 높인다.

## Before → After

**Before**: Moderator가 부여한 consensusLevel을 무조건 신뢰. 실제 에이전트 지지도와 괴리 가능.

**After**: Round 1 에이전트 출력에서 키워드 매칭으로 thesis별 지지도를 알고리즘적으로 산출. Moderator consensus와 2단계 이상 차이나면 `consensusUnverified: true` 플래그 부착. 다운스트림에서 이 플래그를 참조 가능.

## 변경 사항

### 1. consensus 검증 함수 추가 (`src/debate/consensusVerifier.ts`)
- Round 1 에이전트 4명의 출력에서 각 thesis의 핵심 키워드가 긍정적 맥락으로 등장하는지 규칙 기반 판정
- 키워드 추출: thesis 텍스트에서 명사구/핵심어 추출 (정규식 기반, LLM 미사용)
- 지지 판정: 에이전트 출력에 thesis 키워드가 긍정 맥락(지지, 동의, 강조)으로 등장하면 지지, 부정 맥락(반박, 리스크, 우려)이면 미지지
- 알고리즘 consensus: 지지 에이전트 수 / 4
- 비교: Moderator consensus와 알고리즘 consensus가 2단계 이상 차이 → `consensusUnverified: true`

### 2. Thesis 타입 확장
- `Thesis` 인터페이스에 `consensusUnverified?: boolean` 추가
- DB `theses` 테이블에 `consensus_unverified` boolean 컬럼 추가 (마이그레이션)

### 3. 통합
- `extractDebateOutput` 또는 `runRound3` 에서 thesis 추출 후 검증 함수 호출
- 플래그가 true인 thesis는 로그로 경고
- `saveTheses`에서 플래그를 DB에 저장

### 4. 다운스트림 영향 (최소)
- 기존 코드 동작에 영향 없음 (플래그는 optional, default null)
- 학습 루프에서 향후 이 플래그를 참조하여 가중치 조정 가능 (이번 이슈 범위 외)

## 작업 계획

1. `src/debate/consensusVerifier.ts` — 키워드 매칭 + consensus 검증 함수 구현
2. `src/debate/__tests__/consensusVerifier.test.ts` — 단위 테스트
3. `src/types/debate.ts` — `Thesis` 인터페이스에 `consensusUnverified` 추가
4. `src/db/schema/analyst.ts` — `theses` 테이블에 `consensus_unverified` 컬럼 추가
5. DB 마이그레이션 생성
6. `src/debate/round3-synthesis.ts` — `runRound3`에서 검증 호출 통합
7. `src/debate/thesisStore.ts` — `saveTheses`에서 플래그 저장
8. 기존 테스트 호환성 확인

## 리스크

- **키워드 매칭 정밀도**: 자연어 키워드 매칭은 false positive/negative가 있을 수 있다. 보수적 접근(불일치 시 제거가 아닌 플래그만 부착)으로 위험을 관리.
- **기존 데이터 호환**: 마이그레이션 시 기존 행의 `consensus_unverified`는 null. 신규 분석부터 적용.
- **LLM 자기 검증 회피**: consensus 검증에 LLM을 절대 사용하지 않음. 순수 키워드/패턴 기반.

## 무효 판정

- 무효 사유 없음. consensus 정확도 검증은 학습 루프 품질에 직접 기여하며, 기존 시스템에 부작용 없는 additive 변경.

# Plan: 에이전트 토론 & 진화 시스템

총 4 Phase, 의존 관계 순서대로.

---

## Phase 1: DB 스키마 + 기반 코드

**의존**: 없음
**산출물**: Drizzle 스키마, 마이그레이션, 타입 정의

### Tasks

1. **Drizzle 스키마 정의** — `db/schema/` 에 `theses`, `agent_learnings` 테이블 추가
   - AC: `npm run db:push`로 Supabase에 반영 성공

2. **타입 정의** — `src/types/debate.ts`
   - `Thesis`, `AgentLearning`, `DebateRound`, `DebateResult` 타입
   - AC: 다른 모듈에서 import 가능

3. **페르소나 로더** — `src/agent/debate/personas.ts`
   - `.claude/agents/*.md` 파일에서 system prompt 파싱하여 코드에서 사용
   - AC: 5명 페르소나 로드 + frontmatter 제거 + 본문만 추출

---

## Phase 2: 토론 엔진 코어

**의존**: Phase 1
**산출물**: 3라운드 토론 실행 가능

### Tasks

4. **라운드 1 — 독립 분석** — `src/agent/debate/round1-independent.ts`
   - 4명에게 동일 질문 + 장기 기억 + 최근 검증 결과를 포함한 system prompt 전달
   - **4명 병렬 호출** (Promise.all)
   - AC: 4개 독립 분석 텍스트 반환

5. **라운드 2 — 교차 검증** — `src/agent/debate/round2-crossfire.ts`
   - 각 에이전트에게 다른 3명의 라운드 1 결과 전달
   - "반박하거나 보완하라" 지시
   - **4명 병렬 호출**
   - AC: 4개 교차 검증 텍스트 반환

6. **라운드 3 — 모더레이터 종합** — `src/agent/debate/round3-synthesis.ts`
   - 모더레이터에게 라운드 1 + 라운드 2 전체 전달
   - 합의/불일치 정리 + thesis 구조화된 JSON 블록 포함 요청
   - AC: 종합 리포트 텍스트 + 구조화된 thesis 배열

7. **토론 오케스트레이터** — `src/agent/debate/debateEngine.ts`
   - Phase 1→2→3 순차 실행
   - 개별 에이전트 실패 시 나머지로 계속 진행
   - AC: `runDebate()` 호출 시 전체 토론 완료 + 결과 객체 반환

8. **테스트** — `__tests__/agent/debate/`
   - debateEngine 통합 테스트 (모킹된 Claude API)
   - 각 라운드 유닛 테스트
   - AC: 핵심 경로 테스트 통과

---

## Phase 3: Thesis 저장 + 장기 기억

**의존**: Phase 1, 2
**산출물**: thesis DB 저장, 장기 기억 로드/저장

### Tasks

9. **Thesis 추출기** — `src/agent/debate/thesisExtractor.ts`
   - 모더레이터 결과에서 구조화된 thesis JSON 파싱
   - 파싱 실패 시 빈 배열 반환 (보수적)
   - DB에 ACTIVE 상태로 저장
   - AC: 모더레이터 출력에서 thesis 추출 → DB 저장 성공

10. **장기 기억 로더** — `src/agent/debate/memoryLoader.ts`
    - `agent_learnings` 테이블에서 `is_active = true` 조회
    - system prompt에 주입할 포맷으로 변환
    - 최근 검증된 thesis 결과도 함께 로드
    - AC: 장기 기억 텍스트 생성 (50개 이하, ~4K 토큰)

11. **Agent Tools** — `src/agent/tools/` 에 thesis/learnings 관련 도구 추가
    - `saveThesis`, `readActiveTheses`, `readLearnings`
    - AC: 도구 레지스트리에 등록, 스키마 정의 완료

12. **테스트** — thesis 추출, 장기 기억 로드 유닛 테스트
    - AC: 파싱 성공/실패 케이스 모두 커버

---

## Phase 4: 실행 스크립트 + 검증 루프

**의존**: Phase 2, 3
**산출물**: 실행 가능한 토론 에이전트, 자동 검증 ETL

### Tasks

13. **실행 스크립트** — `src/agent/run-debate-agent.ts`
    - 토론 엔진 실행 → thesis 저장 → 리뷰 파이프라인 전달 → Discord 발송
    - 기존 `run-weekly-agent.ts` 패턴과 동일한 에러 핸들링
    - AC: `npm run agent:debate`로 전체 파이프라인 실행

14. **GitHub Actions 워크플로우** — `.github/workflows/debate-weekly.yml`
    - 토요일 실행, `run-debate-agent.ts` 호출
    - 기존 `agent-weekly.yml`과 동일 패턴
    - AC: 수동 트리거로 실행 성공

15. **Thesis 검증 ETL** — `src/etl/jobs/verify-theses.ts`
    - ACTIVE thesis 중 timeframe 도래한 건 조회
    - 기존 ETL 데이터(sector_rs, industry_rs, stock_phases)와 대조
    - 규칙 기반 판정 (수치 비교)
    - 에이전트 보완 판정 (원인 분석) — 선택적
    - AC: `npm run etl:verify-theses`로 실행, 판정 결과 DB 업데이트

16. **장기 기억 승격 ETL** — `src/etl/jobs/promote-learnings.ts`
    - CONFIRMED thesis에서 반복 패턴 추출
    - 3회 이상 적중 패턴 → `agent_learnings`에 승격
    - 6개월 초과 + 적중률 하락 원칙 → 강등
    - AC: `npm run etl:promote-learnings`로 실행

17. **통합 테스트** — 전체 파이프라인 E2E 테스트
    - AC: 토론 → thesis 저장 → (가짜 시간 경과) → 검증 → 승격 전체 흐름 통과

---

## Phase 의존 관계

```
Phase 1 (DB + 기반)
  ↓
Phase 2 (토론 엔진)
  ↓
Phase 3 (Thesis + 기억)
  ↓
Phase 4 (실행 + 검증)
```

Phase 1 내부 태스크(1,2,3)는 병렬 가능.
Phase 2 내부 태스크(4,5,6)는 병렬 가능, 7은 4+5+6 의존.
Phase 3 내부 태스크(9,10,11)는 병렬 가능.
Phase 4 내부 태스크(13,14)는 병렬 가능, 15+16은 독립.

---

## 예상 일정

| Phase | 태스크 수 | 예상 |
|-------|----------|------|
| Phase 1 | 3 | 짧음 |
| Phase 2 | 5 | 핵심 — 토론 엔진 |
| Phase 3 | 4 | 중간 |
| Phase 4 | 5 | 마무리 |
| **합계** | **17** | |

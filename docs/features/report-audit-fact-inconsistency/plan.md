# Plan: 리포트 팩트 불일치 방지 (Lite 트랙)

**이슈**: #439 — 리포트 감사: 팩트 불일치 3건 (2026-03-25)
**유형**: fix (버그픽스 + 가드레일 강화)
**골 정렬**: SUPPORT — Phase 2 주도섹터/주도주 초입 포착 목표 직접 관련은 아니나, 리포트 품질(factConsistency)이 낮으면 분석 신뢰도 전체가 훼손됨
**무효 판정**: 해당 없음 — LLM 백테스트/과적합 패턴 아님. 데이터 파이프라인 + 프롬프트 가드레일 수정

## 문제 정의

감사 총점 28/40, factConsistency 6/10. 4건의 감점 항목:

| # | 문제 | 감점 | 근본 원인 |
|---|------|------|----------|
| 1 | 공포탐욕지수 전일 수치 불일치 (14.5 vs 16.9) | -2 | CNN API `previousClose`는 라이브 필드. 직전 리포트의 실제 F&G 스코어를 DB에 보존하지 않음 |
| 2 | Phase 2→3 전환을 강세 특이종목으로 분류 | -1 | 프롬프트에 Phase 전환 방향별 배치 규칙 없음 |
| 3 | 84→72건인데 "폭발적 증가" 서술 | -1 | 직전 리포트의 섹터 RS 데이터가 `<previous-report>`에 없어 방향 비교 불가 |
| 4 | 섹터 RS 테이블 "전일 대비" 컬럼 전부 공란 | 부가 | daily 모드에 전일 RS 비교 데이터 없음 |

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| F&G 전일 수치 | CNN API `previousClose` (라이브, 불안정) | 직전 리포트 DB 값 + 프롬프트 크로스체크 규칙 |
| Phase 2→3 배치 | LLM 자율 판단 (강세 섹션 배치 가능) | 프롬프트 규칙으로 악화 전환 → 강세 섹션 배치 금지 |
| 전일 대비 서술 | 섹터 RS 비교 데이터 없음 | `<previous-report>`에 섹터 RS Top 5 포함 + 방향 서술 검증 규칙 |
| 섹터 RS 전일 대비 | daily 모드에 비교 데이터 없음 | `getLeadingSectors` daily 모드에 전일 RS/순위 비교 추가 |

## 변경 사항

### 1. `src/types/index.ts` — marketSummary 타입 확장
- `fearGreedScore?: number` 추가 (optional, 하위 호환)
- `topSectorRs?: { sector: string; avgRs: number }[]` 추가

### 2. `src/lib/previousReportContext.ts` — 직전 리포트 컨텍스트 보강
- `formatPreviousReportContext`에 F&G 스코어, 섹터 RS Top 5 포함

### 3. `src/agent/systemPrompt.ts` — 프롬프트 가드레일 추가
- Phase 전환 방향별 배치 규칙 (2→3, 3→4 = 악화 → 강세 섹션 금지)
- F&G 전일 수치 크로스체크 규칙
- 전일 대비 방향 서술 검증 규칙

### 4. `src/tools/getLeadingSectors.ts` — daily 모드 전일 비교 추가
- daily 모드에서 전일 날짜 조회 → 전일 섹터 RS/순위 비교 데이터 포함

### 5. `src/db/repositories/sectorRepository.ts` — 전일 날짜 조회 함수 추가
- `findPrevDayDate(date)` 함수 추가

### 6. 테스트 업데이트
- `previousReportContext.test.ts` — F&G/섹터 RS 포함 검증
- `getLeadingSectors` 관련 테스트 (신규)

## 리스크

- **하위 호환**: `marketSummary` 필드 추가는 optional이므로 기존 데이터와 호환
- **DB 부하**: `findPrevDayDate`는 단순 MAX 쿼리로 부하 미미
- **기존 리포트**: F&G/섹터 RS가 없는 과거 리포트는 해당 줄 생략 (fail-open)

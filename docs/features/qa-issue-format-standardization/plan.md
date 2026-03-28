# Plan: QA 이슈 타이틀/본문 포맷 표준화

## 문제 정의

`validate-daily-report.sh`가 생성하는 GitHub 이슈의 타이틀과 본문이 LLM 자유 생성으로 매번 다른 형식.
이슈 검색/필터링이 어렵고, 감점 근거를 일관된 구조로 파악할 수 없음.

## 골 정렬

- **ALIGNED** — QA 이슈 일관성은 리포트 품질 관리 루프의 핵심. 포맷 통일로 자동화/추적 가능성 향상.

## 무효 판정

- **해당 없음** — 프롬프트 수정만으로 해결. 코드 변경 최소화.

## Before → After

### Before
- 타이틀: `리포트 품질 경고: ...`, `리포트 감사: ...`, `fix: ...`, `[BLOCK] ...` 등 매번 다름
- 본문: `## 감사 결과`, `## 감점 항목`, `## 리포트 감사 결과` 등 구조 불일치

### After
- 타이틀: `[일간 QA] {YYYY-MM-DD} — {1줄 요약}` (고정 접두사)
- 본문: 점수 테이블 → 감점 근거 → 재발 방지 제안 (3단 구조 고정)

## 변경 사항

| 파일 | 변경 | 이유 |
|------|------|------|
| `scripts/validate-daily-report-prompt.md` | issueTitle/issueBody 필드에 고정 템플릿 명시 | 일간 QA 포맷 통일 |
| `scripts/validate-weekly-report-prompt.md` | issueTitle/issueBody 필드에 고정 템플릿 명시 | 주간 QA 포맷 통일 (프롬프트 측도 정비) |

### 변경하지 않는 것
- `scripts/cron/validate-daily-report.sh` — 프롬프트 출력을 그대로 전달하는 구조이므로 코드 변경 불필요
- `src/agent/run-weekly-qa.ts` — 이미 코드에서 `[주간 QA]` 포맷 고정. 프롬프트 정비만 수행

## 작업 계획

1. `validate-daily-report-prompt.md` 수정: issueTitle/issueBody에 고정 템플릿 + 예시 추가
2. `validate-weekly-report-prompt.md` 수정: 동일 패턴 적용 (5항목 기준)
3. 기존 테스트 통과 확인

## 리스크

- 본문 마크다운 테이블의 `|` 문자가 JSON 문자열 내에서 이스케이프 필요 → 프롬프트에 예시를 명시하여 LLM이 올바른 JSON 생성하도록 유도
- 너무 엄격한 템플릿은 LLM JSON 파싱 에러 유발 가능 → 핵심 구조만 강제하고 세부 서술은 자유도 유지

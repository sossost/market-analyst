# Plan: Gemini 2.0 Flash → 2.5 Flash 모델 교체

## 문제 정의

`gemini-2.0-flash` 모델이 Google에 의해 deprecated되어 404 반환.
FallbackProvider가 Claude로 폴백하므로 토론은 중단되지 않지만:
- 매 라운드 불필요한 Gemini API 호출 1회 + 타임아웃 대기
- 에러 로그 노이즈 누적
- Claude 폴백으로 인한 비용 증가 (Gemini Flash 대비 고비용)

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| tech-analyst 모델 | `gemini-2.0-flash` (404) | `gemini-2.5-flash` (GA) |
| 토론 라운드 | Gemini 실패 → Claude 폴백 | Gemini 직접 응답 |
| 에러 로그 | 매 라운드 FallbackProvider 경고 | 정상 |
| 비용 | Claude 폴백 비용 | Gemini Flash 비용 (저렴) |

## 변경 사항

| 파일 | 변경 내용 |
|------|----------|
| `.claude/agents/tech-analyst.md` | `model: gemini-2.0-flash` → `model: gemini-2.5-flash` |
| `__tests__/agent/debate/personas.test.ts` | 테스트 기대값 업데이트 |
| `src/debate/__tests__/providerFactory.test.ts` | 테스트 문자열 업데이트 (선택) |

## 작업 계획

1. `.claude/agents/tech-analyst.md` 모델명 교체
2. `__tests__/agent/debate/personas.test.ts` 테스트 기대값 수정
3. 테스트 실행 확인

## 골 정렬

- **ALIGNED** — 토론 엔진(F6) 정상화, 비용 절감, 로그 품질 개선 모두 프로젝트 골과 직결

## 무효 판정

- **해당 없음** — deprecated 모델 교체는 필수 유지보수

## 리스크

- `gemini-2.5-flash`가 `gemini-2.0-flash`와 응답 품질/형식이 다를 수 있음 → 토론 품질 모니터링 필요
- 환경변수 `GOOGLE_GENERATIVE_AI_API_KEY`가 2.5 모델에 대한 접근 권한이 있어야 함

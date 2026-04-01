# Plan: Gemini API spending cap 초과 해결

## 문제 정의

테크 애널리스트(`gemini-2.5-flash`)가 Google Cloud spending cap 초과(429)로 매번 Claude CLI로 폴백.
토론 참가자 5명 중 4명이 Claude 기반 → **관점 다양성 소실**.

- GPT-4o: 매크로 이코노미스트 (1명)
- Claude CLI: 지정학, 센티멘트, 모더레이터 (3명)
- Gemini → Claude 폴백: 테크 애널리스트 (1명, 사실상 Claude)

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| 테크 애널리스트 모델 | `gemini-2.5-flash` | `gemini-2.0-flash` |
| API 비용 | 높음 (2.5-flash 단가) | 낮음 (2.0-flash 단가) |
| 폴백 빈도 | 매번 (spending cap 초과) | 대폭 감소 (비용 절감) |
| 관점 다양성 | 5명 중 4명 Claude | 5명 중 3명 Claude (정상) |

## 변경 사항

1. `.claude/agents/tech-analyst.md`: `model: gemini-2.5-flash` → `model: gemini-2.0-flash`

## 골 정렬

- **ALIGNED** — 토론 인프라의 핵심 설계 원칙(모델 다양성)을 복원하는 직접적 수정.

## 무효 판정

- **해당 없음** — spending cap 초과는 명확한 429 에러 로그로 확인된 사실. 모델 변경은 비용 절감을 통한 직접적 완화.

## 작업 계획

1. `tech-analyst.md` 모델 필드 변경 (1줄)
2. 기존 테스트 통과 확인
3. 코드 리뷰

## 리스크

| 리스크 | 심각도 | 대응 |
|--------|--------|------|
| `gemini-2.0-flash` 응답 품질이 `2.5-flash`보다 낮을 수 있음 | LOW | 2.0-flash는 안정 GA 모델. 기존 프롬프트와 호환. 품질 이슈 시 별도 이슈로 대응. |
| spending cap이 2.0-flash에서도 초과될 수 있음 | LOW | 2.0-flash는 단가가 크게 낮아 동일 cap 내 더 많은 호출 가능. 재발 시 cap 상향 필요(운영 조치). |

## 참고

- spending cap 상향은 Google Cloud 콘솔에서 CEO가 직접 조치 가능 (코드 변경 불필요)
- `gemini-2.0-flash`는 이미 테스트 코드에서 사용 중 (`providerFactory.test.ts`)

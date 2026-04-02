# Market Analyst — Frontend Dashboard

Phase 2 주도섹터/주도주 분석 결과를 시각화하는 대시보드. 일간/주간 리포트 아카이브, 멀티 모델 토론 기록, 서사 체인, 관심종목 현황을 제공한다.

## 스택

| 영역 | 기술 |
|------|------|
| Framework | Next.js 16 (App Router) |
| Styling | Tailwind CSS v4 |
| UI Components | shadcn/ui (base-nova) |
| Auth | Supabase Auth (Magic Link) |
| Database | Supabase (SSR) |
| Testing | Vitest + Playwright (E2E) |

## 주요 기능

| 피처 | 경로 | 설명 |
|------|------|------|
| 대시보드 | `/` | 시스템 현황 요약 |
| 리포트 아카이브 | `/reports` | 일간/주간 리포트 목록 + 상세 |
| 토론 아카이브 | `/debates` | 멀티 모델 토론 세션 + thesis |
| 관심종목 | `/watchlist` | Phase 궤적 + 90일 추적 현황 |
| 서사 체인 | `/narrative-chains` | 병목 생애주기 시각화 |
| 학습 루프 | `/learnings` | 장기 기억 + 패턴 승격 이력 |
| 종목 검색 | `/stock-search` | ticker 역방향 분석 |

## 실행

루트 디렉토리에서:

```bash
yarn fe:dev          # 개발 서버 (http://localhost:3000)
yarn fe:build        # 프로덕션 빌드
yarn fe:lint         # 린트
yarn fe:typecheck    # 타입 체크
yarn fe:test         # 단위/통합 테스트
yarn fe:e2e          # E2E 테스트 (Playwright)
```

## 환경변수

```env
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

루트 `.env` 파일에서 공유.

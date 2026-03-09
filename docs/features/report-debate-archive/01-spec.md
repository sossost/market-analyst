# Feature Spec: 리포트/토론 아카이빙 대시보드

**Status:** Confirmed
**Created:** 2026-03-09
**Author:** brainstorm session
**Issue:** #117

---

## Overview

일간/주간 리포트와 토론 내용을 웹에서 열람할 수 있는 아카이빙 대시보드.
현재 Discord로 흘러가서 사라지는 데이터를 체계적으로 보존하고, 향후 시각화 대시보드(#99)의 기초 레이어 역할을 한다.

## User Goals

- CEO로서, 과거 리포트를 날짜별로 검색하고 열람하여 맥락을 추적하고 싶다
- CEO로서, 토론 세션의 라운드별 내용과 생성된 thesis를 확인하여 의사결정 근거를 파악하고 싶다
- CEO로서, 소수 신뢰할 수 있는 사람에게 대시보드를 공유하고 싶다

## Behavior

### 리포트 아카이빙

#### Happy Path
1. 로그인 후 리포트 목록 페이지 진입
2. 날짜순 정렬된 리포트 목록 표시 (일간/주간 구분)
3. 리포트 클릭 → 상세 페이지 이동
4. 상세: 추천 종목 목록, 시장 요약, 메타데이터(모델, 토큰, 실행시간) 표시
5. 날짜 범위 필터 / 검색으로 탐색

#### Error Cases
- **리포트 없는 날짜**: "해당 날짜에 리포트가 없습니다" 안내
- **네트워크 오류**: 재시도 버튼과 에러 메시지

### 토론 아카이빙

#### Happy Path
1. 토론 목록 페이지 진입
2. 날짜순 정렬된 토론 세션 목록 (VIX, Fear&Greed, Phase2 비율 미리보기)
3. 세션 클릭 → 상세 페이지 이동
4. 상세: 3개 탭 (Round 1 | Round 2 | 종합)
   - Round 1/2: 애널리스트별 카드로 발언 표시
   - 종합: moderator 종합 리포트 + 생성된 thesis 목록 + 레짐 태깅
5. thesis 클릭 시 상태(ACTIVE/CONFIRMED/INVALIDATED/EXPIRED) 확인 가능

#### Error Cases
- **토론 데이터 없는 날짜**: "해당 날짜에 토론 기록이 없습니다" 안내
- **데이터 파싱 실패**: JSON 파싱 에러 시 원본 텍스트 fallback 표시

### 인증

#### Happy Path
1. 비로그인 사용자 → 로그인 페이지로 리다이렉트
2. 이메일 입력 → Magic Link 발송
3. 이메일 내 링크 클릭 → 자동 로그인
4. 세션 유지 (Supabase refresh token)

#### Error Cases
- **미등록 이메일**: "접근 권한이 없습니다. 관리자에게 문의하세요"
- **만료된 Magic Link**: "링크가 만료되었습니다. 다시 요청해주세요"

### Edge Cases

| Situation | Expected Behavior |
|-----------|-------------------|
| 마이그레이션 전 기존 파일 리포트 | 마이그레이션 스크립트로 DB 이관. 누락 시 "데이터 없음" |
| 토론 라운드 데이터가 부분적으로만 존재 | 있는 라운드만 탭 표시. 없는 탭은 비활성 |
| 동시 접속 5명 | Supabase + Vercel 무료 티어로 충분 |
| 모바일 접근 | 반응형 레이아웃. 최소 375px 지원 |

## Interface Design

### 페이지 구조

```
/ (홈)                    → 최근 리포트/토론 요약
/reports                  → 리포트 목록
/reports/[date]           → 리포트 상세
/debates                  → 토론 목록
/debates/[date]           → 토론 상세 (탭: Round1 / Round2 / 종합)
/login                    → Magic Link 로그인
```

### Data Model (신규)

#### daily_reports 테이블 (파일 → DB 마이그레이션)
```
id: serial PK
report_date: date (UNIQUE)
type: 'daily' | 'weekly'
reported_symbols: jsonb        -- ReportedStock[]
market_summary: jsonb          -- { phase2Ratio, leadingSectors, totalAnalyzed }
full_content: text             -- 렌더링용 전체 리포트 텍스트 (있을 경우)
metadata: jsonb                -- { model, tokensUsed, toolCalls, executionTime }
created_at: timestamptz
```

### 기존 테이블 활용

- `debate_sessions` — 토론 목록/상세
- `theses` — thesis 상태 표시
- `market_regimes` — 레짐 태깅 표시

## Acceptance Criteria

- [ ] 로그인하지 않은 사용자는 모든 페이지에서 로그인 페이지로 리다이렉트
- [ ] Magic Link로 로그인 후 대시보드 접근 가능
- [ ] 리포트 목록에서 날짜순 정렬, 페이지네이션 동작
- [ ] 리포트 상세에서 추천 종목, 시장 요약, 메타데이터 표시
- [ ] 토론 목록에서 날짜순 정렬, VIX/Fear&Greed 미리보기
- [ ] 토론 상세에서 3개 탭(Round1/Round2/종합) 전환 동작
- [ ] 각 라운드에서 애널리스트별 발언 카드 표시
- [ ] 종합 탭에서 생성된 thesis 목록 + 레짐 태깅 표시
- [ ] 기존 data/reports/ JSON 파일이 DB로 마이그레이션 완료
- [ ] 모바일(375px+) 반응형 동작
- [ ] Vercel 배포 완료

## Scope

**In Scope:**
- 프론트엔드 프로젝트 초기 세팅 (Next.js + shadcn/ui + Tailwind)
- Supabase Auth (Magic Link) 인증
- 리포트 DB 마이그레이션 (파일 → DB)
- 리포트 목록/상세 페이지
- 토론 목록/상세 페이지 (탭 분리)
- Vercel 배포

**Out of Scope (v2):**
- Thesis 추적 보드 (카드 형태)
- 추천 성과 테이블
- 섹터/종목 히트맵
- 학습 루프 모니터링
- 검색 기능 (v1은 날짜 필터만)
- 알림/구독 기능

## Open Questions

- [ ] 주간 리포트도 같은 파일 구조인가? (별도 확인 필요)
- [ ] 리포트 full_content(마크다운/텍스트)가 저장되어 있는가, 아니면 구조화 데이터만 있는가?

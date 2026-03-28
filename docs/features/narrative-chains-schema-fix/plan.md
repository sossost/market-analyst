# Plan: narrative_chains SELECT/INSERT 실패 수정

## 문제 정의

`narrative_chains` 테이블에 대한 SELECT/INSERT 쿼리가 모두 실패.
Drizzle ORM 스키마에는 `alpha_compatible` 컬럼이 정의되어 있어 모든 쿼리에 포함되지만,
실제 DB에는 해당 컬럼이 존재하지 않음 (마이그레이션 미적용).

**근본 원인**: `_journal.json`에 마이그레이션 3건(0022_minority_view, 0023_sector_alpha_gate, 0024_stock_news_earning_calendar)이 누락되어 `drizzle-kit migrate` 실행 시 적용되지 않음.

## Before → After

| 항목 | Before | After |
|------|--------|-------|
| narrative_chains SELECT | `alpha_compatible` 컬럼 없어 실패 | 정상 동작 |
| narrative_chains INSERT | 동일 원인으로 실패 | 정상 동작 |
| theses.minority_view | 컬럼 미존재 (잠재 장애) | 정상 |
| stock_news, earning_calendar | 테이블 미존재 (잠재 장애) | 정상 |
| _journal.json | 23개 엔트리 (0~22) | 26개 엔트리 (0~25) |
| db:migrate 스크립트 | 없음 | 추가 |

## 변경 사항

### 1. `_journal.json` 누락 엔트리 추가

0022_minority_view, 0023_sector_alpha_gate, 0024_stock_news_earning_calendar 3건을 저널에 추가.
기존 idx 22(cheerful_eddie_brock)와 중복되는 0022_minority_view는 idx 23으로 리넘버링.

**리넘버링 매핑:**
- idx 22: 0022_cheerful_eddie_brock (기존 유지)
- idx 23: 0022_minority_view (신규)
- idx 24: 0023_sector_alpha_gate (신규)
- idx 25: 0024_stock_news_earning_calendar (신규)

### 2. 누락 스냅샷 파일 생성

0023, 0024, 0025 스냅샷 파일이 필요하지만, drizzle-kit generate가 생성하는 형식이므로
`drizzle-kit generate`를 재실행하면 자동 생성됨. 수동 생성 시 정합성 위험.

→ 스냅샷은 `drizzle-kit generate` 재실행으로 해결하되, 현재 스키마와 SQL이 이미 동기화되어 있으므로
_journal.json 수정만으로 `drizzle-kit push` (프로젝트가 사용하는 방식)에는 영향 없음.

### 3. `db:migrate` 스크립트 추가

`package.json`에 `db:migrate` 스크립트 추가하여 마이그레이션 파일 기반 적용 지원.

### 4. DB 스키마 동기화 (수동 작업)

PR 머지 후 `npm run db:push`로 Supabase DB에 스키마 동기화 필요 (자동화 범위 밖).

## 작업 계획

1. `_journal.json`에 누락된 3개 엔트리 추가
2. `package.json`에 `db:migrate` 스크립트 추가
3. 테스트 통과 확인
4. 커밋 및 PR

## 리스크

- **DB 직접 변경 불가**: 이 PR은 코드(저널) 수정만 포함. 실제 DB 동기화는 머지 후 `db:push` 실행 필요.
- **스냅샷 미생성**: 스냅샷 파일 없이도 `db:push`는 정상 동작 (스키마 기반 diff). `drizzle-kit migrate`는 스냅샷 필요할 수 있으나, 프로젝트는 `db:push` 사용.

## 골 정렬

- **ALIGNED**: narrative chain은 서사 추적의 핵심 인프라. 이 장애로 일간 리포트 품질이 저하되고 서사 체인 추적이 완전 단절된 상태.

## 무효 판정

- **해당 없음**: DB 마이그레이션 저널 누락은 명확한 버그. 코드 변경 최소, 리스크 낮음.

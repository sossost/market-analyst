# 실행팀 재편: frontend-engineer / backend-engineer 에이전트 신설

## 선행 맥락

기존 피처 문서들(`narrative-wave2b`, `sector-lag-pattern` 등)에서 "구현 에이전트(general-purpose)"가 반복 등장한다. 별도 에이전트 파일 없이 매니저가 직접 구현하거나 Claude Code 기본 동작에 의존했다. `ORGANIZATION.md`에도 "구현 에이전트 (general-purpose)"로 명시되어 있으나 실제 `.claude/agents/` 디렉토리에 파일이 존재하지 않는다.

## 골 정렬

**SUPPORT** — 시스템 인프라 개선. 구현 품질이 높아지면 분석 에이전트 아웃풋의 신뢰성도 높아지고, 피처 개발 속도도 빨라진다. 프로젝트 골에 간접 기여.

## 문제

매니저가 직접 구현을 수행해 왔다. 매니저는 오케스트레이션 역할이므로 코드를 직접 짜는 것이 역할 위반이며, 실제로 품질 문제가 발생했다. 기능 구현 전담 에이전트(frontend-engineer, backend-engineer)를 신설하여 구현 품질을 높이고 역할 분리를 명확히 한다.

## Before → After

**Before**:
- 구현 에이전트가 `.claude/agents/`에 존재하지 않음
- 매니저가 직접 코드를 작성하거나 비정의된 general-purpose 에이전트에 의존
- 프론트엔드/백엔드 컨텍스트 없이 구현 → 품질 불균일

**After**:
- `frontend-engineer.md`: Next.js/React 구현 전담, `frontend/CONVENTIONS.md` 내재화
- `backend-engineer.md`: Node.js/TypeScript/Drizzle ORM 구현 전담, 스택 컨텍스트 내재화
- `ORGANIZATION.md`: 실행팀 구성원 갱신 (general-purpose → frontend-engineer + backend-engineer)
- 매니저는 디스패치만, 구현은 전담 에이전트가 담당

## 변경 사항

1. `.claude/agents/frontend-engineer.md` 신설
2. `.claude/agents/backend-engineer.md` 신설
3. `ORGANIZATION.md` 실행팀 섹션 갱신

## 작업 계획

### Step 1: 에이전트 파일 생성 (병렬 가능)
- 담당: mission-planner가 직접 생성 (단순 파일 생성)
- `frontend-engineer.md`: 프론트엔드 구현 에이전트
- `backend-engineer.md`: 백엔드 구현 에이전트
- 완료 기준: 두 파일이 `.claude/agents/`에 존재, 포맷 일치

### Step 2: ORGANIZATION.md 갱신
- 담당: mission-planner가 직접 수정
- 실행팀 테이블에서 "구현 에이전트 (general-purpose)" → "프론트엔드 엔지니어 (frontend-engineer)" + "백엔드 엔지니어 (backend-engineer)"
- 완료 기준: ORGANIZATION.md 실행팀 섹션 반영

## 에이전트 프롬프트 설계 원칙

**토큰 효율화 (#124) 적용**:
- OS 레벨 규칙(`~/.claude/rules/`)을 프롬프트에 직접 복사하지 않는다
- 파일 경로로 참조 + 핵심 원칙만 인라인 요약
- 구현 시작 전 해당 파일을 Read로 읽는 것을 프로세스에 명시

**frontend-engineer 핵심 컨텍스트**:
- `~/.claude/rules/coding-style.md` 전체
- `frontend/CONVENTIONS.md` (App Router 특화 패턴)
- `~/.claude/rules/testing.md`
- `~/.claude/rules/security.md`
- 스택: Next.js 16 (App Router), Tailwind v4, shadcn/ui, Supabase SSR, Vitest

**backend-engineer 핵심 컨텍스트**:
- `~/.claude/rules/coding-style.md` 전체
- `~/.claude/rules/testing.md`
- `~/.claude/rules/security.md`
- 스택: Node.js ESM, TypeScript, Drizzle ORM, PostgreSQL (Supabase), Claude API

## 리스크

- 에이전트 파일이 존재해도 실제 소환 방식은 매니저 판단에 달림. ORGANIZATION.md에 소환 기준을 명확히 해야 한다.
- 풀스택 작업(프론트+백 동시)은 두 에이전트가 별개로 소환되어 병렬 실행하는 것이 원칙.

## 의사결정 필요

없음 — 바로 구현 가능

# 토론 아카이브 Markdown 렌더링

## 선행 맥락

없음 — 관련 선행 결정/실패 기록 없음.

## 골 정렬

SUPPORT — 토론 결과 가독성 향상 → CEO가 토론 내용을 빠르게 파악 → Phase 2 포착 의사결정 속도 기여. 직접 분석 기능은 아니지만 분석 결과 소비 품질 개선.

## 문제

토론 상세 페이지(`AnalystCard`, `SynthesisPanel`)에서 Markdown 원문이 `whitespace-pre-wrap` 텍스트로 표시됨. `##`, `**bold**`, `- list` 등 마크업이 노출되어 가독성이 현저히 떨어짐.

## Before → After

**Before**: `AnalystCard.tsx`, `SynthesisPanel.tsx`에서 `<p className="whitespace-pre-wrap ...">` 로 원문 노출.

**After**: `react-markdown` + `remark-gfm`으로 렌더링. 헤딩/볼드/리스트/테이블/코드블록이 HTML로 변환되어 표시.

## 변경 사항

### 1. `MarkdownContent` 공유 컴포넌트 신설
- 위치: `frontend/src/shared/components/ui/MarkdownContent.tsx`
- `react-markdown` + `remark-gfm` 사용 (이미 설치됨 — 추가 패키지 없음)
- Tailwind v4 커스텀 CSS로 prose 스타일 적용 (`@tailwindcss/typography` 미사용 — v4 호환 불확실)
- 커스텀 스타일 범위: `h1~h3`, `ul/ol`, `strong`, `table`, `code`, `blockquote`

### 2. `AnalystCard.tsx` 수정
- `<p className="whitespace-pre-wrap ...">` → `<MarkdownContent content={output.content} />`

### 3. `SynthesisPanel.tsx` 수정
- `synthesisReport` 표시 부분 동일하게 교체

### 4. 테스트
- `MarkdownContent.test.tsx` 신설 — 헤딩/리스트/볼드/테이블/코드블록 렌더링 확인
- `AnalystCard.test.tsx`, `SynthesisPanel.test.tsx` 스냅샷/동작 테스트 업데이트

## 작업 계획

| 단계 | 작업 | 에이전트 | 완료 기준 |
|------|------|---------|---------|
| 1 | `MarkdownContent` 컴포넌트 + 스타일 구현 | 실행팀 | Markdown 6종(헤딩/볼드/리스트/테이블/코드/인용) 렌더링 확인 |
| 2 | `AnalystCard`, `SynthesisPanel` 교체 | 실행팀 | 기존 raw text 제거, MarkdownContent 연결 |
| 3 | 테스트 작성 및 기존 테스트 업데이트 | 실행팀 | vitest 커버리지 80% 이상 |

병렬 불가 — 단계 순서 의존.

## 리스크

- `react-markdown@10` + `remark-gfm@4`는 ESM 전용. 프로젝트가 이미 ESM이므로 문제없음.
- `@tailwindcss/typography` 미사용으로 스타일을 직접 작성해야 함. 범위가 제한적(토론 텍스트)이므로 관리 가능.
- XSS: `react-markdown`은 기본적으로 `dangerouslySetInnerHTML` 미사용 — 안전. `rehype-raw` 미추가 조건.

## 의사결정 필요

없음 — 바로 구현 가능.

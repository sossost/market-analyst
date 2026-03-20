#!/bin/bash
# PR 생성 전 문서 동기화 체크
# 유의미한 코드 변경이 있는데 README/ROADMAP/overview가 수정되지 않으면 차단
#
# exit 0 = 통과, exit 2 = 차단 (경고 메시지 출력)

set -euo pipefail

BASE_BRANCH="main"

# 현재 브랜치가 main이면 체크 불필요
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" = "$BASE_BRANCH" ]; then
  exit 0
fi

# main 대비 변경된 파일 목록
CHANGED_FILES=$(git diff "$BASE_BRANCH"...HEAD --name-only 2>/dev/null || echo "")

if [ -z "$CHANGED_FILES" ]; then
  exit 0
fi

# fix:/refactor:/test:/chore: 전용 브랜치는 문서 업데이트 불필요
# feat: 커밋이 하나라도 있을 때만 경로 패턴 체크 적용
# --format=%s 로 제목 줄만 추출하여 본문 텍스트 오탐 방지
FEAT_ONLY_COMMITS=$(git log "$BASE_BRANCH"..HEAD --format="%s" 2>/dev/null | grep "^feat" || true)
ALL_COMMIT_SUBJECTS=$(git log "$BASE_BRANCH"..HEAD --format="%s" 2>/dev/null || echo "")
# 모든 커밋 제목이 fix/refactor/test/chore/docs/perf/ci 이면 경로 패턴 체크 스킵
if [ -z "$FEAT_ONLY_COMMITS" ]; then
  NON_FIX_COMMITS=$(echo "$ALL_COMMIT_SUBJECTS" | grep -vE "^(fix|refactor|test|chore|docs|perf|ci):" || true)
  if [ -z "$NON_FIX_COMMITS" ]; then
    exit 0
  fi
fi

# 유의미한 변경 감지 패턴 (문서 업데이트가 필요한 수준의 변경)
SIGNIFICANT_PATTERNS=(
  "src/agent/tools/"          # 에이전트 도구 추가/변경
  "src/agent/debate/"         # 토론 엔진 변경
  "src/agent/corporateAnalyst/" # 기업 애널리스트
  "src/agent/fundamental/"    # 펀더멘탈 검증
  "src/db/schema/"            # DB 스키마 변경
  "scripts/launchd/"          # 스케줄 변경
  "src/issue-processor/"      # 이슈 프로세서
  "frontend/src/app/"         # 프론트엔드 라우트
)

# 유의미한 변경이 있는지 확인
HAS_SIGNIFICANT_CHANGE=false
SIGNIFICANT_AREAS=""

for pattern in "${SIGNIFICANT_PATTERNS[@]}"; do
  matched=$(echo "$CHANGED_FILES" | grep "^$pattern" || true)
  if [ -n "$matched" ]; then
    HAS_SIGNIFICANT_CHANGE=true
    SIGNIFICANT_AREAS="$SIGNIFICANT_AREAS\n  - $pattern"
  fi
done

# feat: 커밋 제목이 있으면 유의미한 변경으로 추가 표시
if [ -n "$FEAT_ONLY_COMMITS" ]; then
  HAS_SIGNIFICANT_CHANGE=true
  SIGNIFICANT_AREAS="$SIGNIFICANT_AREAS\n  - feat 커밋 감지"
fi

if [ "$HAS_SIGNIFICANT_CHANGE" = false ]; then
  exit 0
fi

# 문서 파일이 수정되었는지 확인
DOC_FILES=("README.md" "docs/ROADMAP.md" "docs/overview.md")
DOCS_UPDATED=false

for doc in "${DOC_FILES[@]}"; do
  if echo "$CHANGED_FILES" | grep -q "^$doc$"; then
    DOCS_UPDATED=true
    break
  fi
done

if [ "$DOCS_UPDATED" = true ]; then
  exit 0
fi

# 차단: 유의미한 변경이 있는데 문서가 업데이트 안 됨
echo "⚠️  문서 동기화 필요"
echo ""
echo "유의미한 변경이 감지되었지만 프로젝트 문서가 업데이트되지 않았습니다."
echo ""
echo "변경된 영역:"
echo -e "$SIGNIFICANT_AREAS"
echo ""
echo "업데이트 필요 문서:"
echo "  - README.md (Feature Roadmap, 운영 지표, 스케줄)"
echo "  - docs/ROADMAP.md (Layer/Phase 진행 상황, 핵심 지표)"
echo "  - docs/overview.md (Feature Map, DB 스키마, 아키텍처)"
echo ""
echo "PR 생성 전에 문서를 업데이트하고 커밋에 포함하세요."
exit 2

#!/bin/bash
#
# 일간 보고서 품질 검증 — Claude Code CLI 기반
#
# 기존 파이프라인(etl-daily.sh) 완료 후 후속 실행.
# 최신 리포트를 DB에서 조회 → claude -p로 검증 → 점수 미달 시 GitHub 이슈 생성.
#
# Usage:
#   ./scripts/cron/validate-daily-report.sh
#
# 필수 환경변수:
#   DATABASE_URL — Supabase 연결
#   GITHUB_TOKEN 또는 gh auth 상태 — 이슈 생성용
#
# 선택 환경변수:
#   VALIDATE_DRY_RUN=1 — 이슈 생성 없이 결과만 저장

set -euo pipefail

# macOS 호환: GNU timeout이 없으면 gtimeout(coreutils) 사용
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_CMD="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_CMD="gtimeout"
else
  echo "ERROR: timeout 또는 gtimeout 필요. brew install coreutils" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/validate-daily-$(date +%Y-%m-%d).log"
QA_DIR="$PROJECT_DIR/data/report-qa"
PROMPT_TEMPLATE="$PROJECT_DIR/scripts/validate-daily-report-prompt.md"
TIMEOUT_SEC=300

mkdir -p "$LOG_DIR" "$QA_DIR"

# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

cd "$PROJECT_DIR"
load_env "$PROJECT_DIR/.env"

# 임시 파일 — 종료 시 자동 정리
PROMPT_FILE=$(mktemp)
CLAUDE_RAW_FILE=$(mktemp)
ISSUE_BODY_FILE=$(mktemp)
trap 'rm -f "$PROMPT_FILE" "$CLAUDE_RAW_FILE" "$ISSUE_BODY_FILE"' EXIT

log "=== 일간 보고서 품질 검증 시작 ==="

# --- Step 1: 최신 리포트 조회 ---
log "▶ 최신 리포트 조회"
REPORT_JSON=$(npx tsx src/scripts/get-latest-report.ts 2>>"$LOG_FILE")

if [ "$REPORT_JSON" = "null" ] || [ -z "$REPORT_JSON" ]; then
  log "리포트 없음 — 검증 건너뜀"
  exit 0
fi

REPORT_DATE=$(echo "$REPORT_JSON" | jq -r '.today.date')

# 날짜 포맷 검증 — 경로 순회/인젝션 방지
if [[ ! "$REPORT_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  log "✗ 유효하지 않은 날짜 포맷: $REPORT_DATE"
  exit 1
fi

REPORT_CONTENT=$(echo "$REPORT_JSON" | jq -r '.today.content')
HAS_PREV=$(echo "$REPORT_JSON" | jq -r '.prev != null')
PREV_DATE=$(echo "$REPORT_JSON" | jq -r '.prev.date // "없음"')
PREV_CONTENT=$(echo "$REPORT_JSON" | jq -r '.prev.content // ""')

log "✓ 리포트 조회 완료 — 오늘: $REPORT_DATE, 직전: $PREV_DATE"

# --- Step 2: 프롬프트 조립 (파일 기반 — 인젝션 방지) ---
log "▶ 프롬프트 조립"

if [ ! -f "$PROMPT_TEMPLATE" ]; then
  log "✗ 프롬프트 템플릿 없음: $PROMPT_TEMPLATE"
  exit 1
fi

# 날짜는 안전한 문자열이므로 bash 치환 사용
PROMPT=$(cat "$PROMPT_TEMPLATE")
PROMPT="${PROMPT//\{REPORT_DATE\}/$REPORT_DATE}"
PROMPT="${PROMPT//\{PREV_DATE\}/$PREV_DATE}"

# content는 특수문자 포함 가능 → Python으로 안전한 치환
python3 -c "
import sys
template = sys.stdin.read()
report = open('/dev/fd/3').read()
prev = open('/dev/fd/4').read()
result = template.replace('{REPORT_CONTENT}', report).replace('{PREV_REPORT_CONTENT}', prev)
sys.stdout.write(result)
" <<< "$PROMPT" 3< <(echo "$REPORT_CONTENT") 4< <(echo "$PREV_CONTENT") > "$PROMPT_FILE"

# prev 없으면 프롬프트에 안내 추가
if [ "$HAS_PREV" = "false" ]; then
  echo "" >> "$PROMPT_FILE"
  echo "참고: 직전 리포트가 없습니다. novelty 항목은 null로 표시하세요." >> "$PROMPT_FILE"
fi

log "✓ 프롬프트 조립 완료"

# --- Step 3: Claude Code CLI 실행 (stdin으로 전달 — 인수 인젝션 방지) ---
log "▶ Claude Code CLI 검증 실행 (타임아웃: ${TIMEOUT_SEC}초)"

QA_RESULT=""
if $TIMEOUT_CMD "$TIMEOUT_SEC" cat "$PROMPT_FILE" | claude -p --output-format json > "$CLAUDE_RAW_FILE" 2>>"$LOG_FILE"; then
  # --output-format json이면 result 필드에 텍스트가 들어옴
  QA_RAW=$(jq -r '.result // .' "$CLAUDE_RAW_FILE" 2>/dev/null || cat "$CLAUDE_RAW_FILE")

  # JSON 추출 — 코드펜스 제거 후 파싱 시도
  QA_RESULT=$(echo "$QA_RAW" | sed 's/^```json//;s/^```//;s/```$//' | jq '.' 2>/dev/null || echo "")

  if [ -z "$QA_RESULT" ]; then
    log "✗ Claude 응답 JSON 파싱 실패"
    echo "$QA_RAW" >> "$LOG_FILE"
    exit 0
  fi
  log "✓ Claude 검증 완료"
else
  log "✗ Claude CLI 실행 실패 또는 타임아웃"
  exit 0
fi

# --- Step 4: 결과 저장 ---
QA_FILE="$QA_DIR/$REPORT_DATE.json"
echo "$QA_RESULT" | jq --arg date "$REPORT_DATE" '. + {reportDate: $date, validatedAt: (now | todate)}' > "$QA_FILE"
log "✓ 검증 결과 저장: $QA_FILE"

# --- Step 5: 이슈 생성 판단 ---
HAS_ISSUE=$(echo "$QA_RESULT" | jq -r '.hasIssue // false')
TOTAL_SCORE=$(echo "$QA_RESULT" | jq -r '.totalScore // 0')
SUMMARY=$(echo "$QA_RESULT" | jq -r '.summary // ""')

log "점수: $TOTAL_SCORE/40 | 이슈: $HAS_ISSUE | $SUMMARY"

if [ "$HAS_ISSUE" = "true" ]; then
  if [ "${VALIDATE_DRY_RUN:-}" = "1" ]; then
    log "DRY_RUN 모드 — 이슈 생성 건너뜀"
  else
    # 이슈 제목 길이 제한 (LLM 출력 검증 — indirect injection 방어)
    ISSUE_TITLE=$(echo "$QA_RESULT" | jq -r '.issueTitle // "일간 보고서 품질 이슈"' | head -c 100)

    # 이슈 본문을 파일로 전달 (인수 인젝션 방지)
    echo "$QA_RESULT" | jq -r '.issueBody // ""' > "$ISSUE_BODY_FILE"

    # 우선순위 결정: 3점 미만 항목 있으면 P1, 아니면 P2 (jq로 처리 — bc 의존 제거)
    PRIORITY_LABEL="P2: medium"
    if echo "$QA_RESULT" | jq -e '
      [.scores.factConsistency, .scores.bullBias, .scores.structure] +
      (if .scores.novelty != null then [.scores.novelty] else [] end) |
      map(select(. < 3)) | length > 0
    ' > /dev/null 2>&1; then
      PRIORITY_LABEL="P1: high"
    fi

    log "▶ GitHub 이슈 생성 (${PRIORITY_LABEL})"

    ISSUE_URL=$(gh issue create \
      --title "$ISSUE_TITLE" \
      --body-file "$ISSUE_BODY_FILE" \
      --label "report-feedback" \
      --label "$PRIORITY_LABEL" 2>>"$LOG_FILE") || true

    if [ -n "${ISSUE_URL:-}" ]; then
      log "✓ 이슈 생성: $ISSUE_URL"
    else
      log "✗ 이슈 생성 실패 (gh 명령 오류)"
    fi
  fi
fi

log "=== 일간 보고서 품질 검증 완료 ==="

#!/bin/bash
#
# 펀더멘탈 리포트 품질 검증 — Claude Code CLI 기반
#
# 펀더멘탈 파이프라인(publishStockReport) 완료 후 후속 실행.
# data/fundamental-reports/ 에서 당일 리포트를 조회 → 종목별 claude -p 검증 → 점수 미달 시 GitHub 이슈 생성.
#
# Usage:
#   ./scripts/cron/validate-fundamental-report.sh
#   ./scripts/cron/validate-fundamental-report.sh 2026-03-11   # 날짜 지정
#
# 필수 환경변수:
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
LOG_FILE="$LOG_DIR/validate-fundamental-$(date +%Y-%m-%d).log"
QA_DIR="$PROJECT_DIR/data/report-qa"
PROMPT_TEMPLATE="$PROJECT_DIR/scripts/validate-fundamental-report-prompt.md"
TIMEOUT_SEC=300
TARGET_DATE="${1:-$(date +%Y-%m-%d)}"

mkdir -p "$LOG_DIR" "$QA_DIR"

# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

cd "$PROJECT_DIR"
load_env "$PROJECT_DIR/.env"

# 날짜 포맷 검증 — 경로 순회/인젝션 방지
if [[ ! "$TARGET_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  log "✗ 유효하지 않은 날짜 포맷: $TARGET_DATE"
  exit 1
fi

log "=== 펀더멘탈 리포트 품질 검증 시작 ($TARGET_DATE) ==="

# --- Step 1: 당일 리포트 조회 ---
log "▶ 펀더멘탈 리포트 조회"
REPORTS_JSON=$(npx tsx src/scripts/get-latest-fundamental-report.ts "$TARGET_DATE" 2>>"$LOG_FILE")

if [ "$REPORTS_JSON" = "null" ] || [ -z "$REPORTS_JSON" ]; then
  log "리포트 없음 — 검증 건너뜀"
  exit 0
fi

REPORT_COUNT=$(echo "$REPORTS_JSON" | jq '.reports | length')
log "✓ 리포트 ${REPORT_COUNT}건 발견"

if [ "$REPORT_COUNT" -eq 0 ]; then
  log "리포트 0건 — 검증 건너뜀"
  exit 0
fi

# 프롬프트 템플릿 확인
if [ ! -f "$PROMPT_TEMPLATE" ]; then
  log "✗ 프롬프트 템플릿 없음: $PROMPT_TEMPLATE"
  exit 1
fi

# 공유 임시 파일 — 종료 시 자동 정리 (루프 내 mktemp 누출 방지)
PROMPT_FILE=$(mktemp)
CLAUDE_RAW_FILE=$(mktemp)
ISSUE_BODY_FILE=$(mktemp)
trap 'rm -f "$PROMPT_FILE" "$CLAUDE_RAW_FILE" "$ISSUE_BODY_FILE"' EXIT

# --- Step 2: 종목별 검증 루프 ---
for i in $(seq 0 $((REPORT_COUNT - 1))); do
  SYMBOL=$(echo "$REPORTS_JSON" | jq -r ".reports[$i].symbol")
  REPORT_DATE=$(echo "$REPORTS_JSON" | jq -r ".reports[$i].date")
  REPORT_CONTENT=$(echo "$REPORTS_JSON" | jq -r ".reports[$i].content")

  # 심볼 안전성 검증 (알파벳+숫자+점만 허용)
  if [[ ! "$SYMBOL" =~ ^[A-Z0-9.]+$ ]]; then
    log "✗ 유효하지 않은 심볼: $SYMBOL — 건너뜀"
    continue
  fi

  log "▶ [$SYMBOL] 검증 시작"

  # 프롬프트 조립 (파일 기반 — 인젝션 방지)
  # 날짜와 심볼은 안전한 문자열이므로 bash 치환 사용
  PROMPT=$(cat "$PROMPT_TEMPLATE")
  PROMPT="${PROMPT//\{REPORT_DATE\}/$REPORT_DATE}"
  PROMPT="${PROMPT//\{SYMBOL\}/$SYMBOL}"

  # content는 특수문자 포함 가능 → Python으로 안전한 치환
  python3 -c "
import sys
template = sys.stdin.read()
report = open('/dev/fd/3').read()
result = template.replace('{REPORT_CONTENT}', report)
sys.stdout.write(result)
" <<< "$PROMPT" 3< <(echo "$REPORT_CONTENT") > "$PROMPT_FILE"

  # Claude Code CLI 실행 (stdin으로 전달)
  log "  ▶ Claude CLI 검증 실행 (타임아웃: ${TIMEOUT_SEC}초)"

  QA_RESULT=""
  if run_claude_p $TIMEOUT_CMD "$TIMEOUT_SEC" claude -p --output-format json < "$PROMPT_FILE" > "$CLAUDE_RAW_FILE" 2>>"$LOG_FILE"; then
    # --output-format json이면 result 필드에 텍스트가 들어옴
    QA_RAW=$(jq -r '.result // .' "$CLAUDE_RAW_FILE" 2>/dev/null || cat "$CLAUDE_RAW_FILE")

    # JSON 추출 — 코드펜스 제거 후 파싱 시도
    QA_RESULT=$(echo "$QA_RAW" | sed 's/^```json//;s/^```//;s/```$//' | jq '.' 2>/dev/null || echo "")

    if [ -z "$QA_RESULT" ]; then
      log "  ✗ [$SYMBOL] Claude 응답 JSON 파싱 실패"
      echo "$QA_RAW" >> "$LOG_FILE"
      continue
    fi
    log "  ✓ [$SYMBOL] Claude 검증 완료"
  else
    log "  ✗ [$SYMBOL] Claude CLI 실행 실패 또는 타임아웃"
    continue
  fi

  # 결과 저장
  QA_FILE="$QA_DIR/fundamental-${SYMBOL}-${REPORT_DATE}.json"
  echo "$QA_RESULT" | jq \
    --arg symbol "$SYMBOL" \
    --arg date "$REPORT_DATE" \
    '. + {symbol: $symbol, reportDate: $date, validatedAt: (now | todate)}' > "$QA_FILE"
  log "  ✓ [$SYMBOL] 결과 저장: $QA_FILE"

  # 이슈 생성 판단
  HAS_ISSUE=$(echo "$QA_RESULT" | jq -r '.hasIssue // false')
  TOTAL_SCORE=$(echo "$QA_RESULT" | jq -r '.totalScore // 0')
  SUMMARY=$(echo "$QA_RESULT" | jq -r '.summary // ""')

  log "  [$SYMBOL] 점수: $TOTAL_SCORE/40 | 이슈: $HAS_ISSUE | $SUMMARY"

  if [ "$HAS_ISSUE" = "true" ]; then
    if [ "${VALIDATE_DRY_RUN:-}" = "1" ]; then
      log "  DRY_RUN 모드 — 이슈 생성 건너뜀"
    else
      # 이슈 제목 (LLM 출력 검증 — indirect injection 방어)
      ISSUE_TITLE=$(echo "$QA_RESULT" | jq -r \
        --arg sym "$SYMBOL" \
        --arg date "$REPORT_DATE" \
        --arg score "$TOTAL_SCORE" \
        '.issueTitle // "[\($sym)] 펀더멘탈 리포트 품질 이슈 — \($date) (점수: \($score)/40)"' \
        | head -c 100)

      # 이슈 본문을 파일로 전달 (인수 인젝션 방지)
      echo "$QA_RESULT" | jq -r '.issueBody // ""' > "$ISSUE_BODY_FILE"

      # 우선순위 결정: 3점 미만 항목 있으면 P1, 아니면 P2
      PRIORITY_LABEL="P2: medium"
      if echo "$QA_RESULT" | jq -e '
        [.scores.dataAccuracy, .scores.narrativeBasis, .scores.structuralCompleteness, .scores.investmentClarity] |
        map(select(. < 3)) | length > 0
      ' > /dev/null 2>&1; then
        PRIORITY_LABEL="P1: high"
      fi

      log "  ▶ [$SYMBOL] GitHub 이슈 생성 (${PRIORITY_LABEL})"

      ISSUE_URL=$(gh issue create \
        --title "$ISSUE_TITLE" \
        --body-file "$ISSUE_BODY_FILE" \
        --label "report-feedback" \
        --label "$PRIORITY_LABEL" 2>>"$LOG_FILE") || true

      if [ -n "${ISSUE_URL:-}" ]; then
        log "  ✓ [$SYMBOL] 이슈 생성: $ISSUE_URL"
      else
        log "  ✗ [$SYMBOL] 이슈 생성 실패 (gh 명령 오류)"
      fi
    fi
  fi

done

log "=== 펀더멘탈 리포트 품질 검증 완료 ==="

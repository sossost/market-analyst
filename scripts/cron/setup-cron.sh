#!/bin/bash
#
# 맥미니 크론잡 설정 스크립트
#
# GitHub Actions 스케줄과 동일:
#   ETL Daily:    평일 UTC 23:30 (KST 08:30)
#   Debate Daily: 평일 UTC 22:00 (KST 07:00)
#   Agent Weekly: 토 UTC 01:00 (KST 10:00)
#   QA Weekly:    토 UTC 03:00 (KST 12:00)
#
# Usage:
#   ./scripts/cron/setup-cron.sh          # 크론 등록
#   ./scripts/cron/setup-cron.sh --remove # 크론 제거
#   ./scripts/cron/setup-cron.sh --show   # 현재 크론 확인

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

MARKER_START="# === market-analyst cron START ==="
MARKER_END="# === market-analyst cron END ==="

# 경로에 cron 안전하지 않은 문자가 있으면 거부
validate_paths() {
  if [[ "$PROJECT_DIR" =~ [^a-zA-Z0-9/_.\-] ]] || [[ "$SCRIPT_DIR" =~ [^a-zA-Z0-9/_.\-] ]]; then
    echo "오류: 경로에 cron 안전하지 않은 문자가 포함되어 있습니다." >&2
    echo "  PROJECT_DIR: $PROJECT_DIR" >&2
    echo "  SCRIPT_DIR: $SCRIPT_DIR" >&2
    exit 1
  fi
}

show_cron() {
  echo "현재 등록된 크론잡:"
  crontab -l 2>/dev/null || echo "(없음)"
}

remove_cron() {
  local current
  current=$(crontab -l 2>/dev/null || echo "")

  if echo "$current" | grep -q "$MARKER_START"; then
    echo "$current" | sed "/$MARKER_START/,/$MARKER_END/d" | crontab -
    echo "market-analyst 크론잡 제거 완료."
  fi
}

install_cron() {
  validate_paths

  # 기존 항목 제거 (중복 방지, 출력 억제)
  remove_cron > /dev/null 2>&1

  local current
  current=$(crontab -l 2>/dev/null || echo "")

  local entries
  entries="$MARKER_START
# ETL Daily: 평일 UTC 23:30 (KST 08:30) — Sun-Fri
30 23 * * 0-5 $SCRIPT_DIR/etl-daily.sh >> $PROJECT_DIR/logs/cron.log 2>&1
# Debate Daily: 평일 UTC 22:00 (KST 07:00) — Sun-Thu (= KST Mon-Fri)
0 22 * * 0-4 $SCRIPT_DIR/debate-daily.sh >> $PROJECT_DIR/logs/cron.log 2>&1
# Agent Weekly: 토 UTC 01:00 (KST 10:00)
0 1 * * 6 $SCRIPT_DIR/agent-weekly.sh >> $PROJECT_DIR/logs/cron.log 2>&1
# QA Weekly: 토 UTC 03:00 (KST 12:00) — Agent Weekly(01:00) 이후
0 3 * * 6 $SCRIPT_DIR/qa-weekly.sh >> $PROJECT_DIR/logs/cron.log 2>&1
# Log cleanup: 매주 일 — 30일 이상 로그 삭제
0 0 * * 0 find $PROJECT_DIR/logs -name '*.log' -mtime +30 -delete 2>/dev/null
$MARKER_END"

  if [ -n "$current" ]; then
    echo "${current}
${entries}" | crontab -
  else
    echo "$entries" | crontab -
  fi

  echo "크론잡 등록 완료:"
  echo ""
  echo "  ETL Daily:    평일 UTC 23:30 (KST 08:30)"
  echo "  Debate Daily: 평일 UTC 22:00 Sun-Thu (KST 07:00 Mon-Fri)"
  echo "  Agent Weekly: 토 UTC 01:00 (KST 10:00)"
  echo "  QA Weekly:    토 UTC 03:00 (KST 12:00)"
  echo "  Log Cleanup:  일 UTC 00:00 (30일 이상 삭제)"
  echo ""
  echo "로그 경로: $PROJECT_DIR/logs/"
}

case "${1:-}" in
  --remove)
    remove_cron
    ;;
  --show)
    show_cron
    ;;
  *)
    install_cron
    ;;
esac

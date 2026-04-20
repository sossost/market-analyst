#!/bin/bash
#
# macOS launchd 스케줄 설정 — cron 대체
#
# cron과 달리 SSH 원격에서도 등록/해제 가능.
# git pull 후 재실행하면 최신 스케줄 반영.
#
# Usage:
#   ./scripts/launchd/setup-launchd.sh              # 등록
#   ./scripts/launchd/setup-launchd.sh --remove      # 해제
#   ./scripts/launchd/setup-launchd.sh --status       # 상태 확인
#   ./scripts/launchd/setup-launchd.sh --remove-cron  # 기존 cron 제거 후 launchd 등록

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PREFIX="com.market-analyst"

PLISTS=(
  "com.market-analyst.etl-daily"
  "com.market-analyst.etl-weekly"
  "com.market-analyst.agent-weekly"
  "com.market-analyst.qa-weekly"
  "com.market-analyst.log-cleanup"
  "com.market-analyst.news-collect"
  "com.market-analyst.strategic-review"
  "com.market-analyst.issue-triage"
  "com.market-analyst.issue-processor"
  "com.market-analyst.pr-reviewer"
  "com.market-analyst.component-review"
)

unload_agents() {
  for name in "${PLISTS[@]}"; do
    local target="$LAUNCH_AGENTS_DIR/${name}.plist"
    if [ -f "$target" ]; then
      launchctl unload "$target" 2>/dev/null || true
      rm -f "$target"
    fi
  done
}

install_agents() {
  mkdir -p "$LAUNCH_AGENTS_DIR"
  mkdir -p "$PROJECT_DIR/logs"

  # 기존 것 해제 (중복 방지)
  unload_agents

  for name in "${PLISTS[@]}"; do
    local src="$SCRIPT_DIR/${name}.plist"
    local target="$LAUNCH_AGENTS_DIR/${name}.plist"

    if [ ! -f "$src" ]; then
      echo "경고: $src 없음, 건너뜀"
      continue
    fi

    # __PROJECT_DIR__ 플레이스홀더를 실제 경로로 치환
    sed "s|__PROJECT_DIR__|${PROJECT_DIR}|g" "$src" > "$target"
    launchctl load "$target"
    echo "  ✓ ${name} 등록"
  done

  echo ""
  echo "launchd 스케줄 등록 완료:"
  echo "  ETL Daily:    KST 07:00 화-토 (ETL → 토론 → 일간보고서)"
  echo "  ETL Weekly:   KST 08:00 일 (분기재무 + 비율)"
  echo "  Agent Weekly: KST 10:00 토"
  echo "  QA Weekly:    KST 12:00 토"
  echo "  Log Cleanup:  KST 09:00 일"
  echo "  News Collect: KST 06:00/18:00 매일"
  echo "  Strategy:     KST 04:00 매일"
  echo "  Issue Proc:   KST 09:00~02:00 매 정시 (18회/일)"
  echo "  PR Reviewer:  KST 09:30~02:30 매 :30분 (18회/일)"
  echo "  Comp Review:  KST 06:00 일 (컴포넌트 자가 점검)"
  echo ""
  echo "로그: $PROJECT_DIR/logs/"
}

remove_agents() {
  unload_agents
  echo "launchd 스케줄 해제 완료."
}

show_status() {
  echo "market-analyst launchd 상태:"
  echo ""
  for name in "${PLISTS[@]}"; do
    local status
    if launchctl list "$name" > /dev/null 2>&1; then
      status="✓ 등록됨"
    else
      status="✗ 미등록"
    fi
    printf "  %-45s %s\n" "$name" "$status"
  done
}

remove_cron() {
  local marker_start="# === market-analyst cron START ==="
  local marker_end="# === market-analyst cron END ==="
  local current
  current=$(crontab -l 2>/dev/null || echo "")

  if echo "$current" | grep -q "$marker_start"; then
    echo "$current" | awk "/$marker_start/{skip=1} /$marker_end/{skip=0; next} !skip" | crontab -
    echo "  ✓ 기존 cron 제거 완료"
  else
    echo "  - 기존 cron 없음"
  fi
}

case "${1:-}" in
  --remove)
    remove_agents
    ;;
  --status)
    show_status
    ;;
  --remove-cron)
    echo "1/2: 기존 cron 제거"
    remove_cron
    echo "2/2: launchd 등록"
    install_agents
    ;;
  *)
    install_agents
    ;;
esac

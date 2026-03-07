#!/bin/bash
#
# 크론잡 공통 유틸리티
# 각 스크립트에서 source로 로드

# PATH 설정 (cron 환경에서 node를 찾기 위해)
export PATH="/opt/homebrew/opt/node@20/bin:/opt/homebrew/bin:$PATH"

# .env 안전 로드 (source 대신 — 명령 실행 방지)
load_env() {
  local env_file="$1"
  [ -f "$env_file" ] || return 0

  while IFS='=' read -r key value; do
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$key" ]] && continue
    key=$(echo "$key" | xargs)
    value=$(echo "$value" | xargs)
    # 따옴표 쌍 매칭으로 제거 (앞뒤가 같은 따옴표일 때만)
    if [[ "$value" =~ ^\"(.*)\"$ ]] || [[ "$value" =~ ^\'(.*)\'$ ]]; then
      value="${BASH_REMATCH[1]}"
    fi
    export "$key=$value"
  done < "$env_file"
}

# 로그 함수
log() {
  echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Discord 에러 알림 (jq로 안전한 JSON 생성)
send_error() {
  local msg="$1"
  local source="${2:-스크립트}"
  local webhook="${DISCORD_ERROR_WEBHOOK_URL:-}"
  if [ -n "$webhook" ]; then
    local payload
    payload=$(jq -n --arg content "⚠️ ${source} 에러 (맥미니)

${msg}

로그: ${LOG_FILE}" '{content: $content}')
    curl -s -X POST "$webhook" \
      -H "Content-Type: application/json" \
      --data-binary "$payload" \
      > /dev/null 2>&1 || true
  fi
}

# 단일 step 실행
run_step() {
  local name="$1"
  local script="$2"
  log "▶ $name"
  if npx tsx "$script" >> "$LOG_FILE" 2>&1; then
    log "✓ $name 완료"
  else
    log "✗ $name 실패"
    send_error "$name 실패" "ETL"
    exit 1
  fi
}

# 병렬 step 실행 (하나 실패 시 나머지 kill)
run_parallel() {
  local pids=()
  local names=()
  local failed=0

  while [ $# -gt 0 ]; do
    local name="$1"
    local script="$2"
    shift 2

    log "▶ $name (병렬)"
    npx tsx "$script" >> "$LOG_FILE" 2>&1 &
    pids+=($!)
    names+=("$name")
  done

  for i in "${!pids[@]}"; do
    if ! wait "${pids[$i]}"; then
      log "✗ ${names[$i]} 실패"
      failed=1
      # 나머지 잡 즉시 종료
      for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
      break
    fi
    log "✓ ${names[$i]} 완료"
  done

  if [ $failed -eq 1 ]; then
    send_error "병렬 step 실패 (${names[*]})" "ETL"
    exit 1
  fi
}

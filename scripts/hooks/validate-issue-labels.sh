#!/bin/bash
# 이슈 생성 전 라벨 검증 훅
# 존재하지 않는 라벨이 있으면 차단한다.
#
# stdin: JSON { tool_name, tool_input: { labels: [...] } }
# exit 0 = 통과, exit 2 = 차단

set -euo pipefail

INPUT=$(cat)

# labels 필드 추출 (없으면 통과)
LABELS=$(echo "$INPUT" | jq -r '.tool_input.labels // empty | .[]' 2>/dev/null)
if [ -z "$LABELS" ]; then
  exit 0
fi

# 레포 기존 라벨 목록 캐시 (세션 내 재사용)
CACHE_FILE="/tmp/gh-labels-cache-$(git rev-parse --short HEAD 2>/dev/null || echo 'none').txt"
if [ ! -f "$CACHE_FILE" ] || [ "$(find "$CACHE_FILE" -mmin +30 2>/dev/null)" ]; then
  gh label list --limit 200 --json name -q '.[].name' > "$CACHE_FILE" 2>/dev/null
fi

INVALID_LABELS=""
while IFS= read -r label; do
  if ! grep -qxF "$label" "$CACHE_FILE"; then
    INVALID_LABELS="$INVALID_LABELS\n  - \"$label\""
  fi
done <<< "$LABELS"

if [ -n "$INVALID_LABELS" ]; then
  echo "BLOCKED: 존재하지 않는 라벨 사용 감지"
  echo ""
  echo "잘못된 라벨:"
  echo -e "$INVALID_LABELS"
  echo ""
  echo "사용 가능한 라벨:"
  cat "$CACHE_FILE" | sed 's/^/  - /'
  echo ""
  echo "기존 라벨 목록에서 정확한 이름을 사용하세요."
  exit 2
fi

exit 0

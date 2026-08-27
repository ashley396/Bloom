#!/usr/bin/env bash
# PostToolUse hook (matcher: Edit|Write) — after a JS file is edited,
# runs `node --check` on it as a fast, real syntax check. Non-blocking:
# reports a problem via additionalContext, never fails the tool call
# (the edit already happened; this is a heads-up, not a gate). Skips
# anything that isn't a plain .js/.mjs/.cjs file. Never touches or
# prints secrets.
set -euo pipefail

INPUT="$(cat)"
FILE_PATH="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"

[ -z "$FILE_PATH" ] && exit 0

case "$FILE_PATH" in
  *.js|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac

[ -f "$FILE_PATH" ] || exit 0

if ! ERROR_OUTPUT="$(node --check "$FILE_PATH" 2>&1)"; then
  CONTEXT="Syntax check failed for $FILE_PATH after this edit: $ERROR_OUTPUT"
  jq -n --arg ctx "$CONTEXT" \
    '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$ctx}}'
fi
exit 0

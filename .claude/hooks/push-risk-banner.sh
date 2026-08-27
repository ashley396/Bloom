#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash) — for ANY `git push`, surfaces the
# current branch and whether it's the protected auto-deploying branch,
# as additionalContext (never blocks — block-beta-push.sh already
# handles the actual block for the protected branch). Informational
# only; never touches or prints secrets.
set -euo pipefail

PROTECTED_BRANCH="beta/august10-stabilization"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

INPUT="$(cat)"
COMMAND="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"

[ -z "$COMMAND" ] && exit 0
if ! printf '%s' "$COMMAND" | grep -qE '(^|[;&|]|[[:space:]])git[[:space:]]+push([[:space:]]|$)'; then
  exit 0
fi

CURRENT_BRANCH="$(cd "$PROJECT_DIR" 2>/dev/null && { git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null; } || echo "unknown")"
HEAD_SHA="$(cd "$PROJECT_DIR" 2>/dev/null && git rev-parse --short HEAD 2>/dev/null || echo "unknown")"

if [ "$CURRENT_BRANCH" = "$PROTECTED_BRANCH" ]; then
  RISK="HIGH — this branch auto-deploys to www.florisyn.com on push."
else
  RISK="normal — not the auto-deploying branch."
fi

CONTEXT="Deploy-risk banner: current branch is '$CURRENT_BRANCH' at $HEAD_SHA. Risk: $RISK"
jq -n --arg ctx "$CONTEXT" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:$ctx}}'
exit 0

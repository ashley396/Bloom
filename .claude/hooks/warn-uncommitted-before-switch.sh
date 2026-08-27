#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash) — warns (never blocks) when a
# `git checkout`/`git switch` is about to run while the working tree has
# uncommitted changes, so real work isn't silently left behind on a
# branch switch. Never touches or prints secrets.
set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

INPUT="$(cat)"
COMMAND="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"

[ -z "$COMMAND" ] && exit 0
if ! printf '%s' "$COMMAND" | grep -qE '(^|[;&|]|[[:space:]])git[[:space:]]+(checkout|switch)([[:space:]]|$)'; then
  exit 0
fi

STATUS="$(cd "$PROJECT_DIR" 2>/dev/null && git status --porcelain 2>/dev/null || true)"
if [ -n "$STATUS" ]; then
  FILE_COUNT="$(printf '%s\n' "$STATUS" | grep -c . || true)"
  CONTEXT="Warning: the working tree has $FILE_COUNT uncommitted change(s) before this branch switch. Confirm this is intentional (e.g. these changes belong on the new branch, or should be committed/stashed first) rather than letting real work get silently stranded."
  jq -n --arg ctx "$CONTEXT" \
    '{hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:$ctx}}'
fi
exit 0

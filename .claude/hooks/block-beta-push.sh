#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash) — blocks any `git push` that would move
# beta/august10-stabilization, which auto-deploys to www.florisyn.com,
# UNLESS a valid one-use approval ticket exists for the exact commit
# being pushed. See "One-use production approval" in the root CLAUDE.md
# for the full mechanism and how Ashley actually uses it (one plain-
# language sentence in conversation — she never edits this file or
# settings.json herself).
#
# This is real, immediate enforcement against an accidental or routine
# push. It is NOT a security boundary: an agent with write access to
# this repo's .claude/ could remove or edit this hook, or write itself a
# ticket. Its purpose is to force one deliberate, visible checkpoint
# before that branch ever moves. It never touches, reads, or prints any
# secret — the ticket file itself never contains one either.
set -euo pipefail

PROTECTED_BRANCH="beta/august10-stabilization"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
TICKET_FILE="$PROJECT_DIR/.claude/hooks/.beta-push-approval.json"
LOG_FILE="$PROJECT_DIR/.claude/hooks/.beta-push-approval.log"

INPUT="$(cat)"
COMMAND="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"

# Not a Bash tool call / no command field at all — nothing to check.
[ -z "$COMMAND" ] && exit 0

# Only look at commands that actually invoke `git push`.
if ! printf '%s' "$COMMAND" | grep -qE '(^|[;&|]|[[:space:]])git[[:space:]]+push([[:space:]]|$)'; then
  exit 0
fi

TARGET_IS_PROTECTED=0

if printf '%s' "$COMMAND" | grep -qF "$PROTECTED_BRANCH"; then
  TARGET_IS_PROTECTED=1
else
  # No branch named explicitly on the command line — `git push` with no
  # refspec pushes the current branch to its configured upstream, so fall
  # back to checking what branch is actually checked out.
  CURRENT_BRANCH="$(cd "$PROJECT_DIR" 2>/dev/null && { git symbolic-ref --short HEAD 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null; } || true)"
  if [ "$CURRENT_BRANCH" = "$PROTECTED_BRANCH" ]; then
    TARGET_IS_PROTECTED=1
  fi
fi

[ "$TARGET_IS_PROTECTED" = "1" ] || exit 0

log_event() {
  # {timestamp, branch, sha, outcome} only — never the command line itself
  # (which could theoretically carry a token in a pathological remote
  # URL), never ticket contents beyond what's already logged here.
  printf '{"ts":"%s","branch":"%s","sha":"%s","outcome":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PROTECTED_BRANCH" "${1:-unknown}" "$2" >> "$LOG_FILE" 2>/dev/null || true
}

HEAD_SHA="$(cd "$PROJECT_DIR" 2>/dev/null && git rev-parse HEAD 2>/dev/null || true)"

# One-use approval ticket check. The ticket is a small local JSON file
# ({branch, sha, expires_at}) that only Claude ever writes, and only in
# direct response to Ashley's own explicit, in-conversation approval —
# never something this hook or a confused agent state can create on its
# own. It is consumed (deleted) the instant it's used, whether the push
# itself succeeds or fails once it leaves this hook, so it can never
# authorize a second push.
if [ -f "$TICKET_FILE" ]; then
  TICKET_BRANCH="$(jq -r '.branch // empty' "$TICKET_FILE" 2>/dev/null || true)"
  TICKET_SHA="$(jq -r '.sha // empty' "$TICKET_FILE" 2>/dev/null || true)"
  TICKET_EXPIRES="$(jq -r '.expires_at // empty' "$TICKET_FILE" 2>/dev/null || true)"
  NOW_EPOCH="$(date -u +%s)"
  EXPIRES_EPOCH="$(date -u -d "$TICKET_EXPIRES" +%s 2>/dev/null || date -u -jf "%Y-%m-%dT%H:%M:%SZ" "$TICKET_EXPIRES" +%s 2>/dev/null || echo 0)"

  # Consume unconditionally the moment it's read, valid or not — a
  # malformed/stale/mismatched ticket must never be retryable either.
  rm -f "$TICKET_FILE" 2>/dev/null || true

  if [ -n "$TICKET_SHA" ] && [ "$TICKET_BRANCH" = "$PROTECTED_BRANCH" ] && [ "$TICKET_SHA" = "$HEAD_SHA" ] && [ "$EXPIRES_EPOCH" -gt "$NOW_EPOCH" ] 2>/dev/null; then
    log_event "$HEAD_SHA" "approved_and_consumed"
    exit 0
  fi
  log_event "$HEAD_SHA" "ticket_rejected_invalid_or_expired_or_wrong_commit"
fi

log_event "$HEAD_SHA" "blocked_no_valid_ticket"
REASON="Blocked: this git push would move beta/august10-stabilization, which auto-deploys to www.florisyn.com. This requires Ashley's explicit, in-conversation approval for this exact commit. If she has just approved this push, Claude creates a one-use ticket for this exact SHA and retries — no manual settings.json edit needed. If she hasn't approved it, don't retry."
jq -n --arg reason "$REASON" \
  '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
exit 2

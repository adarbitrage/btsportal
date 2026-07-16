#!/bin/bash
# Mirror the Replit `master` branch to GitHub `main`
# (https://github.com/adarbitrage/btsportal).
#
# How it works:
#   - Called at the end of scripts/post-merge.sh, which the platform runs
#     automatically after every task merge — so GitHub tracks master with no
#     manual steps.
#   - Auth uses the GITHUB_TOKEN secret via a throwaway GIT_ASKPASS helper.
#     The token is NEVER placed on a command line, in a remote URL, or in git
#     config, so it cannot leak into process lists, `git remote -v`, or logs.
#   - The push is a forced mirror (master is the single source of truth;
#     direct commits to GitHub main will be overwritten).
#   - Skips quietly when GITHUB_TOKEN is unset (e.g. task-agent sandboxes) and
#     never hard-fails: post-merge treats a failed sync as non-fatal.
#   - Tracks consecutive failures in .local/github-sync-failcount (git-ignored,
#     persists across merges). After 3 failures in a row it prints a loud,
#     unmissable banner in the post-merge log so a revoked/expired GITHUB_TOKEN
#     doesn't silently retry-forever. Any success resets the counter.
#
# Usage: bash scripts/github-sync.sh [--dry-run]
set -u

REPO_URL="https://github.com/adarbitrage/btsportal.git"
FAILCOUNT_FILE=".local/github-sync-failcount"
FAIL_ALERT_THRESHOLD=3

record_failure() {
  mkdir -p "$(dirname "$FAILCOUNT_FILE")" 2>/dev/null || true
  local count=0
  if [ -f "$FAILCOUNT_FILE" ]; then
    count="$(tr -cd '0-9' < "$FAILCOUNT_FILE")"
    count="${count:-0}"
  fi
  count=$((count + 1))
  echo "$count" > "$FAILCOUNT_FILE" 2>/dev/null || true
  echo "[github-sync] Push to GitHub failed (non-fatal). Consecutive failures: $count." >&2
  if [ "$count" -ge "$FAIL_ALERT_THRESHOLD" ]; then
    {
      echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
      echo "!! [github-sync] ALERT: GitHub mirror has failed $count merges in a row."
      echo "!! GitHub main (adarbitrage/btsportal) is FALLING BEHIND Replit master."
      echo "!! Most likely cause: GITHUB_TOKEN expired or lost repo write access."
      echo "!! Fix: rotate the GITHUB_TOKEN secret, then run: bash scripts/github-sync.sh"
      echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    } >&2
  fi
}

record_success() {
  rm -f "$FAILCOUNT_FILE" 2>/dev/null || true
}

if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "[github-sync] GITHUB_TOKEN not set; skipping GitHub mirror."
  exit 0
fi

ASKPASS="$(mktemp)"
trap 'rm -f "$ASKPASS"' EXIT
cat > "$ASKPASS" <<'EOF'
#!/bin/bash
case "$1" in
  Username*) echo "x-access-token" ;;
  *)         echo "${GITHUB_TOKEN}" ;;
esac
EOF
chmod 700 "$ASKPASS"

DRY_RUN=""
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN="--dry-run"
fi

if GIT_ASKPASS="$ASKPASS" GIT_TERMINAL_PROMPT=0 \
  git push $DRY_RUN --force "$REPO_URL" master:main; then
  echo "[github-sync] Mirrored master -> GitHub main${DRY_RUN:+ (dry run)}."
  record_success
else
  record_failure
  exit 1
fi

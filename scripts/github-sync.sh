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
#
# Usage: bash scripts/github-sync.sh [--dry-run]
set -u

REPO_URL="https://github.com/adarbitrage/btsportal.git"

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
else
  echo "[github-sync] Push to GitHub failed (non-fatal)." >&2
  exit 1
fi

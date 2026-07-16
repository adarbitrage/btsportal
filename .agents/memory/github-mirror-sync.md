---
name: GitHub mirror sync
description: How the Replit repo auto-mirrors to GitHub adarbitrage/btsportal
---
`scripts/post-merge.sh` ends with a best-effort call to `scripts/github-sync.sh`, which force-pushes `master` -> GitHub `main` (adarbitrage/btsportal).

**Why:** GitHub is a read-only mirror; Replit master is the single source of truth. Auth is the `GITHUB_TOKEN` secret fed through a throwaway GIT_ASKPASS helper so the token never lands on a command line, saved remote, or git config.

**How to apply:** Never add a persistent github remote or embed the token in a URL. Direct commits on GitHub main are overwritten by the next mirror push — don't treat GitHub as a writable branch. The script skips silently when GITHUB_TOKEN is unset and never fails post-merge; `--dry-run` verifies auth safely. Consecutive push failures are counted in the git-ignored `.local/github-sync-failcount`; at 3+ the script prints a loud ALERT banner (likely token expiry) and any success resets the counter — don't re-swallow that banner.

---
name: Long test runs via temp console workflow
description: How to run test suites that exceed the bash tool's 2-minute cap
---

The bash tool hard-caps at 2 minutes, and backgrounded (`&`/nohup) processes die when the call returns. The full portal vitest suite (~3-4 min) and the self-booting Playwright `test:e2e` runner both exceed the cap.

**How to apply:** configure a temporary console workflow whose command redirects output to a /tmp log and appends an EXIT_CODE marker, then sleeps to stay alive, e.g.
`cd artifacts/portal && npx vitest run > /tmp/vt.log 2>&1; echo EXIT_CODE=$? >> /tmp/vt.log; sleep 3600`
Restart it, then poll with `sleep 115; tail /tmp/vt.log` bash calls until the EXIT_CODE line appears. Remove the workflow and the log when done.

**Why:** synchronous per-call runs can't fit, and refresh_all_logs previews truncate; the log file + exit marker is the only reliable completion signal.

Also: `vitest --reporter=line` is invalid (vitest tries to import a package named "line" and crashes); use the default reporter or `--reporter=basic`.

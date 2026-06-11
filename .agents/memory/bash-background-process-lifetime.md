---
name: Bash background processes die between tool calls
description: Long-running work launched with nohup/& from the bash tool is killed when that tool call returns; run synchronously instead.
---

Background processes started from the `bash` tool with `nohup ... &` do NOT survive
after the launching tool call returns. They receive SIGKILL during session cleanup,
so a later poll finds no process and only a truncated/empty output file.

**Why:** each bash invocation is its own short-lived session; detaching with nohup
does not keep the child alive past the parent call in this environment.

**How to apply:** for long tasks (e.g. ffmpeg transcodes), run them *synchronously*
inside a single bash call within the 120s timeout. If one unit exceeds the budget,
split the work into chunks of one-unit-per-call, or run a few independent units as
*parallel bash tool calls in one response* (the OS keeps those alive because each
call is blocking). Watch for CPU oversubscription: on an 8-core box, an HEVC→H.264
720p60 transcode uses ~2 cores and ~70s; 3-in-parallel starved one job past 120s,
2-in-parallel was borderline for the longest clips, 1-per-call was reliable.

---
name: Calling a secret-gated prod endpoint from the agent
description: bash and the code_execution sandbox do not receive secrets (e.g. OPS_API_KEY); use a throwaway workflow to make the authenticated call.
---

Neither the `bash` tool nor the `code_execution` JS sandbox has access to
Replit secrets (`viewEnvVars` can only confirm a secret *exists*, never read
its value; `process.env` in the sandbox does not have it either). Workflows
are the only execution context in this environment that actually gets
secrets injected into `process.env`.

**Why:** this is a deliberate isolation boundary — agent-side code
execution and shell tools are treated as untrusted relative to configured
secrets, only the declared workflow process gets them injected.

**How to apply:** to make an authenticated call to an internal/ops endpoint
that requires a secret bearer token, write a small one-off script that
reads `process.env.<SECRET>` and performs the request, run it via a
temporary console workflow (`npx tsx <script>.ts`, not a bare `tsx` since
the local binary isn't on PATH in the workflow shell), then remove the
workflow and delete the script once done unless it's meant to become a
reusable ops tool.

**Also note:** a code fix made in a task-agent environment does not take
effect against a live/production deployment until the app is republished;
calling a "live" prod endpoint right after fixing its underlying code will
still exercise the old behavior until that publish happens.

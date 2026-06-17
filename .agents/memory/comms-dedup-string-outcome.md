---
name: comms-dedup string outcome contract
description: checkAndRecordSend returns a string outcome, not a boolean; mocking it as boolean silently suppresses every scheduled send.
---
`checkAndRecordSend(sendKey, channel)` (artifacts/api-server/src/lib/comms-dedup.ts) returns a string `SendRecordOutcome`: `"recorded"` (first time, proceed), `"duplicate"` (skip), `"error"` (dedup store broken). In scheduled-comms it is wrapped by `reserveSend`, which proceeds ONLY when `outcome === "recorded"`.

**Why:** the contract was deliberately migrated off a boolean so a broken `comms_send_log` table ("error") surfaces loudly instead of silently suppressing emails. A test that mocks `checkAndRecordSend` to return `true`/`false` makes `reserveSend` always fall through to `false` (since `true !== "recorded"`), so NO sends are queued — the test then trivially "passes" any zero-send assertion and gives false confidence.

**How to apply:** when mocking `../lib/comms-dedup` in any scheduled-comms test, return `"recorded"`/`"duplicate"` strings, never booleans. Mirror the existing pattern in scheduled-comms-coaching-content-sms-prefs.test.ts.

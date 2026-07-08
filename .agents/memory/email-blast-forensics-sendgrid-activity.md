---
name: Email-blast forensics via SendGrid Activity API
description: How to forensically verify a transactional-email test blast (dedupe, delivery, timing) using SendGrid's Email Activity API, and how to separate it from real production traffic to the same inbox.
---

## The technique

SendGrid's `/v3/messages` search endpoint (`?query=to_email%3D%22...%22&limit=...`) returns a
per-message log (subject, status, timestamps, opens/clicks) that is the authoritative record of
what actually left the system — independent of whatever a sending script's own console output or
DB tables claim happened. Use it to verify a blast after the fact, not just trust the script's
self-reported manifest.

**Isolating one run from noise:** a single scripted blast run lands in a tight time window (all
messages within a few seconds of each other, since sends are typically fired in a loop). Filter
`last_event_time` to that window to isolate the run's own messages from:
- earlier failed/partial attempts at the same blast (also visible in the log, useful for the
  forensics comparison)
- real, unrelated production traffic to the same inbox if that inbox belongs to a real admin/staff
  account (e.g. new-member-registered notifications, coaching-call reminders, login alerts) that
  fire on their own schedule and will co-mingle with any test send made to that address.

**Detecting a double-send bug:** group the older/failed batch by subject line. A legitimate one-
send-per-type blast has each subject appear once; a batch with most/all distinct subjects appearing
exactly 2x (while a few unrelated real-system subjects appear at irregular counts like 3x, 4x, 17x)
is strong evidence of a duplicate-fire bug in the sending script, distinguishable from organic
repeat production emails by the uniform 2x pattern across intentionally-once-per-blast templates.

## Pre-flight asset-check pattern

Before firing a real blast, monkeypatch the mail-send function (e.g. `sgMail.send`) to intercept
and capture the fully-rendered HTML for every planned send without actually dispatching it. Extract
every unique `<img src="...">` from the captured HTML and `fetch()`-check each one for a 200
response before proceeding to the real send pass. This catches broken/relative/localhost asset
URLs (the actual root cause of a prior failed blast) before they reach a real inbox, and is cheap
to run since it reuses the exact same template-rendering path the real send will use.

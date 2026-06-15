---
name: Per-category SMS preferences
description: How finer-grained (non-master) SMS opt-outs are enforced
---
Members have a master `users.sms_opt_in` plus finer-grained per-category flags (first one: `ticket_reply_sms_opt_in`, default true).

**Why:** members wanted to keep security/billing texts but silence the text on every support reply, without opting out of SMS entirely.

**How to apply:** the category gate lives in the CALLER that queues the SMS (e.g. `sendTicketReplyNotification` in `artifacts/api-server/src/routes/tickets.ts` checks `smsOptIn && ticketReplySmsOptIn && phone`). `CommunicationService.queueSms` / `sendSmsDirect` is channel-generic — it only re-checks the master `smsOptIn`, NOT category flags — so the caller is the sole enforcement point for a category. Email always sends regardless. To add a new category: schema bool col (default true) + expose on MemberProfile + PatchMemberProfileBody/Response in openapi.yaml (regen codegen) + persist in onboarding.ts PATCH /members/me/profile + gate the relevant caller + add the toggle in portal Account.tsx.

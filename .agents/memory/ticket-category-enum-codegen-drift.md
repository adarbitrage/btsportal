---
name: Ticket category enum codegen drift
description: Regenerating api-zod/client from openapi.yaml silently drops ticket categories that were only ever hand-added to the generated files.
---

The OpenAPI category enums (Ticket + CreateTicket schemas in lib/api-spec/openapi.yaml)
historically listed only [billing, technical, training, account, other], but the app
actually uses two more categories created server-side:
- compliance_review (Compliance Review form)
- concierge_task (Concierge VA form)

These had been hand-added to the generated lib/api-zod files WITHOUT updating the spec.
Running `pnpm --filter @workspace/api-spec run codegen` (orval, clean:true) reverts that
drift and drops them — which breaks runtime Zod parsing: GET /tickets .parse() can throw
on members with compliance tickets, and POST /tickets with category compliance_review/
concierge_task fails CreateTicketBody validation (400).

**Why:** orval regen is authoritative from openapi.yaml; any enum value must live in the
spec, never only in the generated output.

**How to apply:** before regenerating ticket-related codegen, confirm both enums in
openapi.yaml include every category string used in artifacts/api-server/src/routes/tickets.ts
(grep `category: "`). Currently: billing, technical, training, account, other,
compliance_review, concierge_task.

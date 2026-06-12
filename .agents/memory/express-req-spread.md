---
name: Express req spread loses headers
description: Spreading an Express Request object into a plain object drops non-enumerable properties like headers and ip.
---

# Express Request spread loses non-enumerable properties

## The rule
Never spread an Express `Request` object to override fields (`{ ...req, userId: x }`). The result is a plain object that is missing non-enumerable properties — critically `headers` and `ip`, which audit-log helpers read.

**Why:** Express adds `headers`, `ip`, and similar properties as non-enumerable descriptors on the request prototype chain. The spread operator only copies own enumerable properties, so the spread result silently loses them. The code typechecks fine but fails at runtime with `TypeError: Cannot read properties of undefined (reading 'x-forwarded-for')`.

**How to apply:** When you need to log an action attributed to a *different* user than `req.userId` (e.g., in the impersonation stop endpoint where you want to attribute the audit event to the restored admin, not the impersonated member), call `logAuditEvent` directly with explicit actor fields rather than passing a faked request to `logAdminAction`:

```ts
// WRONG — spreads req, loses headers/ip
await logAdminAction(
  { ...req, userId: adminUser.id, userEmail: adminUser.email } as Request,
  "impersonate_stop", ...
);

// CORRECT — keep original req for IP/UA; override actor fields explicitly
await logAuditEvent({
  actorId: adminUser.id,
  actorEmail: adminUser.email,
  actionType: "impersonate_stop",
  entityType: "user",
  entityId: String(impersonatedUserId),
  description: "Admin stopped impersonation",
  req,   // original Express request — headers/ip intact
});
```

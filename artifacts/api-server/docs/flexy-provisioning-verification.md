# Flexy install/uninstall verification against live GoHighLevel

The Flexy provisioning code in `src/lib/flexy-provision.ts` and
`src/lib/ghl-agency-client.ts` cannot be exercised by the automated test suite
without creating real records in the agency at `getflexy.app`. This runbook is
the documented manual + scripted check that catches regressions in:

- the agency JWT client and OAuth token mint
- snapshot loading on sub-account creation
- idempotent re-attach on reinstall (no duplicate sub-accounts)
- non-destructive uninstall (sub-account preserved, staff access removed)
- password rotation against the agency

It should be run before any release that touches the files under
"Relevant code" below, plus once per quarter as a smoke test.

## Relevant code

- `artifacts/api-server/src/lib/flexy-provision.ts`
- `artifacts/api-server/src/lib/ghl-agency-client.ts`
- `artifacts/api-server/src/routes/apps.ts`
- `artifacts/api-server/src/scripts/verify-flexy-provisioning.ts`

## Prerequisites

You need:

1. A **dedicated test BTS member** in whichever environment you are
   targeting (a real prod member is fine — the run is non-destructive — but
   prefer a sandbox/staging member). Note their `users.id`. Their email
   address will receive **two** GHL activation emails over the course of the
   run (one per install). Use a member you control or warn them first.
2. The four GHL agency env vars set in your shell:
   - `GHL_CHERRINGTON_AGENCY_JWT` — base64 of `{apiKey, companyId, ...}`
   - `GHL_CHERRINGTON_CLIENT_ID`
   - `GHL_CHERRINGTON_CLIENT_SECRET`
   - `GHL_FLEXY_SNAPSHOT_ID`
3. `DATABASE_URL` pointing at the same database the API server uses (so the
   script can read/write `member_app_instances`).
4. Browser access to the agency dashboard at `https://app.gohighlevel.com/`
   (or the white-labeled equivalent) so you can do the UI confirmation.

## Run the scripted check

From the repo root:

```bash
VERIFY_USER_ID=<bts_user_id> \
GHL_CHERRINGTON_AGENCY_JWT=... \
GHL_CHERRINGTON_CLIENT_ID=... \
GHL_CHERRINGTON_CLIENT_SECRET=... \
GHL_FLEXY_SNAPSHOT_ID=... \
DATABASE_URL=postgres://... \
  pnpm --filter @workspace/api-server verify:flexy
```

The script runs five steps in order:

1. **Install** — calls `provisionFlexyForUser`, then asserts the agency has
   exactly one sub-account named `Flexy - {member name}`, that the persisted
   `providerLocationId` matches it, and that the staff user exists with
   admin role and the correct `locationIds`.
2. **Reveal** — calls `revealFlexyCredentials` and confirms the email
   returned matches the member's email.
3. **Password rotation primitive** — generates a throwaway password and
   calls `updateStaffUserPassword`, then re-fetches the staff user to
   confirm role and `locationIds` are still correct. (There is no member-
   facing `/apps/flexy/regenerate` endpoint today; we exercise the
   underlying GHL primitive so future regressions are caught regardless.
   Skip with `SKIP_PASSWORD_ROTATION=1` if you don't want to rotate the
   password on this run.)
4. **Uninstall** — calls `disableFlexyForUser`, then asserts the
   sub-account is preserved (non-destructive policy) and the staff user
   either no longer has access to the location or was fully deleted (when
   it was their only location).
5. **Reinstall** — calls `provisionFlexyForUser` again and confirms the
   reused sub-account has the same `providerLocationId` (no duplicate
   sub-account was created), the staff user is re-attached with the
   correct role, and there is **still exactly one** `Flexy - {member name}`
   sub-account in the agency.

By default the script ends with a final uninstall so reruns start from a
known state. Pass `KEEP_INSTALLED=1` to leave the member installed for UI
inspection.

A clean run prints a single `[Verify] PASS — N assertions OK` line. Any
failed assertion exits non-zero with the failing line at the bottom of the
output.

## Manual UI confirmation

After the scripted check passes, log in to the GHL agency dashboard and
confirm the following by eye. (The script asserts the same things over the
API; this exists to catch the case where the API agrees with itself but the
agency UI is still showing something stale.)

1. **Sub-accounts list.** Filter by name `Flexy - {member name}`.
   - Exactly **one** result.
   - Its name is exactly `Flexy - {member name}` (no trailing whitespace,
     no duplicate suffix).
   - Its snapshot column shows the snapshot id you configured in
     `GHL_FLEXY_SNAPSHOT_ID` (or the snapshot's display name).
2. **Staff users list at agency level.** Search by the member's email.
   - Exactly **one** result.
   - Role column shows `Admin` (or `Account Admin`).
   - Locations column shows the sub-account from step 1 — and only that
     sub-account, unless this member is also on other agency locations
     for unrelated reasons.
3. **Member's mailbox.** Confirm they received a "Welcome to GoHighLevel"
   activation email after each install. (One after the initial install,
   plus one after the reinstall **only if** the previous uninstall fully
   deleted their staff record. Re-attach reinstalls do not trigger a new
   activation email.)

If any of those three checks disagrees with the script output, file a bug
referencing this runbook and the failing assertion.

## What this run does NOT cover

- The portal-side rendering of the Flexy card (covered by the existing
  end-to-end UI test suite).
- The `/apps/flexy/sso-redirect` admin URL — there is no automated way to
  validate it without a real browser session against `dashboard.getflexy.app`.
  Click "Open Flexy" in the portal as a sanity check after the script passes.
- Concurrent install/uninstall by the same user (the API serializes via row
  locks, but this is not exercised here).

## Troubleshooting

- **`Flexy agency token rejected by GHL — refresh GHL_CHERRINGTON_AGENCY_JWT apiKey`**
  The cached agency `apiKey` has expired. Re-extract it from the agency
  dashboard and re-set the env var.
- **`GHL_FLEXY_SNAPSHOT_ID is not configured`**
  The snapshot env var is missing — the script will not create any GHL
  records until it is set, so reruns are safe.
- **Reinstall created a duplicate sub-account.** This is the single most
  important regression this script catches. The cause is almost always
  either (a) `provisionFlexyForUser` losing the persisted
  `providerLocationId` before deciding to create a new location, or (b) the
  uninstall path clearing `providerLocationId` (it must not — uninstall is
  non-destructive). Read the test's failing assertion carefully and start
  from there.

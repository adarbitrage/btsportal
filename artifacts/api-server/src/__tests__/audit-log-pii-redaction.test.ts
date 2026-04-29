import { describe, it, expect } from "vitest";
import {
  REDACTED_RECIPIENT,
  redactAuditRowPii,
  redactQueueFallbackPii,
} from "../lib/audit-log";

type AuditRowShape = {
  id: number;
  actionType: string | null;
  entityType: string;
  description: string | null;
  metadata: unknown;
  changeDiff?: unknown;
};

function makeQueueFallbackRow(overrides: Partial<AuditRowShape> = {}): AuditRowShape {
  return {
    id: 42,
    actionType: "queue_fallback",
    entityType: "communication",
    description: "Email queue unavailable — direct-send fallback to user@example.com",
    metadata: {
      channel: "email",
      recipient: "user@example.com",
      reason: "queue_unavailable",
    },
    ...overrides,
  };
}

describe("redactAuditRowPii (queue_fallback)", () => {
  it("strips the recipient email from the description and metadata for queue_fallback rows", () => {
    const row = makeQueueFallbackRow();

    const redacted = redactAuditRowPii(row);

    // Description has the email scrubbed.
    expect(redacted.description).toBe(
      `Email queue unavailable — direct-send fallback to ${REDACTED_RECIPIENT}`,
    );
    expect(redacted.description).not.toContain("user@example.com");

    // Metadata loses the recipient key entirely so the UI's
    // `metadata.recipient || "redacted"` fallback kicks in, but the
    // non-PII fields (channel, reason) survive so admins can still
    // count and filter the events.
    expect(redacted.metadata).toEqual({
      channel: "email",
      reason: "queue_unavailable",
    });
    const meta = redacted.metadata as Record<string, unknown>;
    expect("recipient" in meta).toBe(false);

    // Other fields are unchanged.
    expect(redacted.id).toBe(42);
    expect(redacted.actionType).toBe("queue_fallback");
    expect(redacted.entityType).toBe("communication");
  });

  it("strips the recipient phone number from SMS queue_fallback rows", () => {
    const row = makeQueueFallbackRow({
      description: "SMS queue unavailable — direct-send fallback to +15551234567",
      metadata: {
        channel: "sms",
        recipient: "+15551234567",
        reason: "queue_unavailable",
      },
    });

    const redacted = redactAuditRowPii(row);

    expect(redacted.description).toBe(
      `SMS queue unavailable — direct-send fallback to ${REDACTED_RECIPIENT}`,
    );
    expect(redacted.description).not.toContain("+15551234567");
    expect(redacted.metadata).toEqual({
      channel: "sms",
      reason: "queue_unavailable",
    });
  });

  it("does not mutate the input row (returns a new object)", () => {
    const row = makeQueueFallbackRow();
    const originalDescription = row.description;
    const originalMetadata = row.metadata;

    const redacted = redactAuditRowPii(row);

    // Input must be untouched so callers reusing the row (e.g. logging
    // it elsewhere) still see the real data.
    expect(redacted).not.toBe(row);
    expect(row.description).toBe(originalDescription);
    expect(row.metadata).toBe(originalMetadata);
    expect(row.metadata).toEqual({
      channel: "email",
      recipient: "user@example.com",
      reason: "queue_unavailable",
    });
  });

  it("returns the row unchanged for action types that don't carry member PII", () => {
    // `update_setting` is not in the PII-bearing allow-list, so even if a
    // caller stuffs a recipient-shaped key into metadata the redactor
    // should leave the row alone.
    const row: AuditRowShape = {
      id: 1,
      actionType: "update_setting",
      entityType: "system_setting",
      description: "Updated setting: alerts.oncall_email",
      metadata: { recipient: "ignored@example.test", source: "admin_panel" },
    };

    const result = redactAuditRowPii(row);

    expect(result).toBe(row);
    expect(result.description).toBe("Updated setting: alerts.oncall_email");
    expect(result.metadata).toEqual({
      recipient: "ignored@example.test",
      source: "admin_panel",
    });
  });

  it("handles queue_fallback rows with missing or malformed metadata gracefully", () => {
    const nullMetaRow = makeQueueFallbackRow({ metadata: null, description: "Email queue unavailable — direct-send fallback to redacted" });
    const nullMetaResult = redactAuditRowPii(nullMetaRow);
    expect(nullMetaResult.metadata).toBeNull();
    expect(nullMetaResult.description).toBe("Email queue unavailable — direct-send fallback to redacted");

    const arrayMetaRow = makeQueueFallbackRow({ metadata: ["nope"], description: null });
    const arrayMetaResult = redactAuditRowPii(arrayMetaRow);
    // Arrays aren't valid metadata for queue_fallback, but we still must
    // not crash — the redaction is a no-op in that case.
    expect(arrayMetaResult.metadata).toEqual(["nope"]);
    expect(arrayMetaResult.description).toBeNull();

    const noRecipientRow = makeQueueFallbackRow({
      metadata: { channel: "email", reason: "queue_unavailable" },
      description: "Email queue unavailable — direct-send fallback to redacted",
    });
    const noRecipientResult = redactAuditRowPii(noRecipientRow);
    expect(noRecipientResult.metadata).toEqual({
      channel: "email",
      reason: "queue_unavailable",
    });
  });

  it("exposes the legacy redactQueueFallbackPii alias so old call sites keep working", () => {
    expect(redactQueueFallbackPii).toBe(redactAuditRowPii);
  });
});

describe("redactAuditRowPii (member-action rows)", () => {
  it("scrubs the member's name and email from impersonate_start descriptions and changeDiff", () => {
    const row: AuditRowShape = {
      id: 100,
      actionType: "impersonate_start",
      entityType: "user",
      description: "Admin started impersonating member Jane Doe (jane@example.com)",
      metadata: null,
      changeDiff: { memberName: "Jane Doe", memberEmail: "jane@example.com" },
    };

    const redacted = redactAuditRowPii(row);

    // Both the email AND the name are gone from the visible description.
    expect(redacted.description).toBe(
      `Admin started impersonating member ${REDACTED_RECIPIENT} (${REDACTED_RECIPIENT})`,
    );
    expect(redacted.description as string).not.toContain("Jane Doe");
    expect(redacted.description as string).not.toContain("jane@example.com");

    // PII keys are stripped from changeDiff so the expanded row doesn't
    // leak them either.
    expect(redacted.changeDiff).toEqual({});
    const diff = redacted.changeDiff as Record<string, unknown>;
    expect("memberName" in diff).toBe(false);
    expect("memberEmail" in diff).toBe(false);
  });

  it("scrubs the member's email from regenerate_password rows but keeps non-PII diff fields", () => {
    const row: AuditRowShape = {
      id: 101,
      actionType: "regenerate_password",
      entityType: "flexy_credentials",
      description: "Regenerated Flexy password for member jane@example.com",
      metadata: null,
      changeDiff: { memberId: 42, memberEmail: "jane@example.com" },
    };

    const redacted = redactAuditRowPii(row);

    expect(redacted.description).toBe(
      `Regenerated Flexy password for member ${REDACTED_RECIPIENT}`,
    );
    expect(redacted.description as string).not.toContain("jane@example.com");

    // memberId is non-PII (just a foreign key) so it stays put for
    // filtering / linking purposes.
    expect(redacted.changeDiff).toEqual({ memberId: 42 });
  });

  it("scrubs both the member email and the previous pending email from cancel_email_change rows", () => {
    const row: AuditRowShape = {
      id: 102,
      actionType: "cancel_email_change",
      entityType: "user",
      description:
        "Cancelled pending email change for member jane@example.com (was: new-jane@example.com)",
      metadata: null,
      changeDiff: {
        before: { pendingEmail: "new-jane@example.com" },
        after: { pendingEmail: null },
        memberEmail: "jane@example.com",
        previousPendingEmail: "new-jane@example.com",
      },
    };

    const redacted = redactAuditRowPii(row);

    expect(redacted.description).toBe(
      `Cancelled pending email change for member ${REDACTED_RECIPIENT} (was: ${REDACTED_RECIPIENT})`,
    );
    expect(redacted.description as string).not.toContain("jane@example.com");
    expect(redacted.description as string).not.toContain("new-jane@example.com");

    // The redactor walks recursively, so the nested before/after blobs
    // must also have `pendingEmail` stripped — otherwise the email leaks
    // through `changeDiff.before.pendingEmail` even though the description
    // is redacted. The empty objects are kept so a UI can still tell that
    // a transition happened (something existed before and was cleared
    // after); only the PII value is removed.
    expect(redacted.changeDiff).toEqual({
      before: {},
      after: {},
    });

    // Belt-and-suspenders: assert the email strings appear NOWHERE in the
    // serialised payload returned to the caller. This is the actual
    // security guarantee — no path through any field should leak it.
    const serialised = JSON.stringify(redacted);
    expect(serialised).not.toContain("jane@example.com");
    expect(serialised).not.toContain("new-jane@example.com");
  });

  it("scrubs the member email from unlock_account rows", () => {
    const row: AuditRowShape = {
      id: 103,
      actionType: "unlock_account",
      entityType: "user",
      description:
        "Unlocked account for member jane@example.com (cleared lockedUntil and failedLoginCount)",
      metadata: null,
      changeDiff: {
        before: { lockedUntil: "2026-01-01T00:00:00Z", failedLoginCount: 5 },
        after: { lockedUntil: null, failedLoginCount: 0 },
        memberEmail: "jane@example.com",
      },
    };

    const redacted = redactAuditRowPii(row);

    expect(redacted.description).toBe(
      `Unlocked account for member ${REDACTED_RECIPIENT} (cleared lockedUntil and failedLoginCount)`,
    );
    expect(redacted.description as string).not.toContain("jane@example.com");
    const diff = redacted.changeDiff as Record<string, unknown>;
    expect("memberEmail" in diff).toBe(false);
  });

  it("redacts legacy rows by description template even when changeDiff/metadata are missing", () => {
    // Critical: rows written BEFORE the structured-field plumbing existed
    // have no memberName / memberEmail keys on changeDiff. Redaction must
    // still scrub the description for them — the per-action-type rewriter
    // is anchored on the known template, so it works without any
    // structured fields.
    const row: AuditRowShape = {
      id: 104,
      actionType: "impersonate_start",
      entityType: "user",
      description: "Admin started impersonating member Jane Doe (jane@example.com)",
      metadata: null,
      changeDiff: null,
    };

    const redacted = redactAuditRowPii(row);

    expect(redacted.description).toBe(
      `Admin started impersonating member ${REDACTED_RECIPIENT} (${REDACTED_RECIPIENT})`,
    );
    expect(redacted.description as string).not.toContain("Jane Doe");
    expect(redacted.description as string).not.toContain("jane@example.com");
    expect(redacted.changeDiff).toBeNull();
  });

  it("redacts legacy queue_fallback rows whose description has the recipient but metadata does not", () => {
    const row: AuditRowShape = {
      id: 107,
      actionType: "queue_fallback",
      entityType: "communication",
      description: "Email queue unavailable — direct-send fallback to legacy@example.com",
      metadata: null,
    };

    const redacted = redactAuditRowPii(row);

    expect(redacted.description).toBe(
      `Email queue unavailable — direct-send fallback to ${REDACTED_RECIPIENT}`,
    );
    expect(redacted.description as string).not.toContain("legacy@example.com");
  });

  it("redacts legacy notify_password / cancel_email_change / unlock_account rows by template", () => {
    // Same defense for the other PII-bearing action types — verify each
    // template is recognised even when structured fields are missing.
    const cases: Array<{ row: AuditRowShape; expected: string; mustNotContain: string[] }> = [
      {
        row: {
          id: 200,
          actionType: "notify_password",
          entityType: "flexy_credentials",
          description: "Sent new Flexy password to member jane@example.com via email=sent, sms=skipped(no_phone)",
          metadata: null,
        },
        expected: `Sent new Flexy password to member ${REDACTED_RECIPIENT} via email=sent, sms=skipped(no_phone)`,
        mustNotContain: ["jane@example.com"],
      },
      {
        row: {
          id: 201,
          actionType: "cancel_email_change",
          entityType: "user",
          description: "Cancelled pending email change for member jane@example.com (was: new-jane@example.com)",
          metadata: null,
        },
        expected: `Cancelled pending email change for member ${REDACTED_RECIPIENT} (was: ${REDACTED_RECIPIENT})`,
        mustNotContain: ["jane@example.com", "new-jane@example.com"],
      },
      {
        row: {
          id: 202,
          actionType: "unlock_account",
          entityType: "user",
          description: "Unlocked account for member jane@example.com (cleared lockedUntil and failedLoginCount)",
          metadata: null,
        },
        expected: `Unlocked account for member ${REDACTED_RECIPIENT} (cleared lockedUntil and failedLoginCount)`,
        mustNotContain: ["jane@example.com"],
      },
      {
        row: {
          id: 203,
          actionType: "regenerate_password",
          entityType: "flexy_credentials",
          description: "Regenerated Flexy password for member jane@example.com",
          metadata: null,
        },
        expected: `Regenerated Flexy password for member ${REDACTED_RECIPIENT}`,
        mustNotContain: ["jane@example.com"],
      },
    ];

    for (const c of cases) {
      const redacted = redactAuditRowPii(c.row);
      expect(redacted.description).toBe(c.expected);
      for (const value of c.mustNotContain) {
        expect(redacted.description as string).not.toContain(value);
      }
    }
  });

  it("is idempotent: redacting an already-redacted description is a no-op", () => {
    const row: AuditRowShape = {
      id: 204,
      actionType: "impersonate_start",
      entityType: "user",
      description: `Admin started impersonating member ${REDACTED_RECIPIENT} (${REDACTED_RECIPIENT})`,
      metadata: null,
      changeDiff: null,
    };

    const once = redactAuditRowPii(row);
    const twice = redactAuditRowPii(once);
    expect(twice.description).toBe(once.description);
    expect(twice.description).toBe(
      `Admin started impersonating member ${REDACTED_RECIPIENT} (${REDACTED_RECIPIENT})`,
    );
  });

  it("handles values that contain regex metacharacters without throwing", () => {
    // Phone numbers in particular include `+` and digits; emails can include
    // `+`, `.`, etc. We use split/join (not regex) so the redactor must
    // tolerate any string value verbatim.
    const row: AuditRowShape = {
      id: 105,
      actionType: "impersonate_start",
      entityType: "user",
      description: "Admin started impersonating member A.B+C (a.b+c@example.com)",
      metadata: null,
      changeDiff: { memberName: "A.B+C", memberEmail: "a.b+c@example.com" },
    };

    const redacted = redactAuditRowPii(row);

    expect(redacted.description).toBe(
      `Admin started impersonating member ${REDACTED_RECIPIENT} (${REDACTED_RECIPIENT})`,
    );
  });

  it("redacts PII surfaced via metadata as well as changeDiff", () => {
    // The redactor checks both columns so future call sites that pick
    // metadata over changeDiff (or vice versa) keep working.
    const row: AuditRowShape = {
      id: 106,
      actionType: "regenerate_password",
      entityType: "flexy_credentials",
      description: "Regenerated Flexy password for member jane@example.com",
      metadata: { memberEmail: "jane@example.com", source: "admin_panel" },
      changeDiff: { memberId: 42 },
    };

    const redacted = redactAuditRowPii(row);

    expect(redacted.description).toBe(
      `Regenerated Flexy password for member ${REDACTED_RECIPIENT}`,
    );
    expect(redacted.metadata).toEqual({ source: "admin_panel" });
    expect(redacted.changeDiff).toEqual({ memberId: 42 });
  });
});

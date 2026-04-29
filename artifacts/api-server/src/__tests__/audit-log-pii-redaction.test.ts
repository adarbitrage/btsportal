import { describe, it, expect } from "vitest";
import { REDACTED_RECIPIENT, redactQueueFallbackPii } from "../lib/audit-log";

type AuditRowShape = {
  id: number;
  actionType: string | null;
  entityType: string;
  description: string | null;
  metadata: unknown;
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

describe("redactQueueFallbackPii", () => {
  it("strips the recipient email from the description and metadata for queue_fallback rows", () => {
    const row = makeQueueFallbackRow();

    const redacted = redactQueueFallbackPii(row);

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

    const redacted = redactQueueFallbackPii(row);

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

    const redacted = redactQueueFallbackPii(row);

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

  it("returns the row unchanged for non-queue_fallback action types", () => {
    const row: AuditRowShape = {
      id: 1,
      actionType: "regenerate_password",
      entityType: "user",
      description: "Regenerated password for member user@example.com",
      metadata: { recipient: "user@example.com", source: "admin_panel" },
    };

    const result = redactQueueFallbackPii(row);

    // We only redact queue_fallback rows; other action types are out of
    // scope for this helper and are returned by reference.
    expect(result).toBe(row);
    expect(result.description).toBe("Regenerated password for member user@example.com");
    expect(result.metadata).toEqual({
      recipient: "user@example.com",
      source: "admin_panel",
    });
  });

  it("handles queue_fallback rows with missing or malformed metadata gracefully", () => {
    const nullMetaRow = makeQueueFallbackRow({ metadata: null, description: "Email queue unavailable — direct-send fallback to redacted" });
    const nullMetaResult = redactQueueFallbackPii(nullMetaRow);
    expect(nullMetaResult.metadata).toBeNull();
    expect(nullMetaResult.description).toBe("Email queue unavailable — direct-send fallback to redacted");

    const arrayMetaRow = makeQueueFallbackRow({ metadata: ["nope"], description: null });
    const arrayMetaResult = redactQueueFallbackPii(arrayMetaRow);
    // Arrays aren't valid metadata for queue_fallback, but we still must
    // not crash — the redaction is a no-op in that case.
    expect(arrayMetaResult.metadata).toEqual(["nope"]);
    expect(arrayMetaResult.description).toBeNull();

    const noRecipientRow = makeQueueFallbackRow({
      metadata: { channel: "email", reason: "queue_unavailable" },
      description: "Email queue unavailable — direct-send fallback to redacted",
    });
    const noRecipientResult = redactQueueFallbackPii(noRecipientRow);
    expect(noRecipientResult.metadata).toEqual({
      channel: "email",
      reason: "queue_unavailable",
    });
  });
});

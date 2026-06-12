import { getParam } from "../lib/params";
import { Router, type Request, type Response } from "express";
import {
  db,
  emailTemplatesTable,
  emailTemplateVersionsTable,
  smsTemplatesTable,
  communicationLogTable,
  emailBouncesTable,
  emailUnsubscribesTable,
  sequencesTable,
  sequenceStepsTable,
  sequenceEnrollmentsTable,
  broadcastsTable,
  usersTable,
  userProductsTable,
  productsTable,
  auditLogTable,
} from "@workspace/db";
import { eq, sql, desc, asc, and, or, ilike, count, gte, lte, inArray } from "drizzle-orm";
import { hasPermission, requirePermission } from "../middleware/rbac";
import { logAdminAction, redactAuditRowPii } from "../lib/audit-log";
import {
  TEMPLATE_AUDIT_ACTION_TYPES,
  EMAIL_TEMPLATE_ENTITY_TYPE,
  SMS_TEMPLATE_ENTITY_TYPE,
  TEMPLATE_CREATE_ACTION_TYPE,
  TEMPLATE_UPDATE_ACTION_TYPE,
  TEMPLATE_DELETE_ACTION_TYPE,
  EMAIL_TEMPLATE_DIFF_FIELDS,
  SMS_TEMPLATE_DIFF_FIELDS,
  diffTemplateFields,
  snapshotTemplateForDiff,
} from "../lib/template-audit";
import { csvEscape } from "../lib/csv";
import { CommunicationService } from "../lib/communication-service";
import {
  QUEUE_FALLBACK_ACTION_TYPE,
  QUEUE_FALLBACK_ENTITY_TYPE,
} from "../lib/queue-fallback-tracker";
import {
  getStarterEmailTemplate,
  listStarterEmailTemplateSlugs,
  templateContentHash,
} from "../lib/seed-templates";

/**
 * How far before/after a communication-log row's createdAt we look for audit
 * rows that may have affected the send. queue_fallback always fires moments
 * before the comms_log row is written, but we widen the window to a couple
 * of minutes so reasonable clock skew between the two writes (or a slow
 * direct-send round-trip) doesn't drop the link. Capped on both sides so an
 * unrelated fallback that happened minutes earlier for a different send to
 * the same recipient doesn't bleed into the wrong comms-log entry.
 */
const RELATED_AUDIT_WINDOW_MS = 2 * 60 * 1000;
/**
 * How far BEFORE the comms-log row we look for template-edit audit rows. We
 * want to catch "admin tweaked the template a few minutes / hours ago and
 * the next batch went out wrong", which is a meaningfully wider window than
 * the queue-fallback ±2 minutes — fallback rows are written milliseconds
 * before the send by the same call stack, while template edits happen
 * arbitrarily earlier on a different request. 24h is the sweet spot: long
 * enough to catch same-day investigations without flooding the dialog with
 * unrelated edits from prior days.
 */
const RELATED_TEMPLATE_AUDIT_WINDOW_BEFORE_MS = 24 * 60 * 60 * 1000;
/**
 * Symmetric small grace window AFTER the send for template edits, so a
 * concurrent edit that lands a couple of seconds after the comms-log row
 * isn't dropped. Kept tiny — anything bigger and we'd start linking edits
 * that obviously couldn't have affected the send.
 */
const RELATED_TEMPLATE_AUDIT_WINDOW_AFTER_MS = 2 * 60 * 1000;
/**
 * Hard cap on related-audit rows surfaced in the comms-log detail dialog.
 * The dialog shows them inline (not paginated); the audit log page itself is
 * one click away if an admin needs the full picture.
 */
const RELATED_AUDIT_LIMIT = 10;

const router = Router();

const STARTER_SLUG_SET = new Set(listStarterEmailTemplateSlugs());

/**
 * Add UI-facing flags about whether the row is still tracking the starter
 * copy. `editedFromDefault` is `true` when an admin has saved over the
 * starter copy (the PUT route clears `starterHash` in that case);
 * `hasStarterDefault` is `true` when there is a starter copy on file we can
 * restore on demand.
 */
function enrichEmailTemplate<T extends { slug: string; starterHash: string | null }>(t: T) {
  return {
    ...t,
    hasStarterDefault: STARTER_SLUG_SET.has(t.slug),
    editedFromDefault: STARTER_SLUG_SET.has(t.slug) && t.starterHash === null,
  };
}

router.get("/admin/communications/email-templates", requirePermission("communications:view"), async (_req: Request, res: Response) => {
  try {
    const templates = await db.select().from(emailTemplatesTable).orderBy(asc(emailTemplatesTable.name));
    res.json(templates.map(enrichEmailTemplate));
  } catch (error) {
    console.error("[Admin] Error listing email templates:", error);
    res.status(500).json({ error: "Failed to list email templates" });
  }
});

router.get("/admin/communications/email-templates/:id", requirePermission("communications:view"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [template] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
    if (!template) { res.status(404).json({ error: "Template not found" }); return; }
    res.json(enrichEmailTemplate(template));
  } catch (error) {
    console.error("[Admin] Error getting email template:", error);
    res.status(500).json({ error: "Failed to get email template" });
  }
});

router.post("/admin/communications/email-templates", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const { slug, name, subject, htmlBody, textBody, category, fromName, variables } = req.body;
    if (!slug || !name || !subject || !htmlBody || !textBody) {
      res.status(400).json({ error: "slug, name, subject, htmlBody, and textBody are required" });
      return;
    }
    const [template] = await db.insert(emailTemplatesTable).values({
      slug, name, subject, htmlBody, textBody,
      category: category || "transactional",
      fromName: fromName || null,
      variables: variables || [],
      // Admin-created template: by definition not tracking starter copy.
      starterHash: null,
    }).returning();
    await logAdminAction(
      req,
      TEMPLATE_CREATE_ACTION_TYPE,
      EMAIL_TEMPLATE_ENTITY_TYPE,
      String(template.id),
      `Created email template "${template.name}" (${template.slug})`,
      { after: snapshotTemplateForDiff(template, EMAIL_TEMPLATE_DIFF_FIELDS) },
      { templateSlug: template.slug, templateName: template.name, channel: "email" },
    );
    res.status(201).json(enrichEmailTemplate(template));
  } catch (error: any) {
    if (error?.code === "23505") {
      res.status(409).json({ error: "Template slug already exists" });
      return;
    }
    console.error("[Admin] Error creating email template:", error);
    res.status(500).json({ error: "Failed to create email template" });
  }
});

router.put("/admin/communications/email-templates/:id", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [existing] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Template not found" }); return; }

    const versions = await db.select().from(emailTemplateVersionsTable)
      .where(eq(emailTemplateVersionsTable.templateId, id))
      .orderBy(desc(emailTemplateVersionsTable.version));
    const nextVersion = versions.length > 0 ? versions[0].version + 1 : 1;

    await db.insert(emailTemplateVersionsTable).values({
      templateId: id,
      version: nextVersion,
      slug: existing.slug,
      name: existing.name,
      subject: existing.subject,
      htmlBody: existing.htmlBody,
      textBody: existing.textBody,
      category: existing.category,
      fromName: existing.fromName,
      variables: existing.variables,
      savedBy: req.userId,
    });

    if (versions.length >= 10) {
      const toDelete = versions.slice(9).map(v => v.id);
      if (toDelete.length > 0) {
        await db.delete(emailTemplateVersionsTable).where(inArray(emailTemplateVersionsTable.id, toDelete));
      }
    }

    const { name, subject, htmlBody, textBody, category, fromName, variables, active } = req.body;
    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (subject !== undefined) updates.subject = subject;
    if (htmlBody !== undefined) updates.htmlBody = htmlBody;
    if (textBody !== undefined) updates.textBody = textBody;
    if (category !== undefined) updates.category = category;
    if (fromName !== undefined) updates.fromName = fromName;
    if (variables !== undefined) updates.variables = variables;
    if (active !== undefined) updates.active = active;

    // Mark this row as customized so the startup seed routine
    // (`ensureRequiredEmailTemplates`) never silently overwrites the admin's
    // copy with the latest starter content. Admins can re-apply starter copy
    // explicitly via the "restore-default" endpoint below.
    const touchesContent = ["name", "subject", "htmlBody", "textBody"].some(k => k in updates);
    if (touchesContent) {
      updates.starterHash = null;
    }

    const [updated] = await db.update(emailTemplatesTable).set(updates).where(eq(emailTemplatesTable.id, id)).returning();
    const diff = diffTemplateFields(existing as Record<string, unknown>, updates, EMAIL_TEMPLATE_DIFF_FIELDS);
    if (diff.changedFields.length > 0) {
      await logAdminAction(
        req,
        TEMPLATE_UPDATE_ACTION_TYPE,
        EMAIL_TEMPLATE_ENTITY_TYPE,
        String(updated.id),
        `Updated email template "${updated.name}" (${updated.slug}): ${diff.changedFields.join(", ")}`,
        { before: diff.before, after: diff.after, changedFields: diff.changedFields },
        { templateSlug: updated.slug, templateName: updated.name, channel: "email" },
      );
    }
    res.json(enrichEmailTemplate(updated));
  } catch (error) {
    console.error("[Admin] Error updating email template:", error);
    res.status(500).json({ error: "Failed to update email template" });
  }
});

router.delete("/admin/communications/email-templates/:id", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [deleted] = await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Template not found" }); return; }
    await logAdminAction(
      req,
      TEMPLATE_DELETE_ACTION_TYPE,
      EMAIL_TEMPLATE_ENTITY_TYPE,
      String(deleted.id),
      `Deleted email template "${deleted.name}" (${deleted.slug})`,
      { before: snapshotTemplateForDiff(deleted, EMAIL_TEMPLATE_DIFF_FIELDS) },
      { templateSlug: deleted.slug, templateName: deleted.name, channel: "email" },
    );
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error deleting email template:", error);
    res.status(500).json({ error: "Failed to delete email template" });
  }
});

router.get("/admin/communications/email-templates/:id/versions", requirePermission("communications:view"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const versions = await db.select().from(emailTemplateVersionsTable)
      .where(eq(emailTemplateVersionsTable.templateId, id))
      .orderBy(desc(emailTemplateVersionsTable.version));
    res.json(versions);
  } catch (error) {
    console.error("[Admin] Error listing template versions:", error);
    res.status(500).json({ error: "Failed to list template versions" });
  }
});

router.post("/admin/communications/email-templates/:id/restore/:versionId", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    const versionId = parseInt(getParam(req.params.versionId), 10);
    if (isNaN(id) || isNaN(versionId)) { res.status(400).json({ error: "Invalid IDs" }); return; }

    const [version] = await db.select().from(emailTemplateVersionsTable)
      .where(and(eq(emailTemplateVersionsTable.id, versionId), eq(emailTemplateVersionsTable.templateId, id)));
    if (!version) { res.status(404).json({ error: "Version not found" }); return; }

    // Snapshot the live row BEFORE we overwrite it so the diff captures
    // what the restore actually changed. Without this we'd be diffing the
    // restored values against themselves and producing an empty audit row.
    const [beforeRestore] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));

    const [updated] = await db.update(emailTemplatesTable).set({
      name: version.name,
      subject: version.subject,
      htmlBody: version.htmlBody,
      textBody: version.textBody,
      category: version.category,
      fromName: version.fromName,
      variables: version.variables,
      // Restoring an admin-saved version is itself a customization — keep the
      // row marked as such so the startup seed routine doesn't immediately
      // overwrite it with the latest starter copy.
      starterHash: null,
    }).where(eq(emailTemplatesTable.id, id)).returning();

    if (beforeRestore) {
      const diff = diffTemplateFields(
        beforeRestore as Record<string, unknown>,
        updated as Record<string, unknown>,
        EMAIL_TEMPLATE_DIFF_FIELDS,
      );
      if (diff.changedFields.length > 0) {
        await logAdminAction(
          req,
          TEMPLATE_UPDATE_ACTION_TYPE,
          EMAIL_TEMPLATE_ENTITY_TYPE,
          String(updated.id),
          `Restored email template "${updated.name}" (${updated.slug}) from version ${version.version}: ${diff.changedFields.join(", ")}`,
          {
            before: diff.before,
            after: diff.after,
            changedFields: diff.changedFields,
            source: "restore_version",
            restoredVersion: version.version,
          },
          { templateSlug: updated.slug, templateName: updated.name, channel: "email" },
        );
      }
    }

    res.json(enrichEmailTemplate(updated));
  } catch (error) {
    console.error("[Admin] Error restoring template version:", error);
    res.status(500).json({ error: "Failed to restore template version" });
  }
});

/**
 * Re-apply the starter copy from `seed-templates.ts` for this template's slug.
 * Snapshots the current row to the version history first so admins can roll
 * back if they didn't mean to. Returns 400 if no starter copy exists for the
 * slug (e.g. the template was created in the admin UI from scratch).
 */
router.post("/admin/communications/email-templates/:id/restore-default", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [existing] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Template not found" }); return; }

    const starter = getStarterEmailTemplate(existing.slug);
    if (!starter) {
      res.status(400).json({
        error: "No starter copy is available for this template — it was not part of the original seeded set.",
      });
      return;
    }

    const versions = await db.select().from(emailTemplateVersionsTable)
      .where(eq(emailTemplateVersionsTable.templateId, id))
      .orderBy(desc(emailTemplateVersionsTable.version));
    const nextVersion = versions.length > 0 ? versions[0].version + 1 : 1;

    await db.insert(emailTemplateVersionsTable).values({
      templateId: id,
      version: nextVersion,
      slug: existing.slug,
      name: existing.name,
      subject: existing.subject,
      htmlBody: existing.htmlBody,
      textBody: existing.textBody,
      category: existing.category,
      fromName: existing.fromName,
      variables: existing.variables,
      savedBy: req.userId,
    });

    if (versions.length >= 10) {
      const toDelete = versions.slice(9).map(v => v.id);
      if (toDelete.length > 0) {
        await db.delete(emailTemplateVersionsTable).where(inArray(emailTemplateVersionsTable.id, toDelete));
      }
    }

    const [updated] = await db.update(emailTemplatesTable).set({
      name: starter.name,
      subject: starter.subject,
      htmlBody: starter.htmlBody,
      textBody: starter.textBody,
      category: starter.category,
      variables: starter.variables,
      starterHash: templateContentHash(starter),
    }).where(eq(emailTemplatesTable.id, id)).returning();

    const diff = diffTemplateFields(
      existing as Record<string, unknown>,
      updated as Record<string, unknown>,
      EMAIL_TEMPLATE_DIFF_FIELDS,
    );
    if (diff.changedFields.length > 0) {
      await logAdminAction(
        req,
        TEMPLATE_UPDATE_ACTION_TYPE,
        EMAIL_TEMPLATE_ENTITY_TYPE,
        String(updated.id),
        `Restored email template "${updated.name}" (${updated.slug}) to starter default: ${diff.changedFields.join(", ")}`,
        {
          before: diff.before,
          after: diff.after,
          changedFields: diff.changedFields,
          source: "restore_default",
        },
        { templateSlug: updated.slug, templateName: updated.name, channel: "email" },
      );
    }

    res.json(enrichEmailTemplate(updated));
  } catch (error) {
    console.error("[Admin] Error restoring starter copy:", error);
    res.status(500).json({ error: "Failed to restore starter copy" });
  }
});

router.post("/admin/communications/email-templates/:id/preview", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [template] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
    if (!template) { res.status(404).json({ error: "Template not found" }); return; }

    const sampleData: Record<string, string> = {
      member_name: "John Doe",
      temp_password: "TempPass123",
      portal_url: "https://portal.buildtestscale.com",
      support_email: "support@buildtestscale.com",
      current_year: new Date().getFullYear().toString(),
      product_name: "BTS 6-Month Mentorship",
      expiration_date: "March 31, 2026",
      call_title: "Weekly Q&A: Ask Anything",
      reset_token: "sample-reset-token",
      verify_token: "sample-verify-token",
      code: "123456",
      ticket_number: "BTS-100234",
      ...(req.body.sampleData || {}),
    };

    let renderedHtml = template.htmlBody;
    let renderedSubject = template.subject;
    let renderedText = template.textBody;

    for (const [key, value] of Object.entries(sampleData)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
      renderedHtml = renderedHtml.replace(regex, value);
      renderedSubject = renderedSubject.replace(regex, value);
      renderedText = renderedText.replace(regex, value);
    }

    res.json({ subject: renderedSubject, htmlBody: renderedHtml, textBody: renderedText, variables: template.variables });
  } catch (error) {
    console.error("[Admin] Error previewing email template:", error);
    res.status(500).json({ error: "Failed to preview template" });
  }
});

router.get("/admin/communications/sms-templates", requirePermission("communications:view"), async (_req: Request, res: Response) => {
  try {
    const templates = await db.select().from(smsTemplatesTable).orderBy(asc(smsTemplatesTable.name));
    res.json(templates);
  } catch (error) {
    console.error("[Admin] Error listing SMS templates:", error);
    res.status(500).json({ error: "Failed to list SMS templates" });
  }
});

router.post("/admin/communications/sms-templates", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const { slug, name, body, variables } = req.body;
    if (!slug || !name || !body) {
      res.status(400).json({ error: "slug, name, and body are required" });
      return;
    }
    const [template] = await db.insert(smsTemplatesTable).values({
      slug, name, body, variables: variables || [],
    }).returning();
    await logAdminAction(
      req,
      TEMPLATE_CREATE_ACTION_TYPE,
      SMS_TEMPLATE_ENTITY_TYPE,
      String(template.id),
      `Created SMS template "${template.name}" (${template.slug})`,
      { after: snapshotTemplateForDiff(template, SMS_TEMPLATE_DIFF_FIELDS) },
      { templateSlug: template.slug, templateName: template.name, channel: "sms" },
    );
    res.status(201).json(template);
  } catch (error: any) {
    if (error?.code === "23505") {
      res.status(409).json({ error: "Template slug already exists" });
      return;
    }
    console.error("[Admin] Error creating SMS template:", error);
    res.status(500).json({ error: "Failed to create SMS template" });
  }
});

router.put("/admin/communications/sms-templates/:id", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    // Snapshot current row so we can diff against the post-update copy. The
    // 404 here also stays well-defined: if the row doesn't exist before the
    // update, we don't even attempt the update / audit write.
    const [existing] = await db.select().from(smsTemplatesTable).where(eq(smsTemplatesTable.id, id));
    if (!existing) { res.status(404).json({ error: "Template not found" }); return; }

    const { name, body, variables, active } = req.body;
    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (body !== undefined) updates.body = body;
    if (variables !== undefined) updates.variables = variables;
    if (active !== undefined) updates.active = active;

    const [updated] = await db.update(smsTemplatesTable).set(updates).where(eq(smsTemplatesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Template not found" }); return; }

    const diff = diffTemplateFields(existing as Record<string, unknown>, updates, SMS_TEMPLATE_DIFF_FIELDS);
    if (diff.changedFields.length > 0) {
      await logAdminAction(
        req,
        TEMPLATE_UPDATE_ACTION_TYPE,
        SMS_TEMPLATE_ENTITY_TYPE,
        String(updated.id),
        `Updated SMS template "${updated.name}" (${updated.slug}): ${diff.changedFields.join(", ")}`,
        { before: diff.before, after: diff.after, changedFields: diff.changedFields },
        { templateSlug: updated.slug, templateName: updated.name, channel: "sms" },
      );
    }

    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error updating SMS template:", error);
    res.status(500).json({ error: "Failed to update SMS template" });
  }
});

router.delete("/admin/communications/sms-templates/:id", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [deleted] = await db.delete(smsTemplatesTable).where(eq(smsTemplatesTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Template not found" }); return; }
    await logAdminAction(
      req,
      TEMPLATE_DELETE_ACTION_TYPE,
      SMS_TEMPLATE_ENTITY_TYPE,
      String(deleted.id),
      `Deleted SMS template "${deleted.name}" (${deleted.slug})`,
      { before: snapshotTemplateForDiff(deleted, SMS_TEMPLATE_DIFF_FIELDS) },
      { templateSlug: deleted.slug, templateName: deleted.name, channel: "sms" },
    );
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error deleting SMS template:", error);
    res.status(500).json({ error: "Failed to delete SMS template" });
  }
});

// The `sequences` table tracks on/off via an `active` boolean, but the admin
// UI speaks in a `status` string ("active" | "paused"). Map between the two so
// the schema stays the single source of truth while the client contract holds.
function withSequenceStatus<T extends { active: boolean }>(seq: T): T & { status: string } {
  return { ...seq, status: seq.active ? "active" : "paused" };
}

// The schema stores a step's template reference under `templateRef`; the admin
// UI reads it as `templateSlug`. Expose the alias so existing steps render.
function withStepAliases<T extends { templateRef: string; stepOrder: number }>(step: T): T & { templateSlug: string; sortOrder: number } {
  return { ...step, templateSlug: step.templateRef, sortOrder: step.stepOrder };
}

// `sequences.slug` is NOT NULL + UNIQUE with no default, but the create form
// only collects a name. Derive a URL-safe slug and disambiguate collisions so
// inserts never fail on the unique constraint.
async function generateUniqueSequenceSlug(name: string): Promise<string> {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "sequence";
  let candidate = base;
  let suffix = 1;
  // Bounded loop: append -2, -3, ... until the slug is free.
  while (true) {
    const [existing] = await db.select({ id: sequencesTable.id })
      .from(sequencesTable)
      .where(eq(sequencesTable.slug, candidate));
    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

router.get("/admin/communications/sequences", requirePermission("communications:view"), async (_req: Request, res: Response) => {
  try {
    const sequences = await db.select().from(sequencesTable).orderBy(desc(sequencesTable.createdAt));

    const result = [];
    for (const seq of sequences) {
      const [stepCount] = await db.select({ count: count() }).from(sequenceStepsTable)
        .where(eq(sequenceStepsTable.sequenceId, seq.id));
      const [enrollmentCount] = await db.select({ count: count() }).from(sequenceEnrollmentsTable)
        .where(and(eq(sequenceEnrollmentsTable.sequenceId, seq.id), eq(sequenceEnrollmentsTable.status, "active")));
      result.push({
        ...withSequenceStatus(seq),
        stepCount: stepCount?.count ?? 0,
        activeEnrollments: enrollmentCount?.count ?? 0,
      });
    }
    res.json(result);
  } catch (error) {
    console.error("[Admin] Error listing sequences:", error);
    res.status(500).json({ error: "Failed to list sequences" });
  }
});

router.post("/admin/communications/sequences", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const { name, description, triggerEvent } = req.body;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const slug = await generateUniqueSequenceSlug(name);
    const [sequence] = await db.insert(sequencesTable).values({
      slug, name, description, triggerEvent: triggerEvent || "",
    }).returning();
    res.status(201).json(withSequenceStatus(sequence));
  } catch (error) {
    console.error("[Admin] Error creating sequence:", error);
    res.status(500).json({ error: "Failed to create sequence" });
  }
});

router.get("/admin/communications/sequences/:id", requirePermission("communications:view"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [sequence] = await db.select().from(sequencesTable).where(eq(sequencesTable.id, id));
    if (!sequence) { res.status(404).json({ error: "Sequence not found" }); return; }

    const steps = await db.select().from(sequenceStepsTable)
      .where(eq(sequenceStepsTable.sequenceId, id))
      .orderBy(asc(sequenceStepsTable.stepOrder));

    const enrollments = await db.select({
      enrollment: sequenceEnrollmentsTable,
      userName: usersTable.name,
      userEmail: usersTable.email,
    }).from(sequenceEnrollmentsTable)
      .leftJoin(usersTable, eq(sequenceEnrollmentsTable.userId, usersTable.id))
      .where(eq(sequenceEnrollmentsTable.sequenceId, id))
      .orderBy(desc(sequenceEnrollmentsTable.enrolledAt));

    res.json({ ...withSequenceStatus(sequence), steps: steps.map(withStepAliases), enrollments });
  } catch (error) {
    console.error("[Admin] Error getting sequence:", error);
    res.status(500).json({ error: "Failed to get sequence" });
  }
});

router.put("/admin/communications/sequences/:id", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const { name, description, triggerEvent, status } = req.body;
    const updates: Partial<typeof sequencesTable.$inferInsert> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (triggerEvent !== undefined) updates.triggerEvent = triggerEvent;
    if (status !== undefined) updates.active = status === "active";

    const [updated] = await db.update(sequencesTable).set(updates).where(eq(sequencesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Sequence not found" }); return; }
    res.json(withSequenceStatus(updated));
  } catch (error) {
    console.error("[Admin] Error updating sequence:", error);
    res.status(500).json({ error: "Failed to update sequence" });
  }
});

router.delete("/admin/communications/sequences/:id", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [deleted] = await db.delete(sequencesTable).where(eq(sequencesTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Sequence not found" }); return; }
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error deleting sequence:", error);
    res.status(500).json({ error: "Failed to delete sequence" });
  }
});

router.post("/admin/communications/sequences/:id/steps", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const sequenceId = parseInt(getParam(req.params.id), 10);
    if (isNaN(sequenceId)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const { channel, templateSlug, subject, delayMinutes, condition, sortOrder } = req.body;

    let order = sortOrder;
    if (order === undefined) {
      const [maxOrder] = await db.select({ max: sql<number>`COALESCE(MAX(${sequenceStepsTable.stepOrder}), -1)` })
        .from(sequenceStepsTable).where(eq(sequenceStepsTable.sequenceId, sequenceId));
      order = (maxOrder?.max ?? -1) + 1;
    }

    const [step] = await db.insert(sequenceStepsTable).values({
      sequenceId, channel: channel || "email",
      templateRef: templateSlug ?? "", subject,
      delayMinutes: delayMinutes || 0,
      conditions: condition, stepOrder: order,
    }).returning();
    res.status(201).json(withStepAliases(step));
  } catch (error) {
    console.error("[Admin] Error adding sequence step:", error);
    res.status(500).json({ error: "Failed to add sequence step" });
  }
});

router.put("/admin/communications/sequences/:id/steps/:stepId", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const sequenceId = parseInt(getParam(req.params.id), 10);
    const stepId = parseInt(getParam(req.params.stepId), 10);
    if (isNaN(sequenceId) || isNaN(stepId)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const { channel, templateSlug, subject, delayMinutes, condition, sortOrder } = req.body;
    const updates: Partial<typeof sequenceStepsTable.$inferInsert> = {};
    if (channel !== undefined) updates.channel = channel;
    if (templateSlug !== undefined) updates.templateRef = templateSlug;
    if (subject !== undefined) updates.subject = subject;
    if (delayMinutes !== undefined) updates.delayMinutes = delayMinutes;
    if (condition !== undefined) updates.conditions = condition;
    if (sortOrder !== undefined) updates.stepOrder = sortOrder;

    const [updated] = await db.update(sequenceStepsTable).set(updates)
      .where(and(eq(sequenceStepsTable.id, stepId), eq(sequenceStepsTable.sequenceId, sequenceId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Step not found" }); return; }
    res.json(withStepAliases(updated));
  } catch (error) {
    console.error("[Admin] Error updating sequence step:", error);
    res.status(500).json({ error: "Failed to update sequence step" });
  }
});

router.delete("/admin/communications/sequences/:id/steps/:stepId", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const sequenceId = parseInt(getParam(req.params.id), 10);
    const stepId = parseInt(getParam(req.params.stepId), 10);
    if (isNaN(sequenceId) || isNaN(stepId)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [deleted] = await db.delete(sequenceStepsTable)
      .where(and(eq(sequenceStepsTable.id, stepId), eq(sequenceStepsTable.sequenceId, sequenceId)))
      .returning();
    if (!deleted) { res.status(404).json({ error: "Step not found" }); return; }
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error deleting sequence step:", error);
    res.status(500).json({ error: "Failed to delete sequence step" });
  }
});

router.patch("/admin/communications/sequences/:id/steps/reorder", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders)) { res.status(400).json({ error: "orders must be an array" }); return; }
    for (const { id, sortOrder } of orders) {
      await db.update(sequenceStepsTable).set({ stepOrder: sortOrder }).where(eq(sequenceStepsTable.id, id));
    }
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error reordering steps:", error);
    res.status(500).json({ error: "Failed to reorder steps" });
  }
});

router.post("/admin/communications/sequences/:id/enroll", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const sequenceId = parseInt(getParam(req.params.id), 10);
    if (isNaN(sequenceId)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const { userId } = req.body;
    if (!userId) { res.status(400).json({ error: "userId is required" }); return; }

    const [existing] = await db.select().from(sequenceEnrollmentsTable)
      .where(and(
        eq(sequenceEnrollmentsTable.sequenceId, sequenceId),
        eq(sequenceEnrollmentsTable.userId, userId),
        eq(sequenceEnrollmentsTable.status, "active"),
      ));
    if (existing) { res.status(409).json({ error: "User already enrolled" }); return; }

    const [enrollment] = await db.insert(sequenceEnrollmentsTable).values({
      sequenceId, userId,
    }).returning();
    res.status(201).json(enrollment);
  } catch (error) {
    console.error("[Admin] Error enrolling user:", error);
    res.status(500).json({ error: "Failed to enroll user" });
  }
});

router.post("/admin/communications/sequences/:id/cancel-enrollment/:enrollmentId", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const sequenceId = parseInt(getParam(req.params.id), 10);
    const enrollmentId = parseInt(getParam(req.params.enrollmentId), 10);
    if (isNaN(sequenceId) || isNaN(enrollmentId)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [updated] = await db.update(sequenceEnrollmentsTable).set({
      status: "cancelled",
      cancelledAt: new Date(),
    }).where(and(eq(sequenceEnrollmentsTable.id, enrollmentId), eq(sequenceEnrollmentsTable.sequenceId, sequenceId))).returning();
    if (!updated) { res.status(404).json({ error: "Enrollment not found" }); return; }
    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error cancelling enrollment:", error);
    res.status(500).json({ error: "Failed to cancel enrollment" });
  }
});

router.patch("/admin/communications/sequences/:id/pause", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [updated] = await db.update(sequencesTable).set({ active: false }).where(eq(sequencesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Sequence not found" }); return; }
    res.json(withSequenceStatus(updated));
  } catch (error) {
    console.error("[Admin] Error pausing sequence:", error);
    res.status(500).json({ error: "Failed to pause sequence" });
  }
});

router.patch("/admin/communications/sequences/:id/resume", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [updated] = await db.update(sequencesTable).set({ active: true }).where(eq(sequencesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Sequence not found" }); return; }
    res.json(withSequenceStatus(updated));
  } catch (error) {
    console.error("[Admin] Error resuming sequence:", error);
    res.status(500).json({ error: "Failed to resume sequence" });
  }
});

async function evaluateSegmentFilter(filter: Record<string, unknown>): Promise<any[]> {
  const conditions: any[] = [];

  if (filter.products && Array.isArray(filter.products) && filter.products.length > 0) {
    const userIdsWithProducts = await db.select({ userId: userProductsTable.userId })
      .from(userProductsTable)
      .leftJoin(productsTable, eq(userProductsTable.productId, productsTable.id))
      .where(inArray(productsTable.slug, filter.products as string[]));
    const userIds = userIdsWithProducts.map(r => r.userId);
    if (userIds.length > 0) {
      conditions.push(inArray(usersTable.id, userIds));
    } else {
      return [];
    }
  }

  if (filter.experienceLevel && typeof filter.experienceLevel === "string") {
    conditions.push(eq(usersTable.experienceLevel, filter.experienceLevel));
  }

  if (filter.smsOptIn === true) {
    conditions.push(eq(usersTable.smsOptIn, true));
  }

  if (filter.registeredAfter && typeof filter.registeredAfter === "string") {
    conditions.push(gte(usersTable.memberSince, new Date(filter.registeredAfter)));
  }

  if (filter.registeredBefore && typeof filter.registeredBefore === "string") {
    conditions.push(lte(usersTable.memberSince, new Date(filter.registeredBefore)));
  }

  if (filter.lastLoginAfter && typeof filter.lastLoginAfter === "string") {
    conditions.push(gte(usersTable.lastLoginAt, new Date(filter.lastLoginAfter)));
  }

  if (filter.lastLoginBefore && typeof filter.lastLoginBefore === "string") {
    conditions.push(lte(usersTable.lastLoginAt, new Date(filter.lastLoginBefore)));
  }

  conditions.push(eq(usersTable.role, "member"));

  const query = conditions.length > 0
    ? db.select().from(usersTable).where(and(...conditions))
    : db.select().from(usersTable).where(eq(usersTable.role, "member"));

  return await query;
}

router.get("/admin/communications/broadcasts", requirePermission("communications:view"), async (_req: Request, res: Response) => {
  try {
    const broadcasts = await db.select().from(broadcastsTable).orderBy(desc(broadcastsTable.createdAt));
    res.json(broadcasts);
  } catch (error) {
    console.error("[Admin] Error listing broadcasts:", error);
    res.status(500).json({ error: "Failed to list broadcasts" });
  }
});

router.get("/admin/communications/broadcasts/:id", requirePermission("communications:view"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [broadcast] = await db.select().from(broadcastsTable).where(eq(broadcastsTable.id, id));
    if (!broadcast) { res.status(404).json({ error: "Broadcast not found" }); return; }
    res.json(broadcast);
  } catch (error) {
    console.error("[Admin] Error getting broadcast:", error);
    res.status(500).json({ error: "Failed to get broadcast" });
  }
});

router.post("/admin/communications/broadcasts", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const { name, channel, templateId, subject, htmlBody, textBody, smsBody, segmentFilter, scheduledAt } = req.body;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }

    const [broadcast] = await db.insert(broadcastsTable).values({
      name,
      channel: channel || "email",
      templateId: templateId || null,
      subject, htmlBody, textBody, smsBody,
      segmentFilter: segmentFilter || {},
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      createdBy: req.userId,
    }).returning();
    res.status(201).json(broadcast);
  } catch (error) {
    console.error("[Admin] Error creating broadcast:", error);
    res.status(500).json({ error: "Failed to create broadcast" });
  }
});

router.put("/admin/communications/broadcasts/:id", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [existing] = await db.select().from(broadcastsTable).where(eq(broadcastsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Broadcast not found" }); return; }
    if (existing.status !== "draft") { res.status(400).json({ error: "Can only edit draft broadcasts" }); return; }

    const { name, channel, templateId, subject, htmlBody, textBody, smsBody, segmentFilter, scheduledAt } = req.body;
    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (channel !== undefined) updates.channel = channel;
    if (templateId !== undefined) updates.templateId = templateId;
    if (subject !== undefined) updates.subject = subject;
    if (htmlBody !== undefined) updates.htmlBody = htmlBody;
    if (textBody !== undefined) updates.textBody = textBody;
    if (smsBody !== undefined) updates.smsBody = smsBody;
    if (segmentFilter !== undefined) updates.segmentFilter = segmentFilter;
    if (scheduledAt !== undefined) updates.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;

    const [updated] = await db.update(broadcastsTable).set(updates).where(eq(broadcastsTable.id, id)).returning();
    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error updating broadcast:", error);
    res.status(500).json({ error: "Failed to update broadcast" });
  }
});

router.delete("/admin/communications/broadcasts/:id", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [existing] = await db.select().from(broadcastsTable).where(eq(broadcastsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Broadcast not found" }); return; }
    if (existing.status !== "draft") { res.status(400).json({ error: "Can only delete draft broadcasts" }); return; }
    await db.delete(broadcastsTable).where(eq(broadcastsTable.id, id));
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error deleting broadcast:", error);
    res.status(500).json({ error: "Failed to delete broadcast" });
  }
});

router.post("/admin/communications/broadcasts/:id/preview", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [broadcast] = await db.select().from(broadcastsTable).where(eq(broadcastsTable.id, id));
    if (!broadcast) { res.status(404).json({ error: "Broadcast not found" }); return; }

    const filter = (broadcast.segmentFilter || {}) as Record<string, unknown>;
    const recipients = await evaluateSegmentFilter(filter);
    const sampleRecipients = recipients.slice(0, 5).map(u => ({
      id: u.id, name: u.name, email: u.email,
    }));

    res.json({
      estimatedCount: recipients.length,
      sampleRecipients,
    });
  } catch (error) {
    console.error("[Admin] Error previewing broadcast:", error);
    res.status(500).json({ error: "Failed to preview broadcast" });
  }
});

router.post("/admin/communications/broadcasts/:id/send", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [broadcast] = await db.select().from(broadcastsTable).where(eq(broadcastsTable.id, id));
    if (!broadcast) { res.status(404).json({ error: "Broadcast not found" }); return; }
    if (broadcast.status !== "draft") { res.status(400).json({ error: "Broadcast has already been sent or is sending" }); return; }

    const filter = (broadcast.segmentFilter || {}) as Record<string, unknown>;
    const recipients = await evaluateSegmentFilter(filter);

    if (recipients.length >= 100 && !req.body.confirmed) {
      res.json({
        requiresConfirmation: true,
        recipientCount: recipients.length,
        message: `This broadcast will be sent to ${recipients.length} recipients. Please confirm.`,
      });
      return;
    }

    const [updated] = await db.update(broadcastsTable).set({
      status: "sending",
      sentAt: new Date(),
      totalRecipients: recipients.length,
    }).where(eq(broadcastsTable.id, id)).returning();

    const BATCH_SIZE = parseInt(process.env.EMAIL_BATCH_SIZE || "50", 10);
    const BATCH_DELAY_MS = parseInt(process.env.EMAIL_BATCH_DELAY_MS || "1000", 10);
    let sentCount = 0;
    let failedCount = 0;

    if (broadcast.channel === "email" && broadcast.templateId) {
      const [template] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, broadcast.templateId));
      if (template) {
        const recipientList = recipients.map(user => ({
          email: user.email,
          userId: user.id,
          // portal_url is intentionally omitted here so the per-tenant
          // resolver inside CommunicationService.getCommonVariables wins.
          // The resolver sources system_settings → PORTAL_URL env → dev
          // default, so broadcast recipients see the same tenant-correct
          // portal URL as every other branded email.
          variables: { member_name: user.name },
        }));
        try {
          const result = await CommunicationService.queueBroadcastEmail({
            templateSlug: template.slug,
            recipientList,
          });
          sentCount = result.queued;
        } catch (err) {
          console.error("[Admin] Broadcast queue error:", err);
        }
      }
    } else {
      for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
        const batch = recipients.slice(i, i + BATCH_SIZE);
        const logEntries = batch.map(user => ({
          userId: user.id,
          channel: broadcast.channel,
          templateSlug: null as string | null,
          recipientEmail: broadcast.channel === "email" ? user.email : null,
          recipientPhone: broadcast.channel === "sms" ? user.phone : null,
          subject: broadcast.subject,
          status: "queued",
          category: "broadcast",
          broadcastId: broadcast.id,
          renderedHtml: broadcast.htmlBody,
          renderedText: broadcast.textBody || broadcast.smsBody,
        }));
        await db.insert(communicationLogTable).values(logEntries);

        for (const user of batch) {
          try {
            if (broadcast.channel === "email" && broadcast.htmlBody) {
              await CommunicationService.sendEmailDirect({
                to: user.email,
                subject: broadcast.subject || broadcast.name,
                html: broadcast.htmlBody,
                text: broadcast.textBody || "",
                category: "broadcast",
                userId: user.id,
                includeUnsubscribe: true,
              });
              sentCount++;
            } else if (broadcast.channel === "sms" && broadcast.smsBody && user.phone) {
              await CommunicationService.sendSmsDirect({
                to: user.phone,
                body: broadcast.smsBody,
                userId: user.id,
              });
              sentCount++;
            }
          } catch (err) {
            console.error(`[Admin] Failed to send broadcast to ${user.email}:`, err);
            failedCount++;
          }
        }

        if (i + BATCH_SIZE < recipients.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
      }
    }

    await db.update(broadcastsTable).set({
      status: "sent",
      sentCount,
      failedCount,
      completedAt: new Date(),
    }).where(eq(broadcastsTable.id, id));

    res.json({ success: true, recipientCount: recipients.length, sentCount, failedCount, broadcast: updated });
  } catch (error) {
    console.error("[Admin] Error sending broadcast:", error);
    res.status(500).json({ error: "Failed to send broadcast" });
  }
});

router.post("/admin/communications/broadcasts/:id/duplicate", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [source] = await db.select().from(broadcastsTable).where(eq(broadcastsTable.id, id));
    if (!source) { res.status(404).json({ error: "Broadcast not found" }); return; }

    const [duplicate] = await db.insert(broadcastsTable).values({
      name: `${source.name} (Copy)`,
      channel: source.channel,
      templateId: source.templateId,
      subject: source.subject,
      htmlBody: source.htmlBody,
      textBody: source.textBody,
      smsBody: source.smsBody,
      segmentFilter: source.segmentFilter,
      status: "draft",
      createdBy: req.userId,
    }).returning();
    res.status(201).json(duplicate);
  } catch (error) {
    console.error("[Admin] Error duplicating broadcast:", error);
    res.status(500).json({ error: "Failed to duplicate broadcast" });
  }
});

router.get("/admin/communications/log", requirePermission("communications:view"), async (req: Request, res: Response) => {
  try {
    const { channel, status, templateSlug, startDate, endDate, search, page = "1", limit = "50" } = req.query;
    const pageNum = parseInt(page as string, 10);
    const limitNum = Math.min(parseInt(limit as string, 10), 100);
    const offset = (pageNum - 1) * limitNum;

    const conditions: any[] = [];
    if (channel) conditions.push(eq(communicationLogTable.channel, channel as string));
    if (status) conditions.push(eq(communicationLogTable.status, status as string));
    if (templateSlug) conditions.push(eq(communicationLogTable.templateSlug, templateSlug as string));
    if (startDate) conditions.push(gte(communicationLogTable.createdAt, new Date(startDate as string)));
    if (endDate) conditions.push(lte(communicationLogTable.createdAt, new Date(endDate as string)));
    if (search) {
      conditions.push(or(
        ilike(communicationLogTable.recipientEmail, `%${search}%`),
        ilike(communicationLogTable.subject, `%${search}%`),
      ));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db.select({ count: count() }).from(communicationLogTable).where(whereClause);

    const logs = await db.select({
      log: communicationLogTable,
      userName: usersTable.name,
      userEmail: usersTable.email,
    }).from(communicationLogTable)
      .leftJoin(usersTable, eq(communicationLogTable.userId, usersTable.id))
      .where(whereClause)
      .orderBy(desc(communicationLogTable.createdAt))
      .limit(limitNum)
      .offset(offset);

    res.json({
      data: logs,
      total: totalResult?.count ?? 0,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil((totalResult?.count ?? 0) / limitNum),
    });
  } catch (error) {
    console.error("[Admin] Error listing communication log:", error);
    res.status(500).json({ error: "Failed to list communication log" });
  }
});

// Same permission gate as the read endpoint — anyone with communications:view
// can export the rows they can already browse. PII redaction is applied per
// row when the caller doesn't hold members:pii, mirroring the audit-log
// export semantics so the same admin can't pull recipient addresses out via
// the comms-log just because the audit-log export hides them.
const COMMS_LOG_EXPORT_BATCH_SIZE = 1000;
const DEFAULT_COMMS_LOG_EXPORT_HARD_CAP = 1_000_000;
function resolveCommsLogExportHardCap(): number {
  const raw = process.env.COMMS_LOG_EXPORT_HARD_CAP;
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return DEFAULT_COMMS_LOG_EXPORT_HARD_CAP;
}

// Microsecond-precision keyset cursor for the comms-log export. Same shape
// and rationale as the audit-log exporter — JS Dates would silently drop
// sub-millisecond components, so we read createdAt as a microsecond ISO
// string straight from Postgres and feed it back as the next batch's anchor.
type CommsLogExportCursor = { ts: string; id: number };

// Mask a recipient when the caller can't see PII. Keeps the local-part's
// first character and the domain visible (`a***@example.com`) so the row is
// still useful for matching against an audit-log entry / SendGrid bounce
// without leaking the full address. Phone numbers are reduced to the last
// four digits. Mirrors the spirit of `redactAuditRowPii` for the audit log
// export.
function maskCommsLogRecipient(value: string | null, kind: "email" | "phone"): string | null {
  if (!value) return value;
  if (kind === "email") {
    const at = value.indexOf("@");
    if (at <= 0) return "[redacted]";
    const local = value.slice(0, at);
    const domain = value.slice(at);
    const head = local.charAt(0);
    return `${head}${"*".repeat(Math.max(2, local.length - 1))}${domain}`;
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return "[redacted]";
  return `***${digits.slice(-4)}`;
}

router.get("/admin/communications/log/export", requirePermission("communications:view"), async (req: Request, res: Response) => {
  const { channel, status, templateSlug, startDate, endDate, search, format = "csv" } = req.query;
  const conditions: any[] = [];
  if (channel && typeof channel === "string") conditions.push(eq(communicationLogTable.channel, channel));
  if (status && typeof status === "string") conditions.push(eq(communicationLogTable.status, status));
  if (templateSlug && typeof templateSlug === "string") conditions.push(eq(communicationLogTable.templateSlug, templateSlug));
  if (startDate && typeof startDate === "string") conditions.push(gte(communicationLogTable.createdAt, new Date(startDate)));
  if (endDate && typeof endDate === "string") conditions.push(lte(communicationLogTable.createdAt, new Date(endDate)));
  if (search && typeof search === "string") {
    conditions.push(or(
      ilike(communicationLogTable.recipientEmail, `%${search}%`),
      ilike(communicationLogTable.subject, `%${search}%`),
    ));
  }
  const baseWhere = conditions.length > 0 ? and(...conditions) : undefined;
  const hardCap = resolveCommsLogExportHardCap();

  try {
    const canSeePii = hasPermission(req.adminRole, "members:pii");

    // Walk the (created_at, id) keyset in chunks and stream chunks to the
    // client. We deliberately do NOT issue an upfront `count(*)` so a
    // multi-million-row comms_log doesn't pay the COUNT cost on every
    // export. Trailers carry the final returned count + a truncation flag
    // so well-behaved clients can confirm completeness; browsers that
    // ignore trailers still get a correct (or correctly-truncated) body.
    res.setHeader("Trailer", "X-Comms-Log-Returned-Count, X-Comms-Log-Truncated");

    const exposed = [
      "Content-Disposition",
      "Trailer",
      "X-Comms-Log-Returned-Count",
      "X-Comms-Log-Truncated",
    ];
    const existingExposed = res.getHeader("Access-Control-Expose-Headers");
    const existingList = typeof existingExposed === "string"
      ? existingExposed.split(",").map(s => s.trim()).filter(Boolean)
      : [];
    const merged = Array.from(new Set([...existingList, ...exposed]));
    res.setHeader("Access-Control-Expose-Headers", merged.join(", "));

    const isJson = format === "json";
    if (isJson) {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", "attachment; filename=communications-log.json");
      res.write("[");
    } else {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=communications-log.csv");
      res.write(
        "id,channel,status,template_slug,category,recipient_email,recipient_phone,subject,from_email,user_name,delivered_at,opened_at,clicked_at,bounced_at,bounce_type,error_message,created_at\n",
      );
    }

    let cursor: CommsLogExportCursor | null = null;
    let firstRow = true;
    let aborted = false;
    let written = 0;
    let truncated = false;
    res.on("close", () => {
      if (!res.writableEnded) aborted = true;
    });

    const cursorTsExpr = sql<string>`to_char(${communicationLogTable.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

    while (!aborted && written < hardCap) {
      const remaining = hardCap - written;
      const batchSize = Math.min(COMMS_LOG_EXPORT_BATCH_SIZE, remaining);
      const isFinalBatch = remaining <= COMMS_LOG_EXPORT_BATCH_SIZE;
      const fetchSize = isFinalBatch ? batchSize + 1 : batchSize;

      const cursorClause = cursor
        ? sql`(${communicationLogTable.createdAt} < ${cursor.ts}::timestamptz OR (${communicationLogTable.createdAt} = ${cursor.ts}::timestamptz AND ${communicationLogTable.id} < ${cursor.id}))`
        : undefined;
      const whereClause = baseWhere && cursorClause
        ? and(baseWhere, cursorClause)
        : (cursorClause ?? baseWhere);

      type ExportRow = {
        id: number;
        channel: string;
        status: string;
        templateSlug: string | null;
        category: string | null;
        recipientEmail: string | null;
        recipientPhone: string | null;
        subject: string | null;
        fromEmail: string | null;
        userName: string | null;
        deliveredAt: Date | null;
        openedAt: Date | null;
        clickedAt: Date | null;
        bouncedAt: Date | null;
        bounceType: string | null;
        errorMessage: string | null;
        createdAt: Date;
        cursorTs: string;
      };

      const rows: ExportRow[] = await db
        .select({
          id: communicationLogTable.id,
          channel: communicationLogTable.channel,
          status: communicationLogTable.status,
          templateSlug: communicationLogTable.templateSlug,
          category: communicationLogTable.category,
          recipientEmail: communicationLogTable.recipientEmail,
          recipientPhone: communicationLogTable.recipientPhone,
          subject: communicationLogTable.subject,
          fromEmail: communicationLogTable.fromEmail,
          userName: usersTable.name,
          deliveredAt: communicationLogTable.deliveredAt,
          openedAt: communicationLogTable.openedAt,
          clickedAt: communicationLogTable.clickedAt,
          bouncedAt: communicationLogTable.bouncedAt,
          bounceType: communicationLogTable.bounceType,
          errorMessage: communicationLogTable.errorMessage,
          createdAt: communicationLogTable.createdAt,
          cursorTs: cursorTsExpr,
        })
        .from(communicationLogTable)
        .leftJoin(usersTable, eq(communicationLogTable.userId, usersTable.id))
        .where(whereClause)
        .orderBy(desc(communicationLogTable.createdAt), desc(communicationLogTable.id))
        .limit(fetchSize);

      if (rows.length === 0) break;

      const writeCount = Math.min(rows.length, batchSize);
      if (isFinalBatch && rows.length > batchSize) truncated = true;

      for (let i = 0; i < writeCount; i++) {
        const { cursorTs: _omit, ...raw } = rows[i];
        const recipientEmail = canSeePii
          ? raw.recipientEmail
          : maskCommsLogRecipient(raw.recipientEmail, "email");
        const recipientPhone = canSeePii
          ? raw.recipientPhone
          : maskCommsLogRecipient(raw.recipientPhone, "phone");
        const userName = canSeePii ? raw.userName : null;
        const row = { ...raw, recipientEmail, recipientPhone, userName };

        if (isJson) {
          res.write(firstRow ? JSON.stringify(row) : "," + JSON.stringify(row));
        } else {
          const line = [
            row.id,
            row.channel,
            row.status,
            row.templateSlug,
            row.category,
            row.recipientEmail,
            row.recipientPhone,
            row.subject,
            row.fromEmail,
            row.userName,
            row.deliveredAt,
            row.openedAt,
            row.clickedAt,
            row.bouncedAt,
            row.bounceType,
            row.errorMessage,
            row.createdAt,
          ].map(csvEscape).join(",");
          res.write(firstRow ? line : "\n" + line);
        }
        firstRow = false;
        written++;
      }

      const lastWritten = rows[writeCount - 1];
      cursor = { ts: lastWritten.cursorTs, id: lastWritten.id };

      if (rows.length < fetchSize) break;
      if (truncated || written >= hardCap) break;
    }

    if (isJson) res.write("]");
    if (!aborted) {
      const trailers: Record<string, string> = {
        "X-Comms-Log-Returned-Count": String(written),
      };
      if (truncated) trailers["X-Comms-Log-Truncated"] = "true";
      res.addTrailers(trailers);
      // Best-effort audit trail so we know who pulled the export and how
      // wide it was. Kept after `addTrailers` so a logging hiccup can't
      // truncate the response. Filters live in the description string so
      // the audit row stays self-contained without a bespoke schema.
      try {
        const filterParts: string[] = [];
        if (channel) filterParts.push(`channel=${channel}`);
        if (status) filterParts.push(`status=${status}`);
        if (templateSlug) filterParts.push(`templateSlug=${templateSlug}`);
        if (startDate) filterParts.push(`startDate=${startDate}`);
        if (endDate) filterParts.push(`endDate=${endDate}`);
        if (search) filterParts.push(`search=*`);
        const filterSummary = filterParts.length > 0 ? ` (${filterParts.join(", ")})` : "";
        await logAdminAction(
          req,
          "export_data",
          "communication",
          undefined,
          `Exported ${written} communication log row${written === 1 ? "" : "s"} as ${isJson ? "JSON" : "CSV"}${truncated ? " (truncated)" : ""}${filterSummary}`,
        );
      } catch (auditErr) {
        console.error("[Admin] Failed to write comms-log export audit row:", auditErr);
      }
    }
    res.end();
  } catch (error) {
    console.error("[Admin] Comms log export error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to export communication log" });
    } else {
      res.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  }
});

router.get("/admin/communications/log/:id", requirePermission("communications:view"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [entry] = await db.select({
      log: communicationLogTable,
      userName: usersTable.name,
      userEmail: usersTable.email,
    }).from(communicationLogTable)
      .leftJoin(usersTable, eq(communicationLogTable.userId, usersTable.id))
      .where(eq(communicationLogTable.id, id));

    if (!entry) { res.status(404).json({ error: "Log entry not found" }); return; }

    const relatedAudit = await fetchRelatedAuditRows(req, entry.log);
    res.json({ ...entry, relatedAudit });
  } catch (error) {
    console.error("[Admin] Error getting communication log entry:", error);
    res.status(500).json({ error: "Failed to get log entry" });
  }
});

/**
 * Find audit rows that plausibly affected a single comms-log entry so the
 * detail dialog can deep-link them. Two sources are surfaced today:
 *
 * 1. queue_fallback rows fired when the email/SMS queue was unavailable and
 *    the comms service fell back to a direct send. That's the case the
 *    dialog was originally built for ("why did this message take this
 *    path?"). Match strategy:
 *      - Always: actionType = "queue_fallback" AND entityType = "queue"
 *      - Preferred: `metadata.commsLogId = log.id`. Modern fallback rows
 *        stamp the freshly-inserted communication_log id onto themselves
 *        (see `recordQueueFallback({ commsLogId })` in
 *        queue-fallback-tracker.ts), giving an exact 1:1 link with no
 *        ambiguity. Slow direct-sends that finish outside the heuristic's
 *        ±2-minute window and back-to-back sends to the same recipient
 *        still resolve correctly through this path.
 *      - Fallback heuristic for legacy rows that predate the commsLogId
 *        stamping (so `metadata.commsLogId` is absent):
 *          - entityId equals the comms-log channel ("email" / "sms")
 *          - createdAt is within ±RELATED_AUDIT_WINDOW_MS of the comms-log
 *            row's createdAt
 *          - if the comms-log row has a recipient, the fallback row's
 *            metadata.recipient must match
 *      The two branches are OR'd, so a row that satisfies either qualifies.
 *      The heuristic branch explicitly excludes rows that already carry a
 *      commsLogId — that way a matching commsLogId always represents the
 *      truthful link, and a non-matching commsLogId can never sneak through
 *      on a time-window match for the wrong send.
 *
 * 2. template_create / template_update / template_delete rows that touched
 *    the same template_slug as the comms-log row, written within a window
 *    BEFORE the send (with a small grace window after to absorb concurrent
 *    edits). This answers the natural follow-up support sees after a queue
 *    fallback row links: "did someone edit this template right before the
 *    send?". Channel matching keeps email-template edits from polluting an
 *    SMS send's related list and vice versa.
 *
 * PII redaction: queue_fallback embeds the recipient in description and
 * metadata, so it's PII-bearing and gets routed through redactAuditRowPii
 * for viewers without the `members:pii` permission. Template-edit rows
 * don't carry member PII (slug + diff of admin-controlled copy), so they
 * pass through unchanged regardless of permission level.
 */
async function fetchRelatedAuditRows(
  req: Request,
  log: typeof communicationLogTable.$inferSelect,
): Promise<unknown[]> {
  if (!log.createdAt) return [];

  // Exact-id match: the modern path. Beats the heuristic and works even
  // when the fallback was recorded outside the time window.
  const exactCommsLogIdMatch = sql`${auditLogTable.metadata}->>'commsLogId' = ${String(log.id)}`;

  // Legacy heuristic. Restricted to rows without a commsLogId so a fallback
  // for a different send can't false-positive on this log just because the
  // recipient and channel happen to line up in time.
  const heuristicConditions: any[] = [
    sql`${auditLogTable.metadata}->>'commsLogId' IS NULL`,
    eq(auditLogTable.entityId, log.channel),
    gte(auditLogTable.createdAt, new Date(log.createdAt.getTime() - RELATED_AUDIT_WINDOW_MS)),
    lte(auditLogTable.createdAt, new Date(log.createdAt.getTime() + RELATED_AUDIT_WINDOW_MS)),
  ];

  // Channel-specific recipient match for the heuristic branch. Postgres jsonb
  // operator `->>` returns NULL when the key is missing, which an `=`
  // predicate naturally rejects, so legacy rows without metadata.recipient
  // just don't match.
  const recipient = log.recipientEmail ?? log.recipientPhone ?? null;
  if (recipient) {
    heuristicConditions.push(sql`${auditLogTable.metadata}->>'recipient' = ${recipient}`);
  }

  const queueFallbackConditions: any[] = [
    eq(auditLogTable.actionType, QUEUE_FALLBACK_ACTION_TYPE),
    eq(auditLogTable.entityType, QUEUE_FALLBACK_ENTITY_TYPE),
    or(exactCommsLogIdMatch, and(...heuristicConditions)),
  ];

  const selection = {
    id: auditLogTable.id,
    createdAt: auditLogTable.createdAt,
    actionType: auditLogTable.actionType,
    entityType: auditLogTable.entityType,
    entityId: auditLogTable.entityId,
    description: auditLogTable.description,
    metadata: auditLogTable.metadata,
    changeDiff: auditLogTable.changeDiff,
    actorId: auditLogTable.actorId,
    actorEmail: auditLogTable.actorEmail,
  } as const;

  const fallbackRows = await db
    .select(selection)
    .from(auditLogTable)
    .where(and(...queueFallbackConditions))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(RELATED_AUDIT_LIMIT);

  // Only run the template-edit lookup when the comms-log row actually
  // identifies its template. Sends without a templateSlug (e.g. ad-hoc
  // direct sends) wouldn't have a stable join key, so we'd just be
  // surfacing every recent edit on every channel — too noisy to be useful.
  let templateRows: typeof fallbackRows = [];
  if (log.templateSlug) {
    const templateEntityType =
      log.channel === "email"
        ? EMAIL_TEMPLATE_ENTITY_TYPE
        : log.channel === "sms"
          ? SMS_TEMPLATE_ENTITY_TYPE
          : null;
    if (templateEntityType) {
      templateRows = await db
        .select(selection)
        .from(auditLogTable)
        .where(
          and(
            inArray(auditLogTable.actionType, TEMPLATE_AUDIT_ACTION_TYPES as unknown as string[]),
            eq(auditLogTable.entityType, templateEntityType),
            sql`${auditLogTable.metadata}->>'templateSlug' = ${log.templateSlug}`,
            gte(
              auditLogTable.createdAt,
              new Date(log.createdAt.getTime() - RELATED_TEMPLATE_AUDIT_WINDOW_BEFORE_MS),
            ),
            lte(
              auditLogTable.createdAt,
              new Date(log.createdAt.getTime() + RELATED_TEMPLATE_AUDIT_WINDOW_AFTER_MS),
            ),
          ),
        )
        .orderBy(desc(auditLogTable.createdAt))
        .limit(RELATED_AUDIT_LIMIT);
    }
  }

  // Merge, dedupe (defensive — the two queries don't overlap by action
  // type, but being explicit keeps the contract clear), sort newest-first,
  // and cap at the dialog's limit so the UI stays scannable.
  const seen = new Set<number>();
  const merged: typeof fallbackRows = [];
  for (const row of [...fallbackRows, ...templateRows]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  merged.sort((a, b) => {
    const aMs = a.createdAt ? a.createdAt.getTime() : 0;
    const bMs = b.createdAt ? b.createdAt.getTime() : 0;
    return bMs - aMs;
  });
  const capped = merged.slice(0, RELATED_AUDIT_LIMIT);

  const canSeePii = hasPermission(req.adminRole, "members:pii");
  return canSeePii ? capped : capped.map(redactAuditRowPii);
}

router.get("/admin/communications/member/:userId/history", requirePermission("communications:view"), async (req: Request, res: Response) => {
  try {
    const userId = parseInt(getParam(req.params.userId), 10);
    if (isNaN(userId)) { res.status(400).json({ error: "Invalid user ID" }); return; }

    const logs = await db.select().from(communicationLogTable)
      .where(eq(communicationLogTable.userId, userId))
      .orderBy(desc(communicationLogTable.createdAt))
      .limit(100);

    res.json(logs);
  } catch (error) {
    console.error("[Admin] Error getting member communication history:", error);
    res.status(500).json({ error: "Failed to get member history" });
  }
});

router.get("/admin/communications/bounces", requirePermission("communications:view"), async (_req: Request, res: Response) => {
  try {
    const bounces = await db.select().from(emailBouncesTable).orderBy(desc(emailBouncesTable.bouncedAt));
    res.json(bounces);
  } catch (error) {
    console.error("[Admin] Error listing bounces:", error);
    res.status(500).json({ error: "Failed to list bounces" });
  }
});

router.patch("/admin/communications/bounces/:id/unsuppress", requirePermission("communications:manage"), async (req: Request, res: Response) => {
  try {
    const id = parseInt(getParam(req.params.id), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [updated] = await db.update(emailBouncesTable).set({ suppressed: false }).where(eq(emailBouncesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Bounce not found" }); return; }
    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error unsuppressing bounce:", error);
    res.status(500).json({ error: "Failed to unsuppress bounce" });
  }
});

router.get("/admin/communications/analytics", requirePermission("communications:view"), async (req: Request, res: Response) => {
  try {
    const { period = "month" } = req.query;

    let startDate: Date;
    const now = new Date();
    switch (period) {
      case "today":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "week":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
    }

    const dateFilter = gte(communicationLogTable.createdAt, startDate);

    const [emailStats] = await db.select({
      sent: sql<number>`COUNT(*) FILTER (WHERE ${communicationLogTable.channel} = 'email')`,
      delivered: sql<number>`COUNT(*) FILTER (WHERE ${communicationLogTable.channel} = 'email' AND ${communicationLogTable.deliveredAt} IS NOT NULL)`,
      opened: sql<number>`COUNT(*) FILTER (WHERE ${communicationLogTable.channel} = 'email' AND ${communicationLogTable.openedAt} IS NOT NULL)`,
      clicked: sql<number>`COUNT(*) FILTER (WHERE ${communicationLogTable.channel} = 'email' AND ${communicationLogTable.clickedAt} IS NOT NULL)`,
      bounced: sql<number>`COUNT(*) FILTER (WHERE ${communicationLogTable.channel} = 'email' AND ${communicationLogTable.bouncedAt} IS NOT NULL)`,
    }).from(communicationLogTable).where(dateFilter);

    const [smsStats] = await db.select({
      sent: sql<number>`COUNT(*) FILTER (WHERE ${communicationLogTable.channel} = 'sms')`,
      delivered: sql<number>`COUNT(*) FILTER (WHERE ${communicationLogTable.channel} = 'sms' AND ${communicationLogTable.deliveredAt} IS NOT NULL)`,
      failed: sql<number>`COUNT(*) FILTER (WHERE ${communicationLogTable.channel} = 'sms' AND ${communicationLogTable.status} = 'failed')`,
    }).from(communicationLogTable).where(dateFilter);

    const topTemplates = await db.select({
      templateSlug: communicationLogTable.templateSlug,
      total: sql<number>`COUNT(*)`,
      opened: sql<number>`COUNT(*) FILTER (WHERE ${communicationLogTable.openedAt} IS NOT NULL)`,
      clicked: sql<number>`COUNT(*) FILTER (WHERE ${communicationLogTable.clickedAt} IS NOT NULL)`,
    }).from(communicationLogTable)
      .where(and(dateFilter, eq(communicationLogTable.channel, "email")))
      .groupBy(communicationLogTable.templateSlug)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(10);

    const [unsubscribeCount] = await db.select({ count: count() }).from(emailUnsubscribesTable)
      .where(and(eq(emailUnsubscribesTable.active, true), gte(emailUnsubscribesTable.unsubscribedAt, startDate)));

    const sequenceCompletions = await db.select({
      sequenceId: sequenceEnrollmentsTable.sequenceId,
      total: sql<number>`COUNT(*)`,
      completed: sql<number>`COUNT(*) FILTER (WHERE ${sequenceEnrollmentsTable.status} = 'completed')`,
    }).from(sequenceEnrollmentsTable)
      .groupBy(sequenceEnrollmentsTable.sequenceId);

    const emailSent = Number(emailStats?.sent ?? 0);
    const smsSent = Number(smsStats?.sent ?? 0);
    const estimatedEmailCost = emailSent * 0.001;
    const estimatedSmsCost = smsSent * 0.0079;

    res.json({
      email: {
        sent: emailSent,
        delivered: Number(emailStats?.delivered ?? 0),
        opened: Number(emailStats?.opened ?? 0),
        clicked: Number(emailStats?.clicked ?? 0),
        bounced: Number(emailStats?.bounced ?? 0),
      },
      sms: {
        sent: smsSent,
        delivered: Number(smsStats?.delivered ?? 0),
        failed: Number(smsStats?.failed ?? 0),
      },
      topTemplates: topTemplates.map(t => ({
        templateSlug: t.templateSlug,
        total: Number(t.total),
        opened: Number(t.opened),
        clicked: Number(t.clicked),
        openRate: Number(t.total) > 0 ? Number(t.opened) / Number(t.total) : 0,
        clickRate: Number(t.total) > 0 ? Number(t.clicked) / Number(t.total) : 0,
      })),
      unsubscribes: Number(unsubscribeCount?.count ?? 0),
      sequenceCompletions: sequenceCompletions.map(s => ({
        sequenceId: s.sequenceId,
        total: Number(s.total),
        completed: Number(s.completed),
        completionRate: Number(s.total) > 0 ? Number(s.completed) / Number(s.total) : 0,
      })),
      estimatedCost: {
        email: estimatedEmailCost,
        sms: estimatedSmsCost,
        total: estimatedEmailCost + estimatedSmsCost,
      },
      period,
    });
  } catch (error) {
    console.error("[Admin] Error getting communication analytics:", error);
    res.status(500).json({ error: "Failed to get analytics" });
  }
});

export default router;

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
} from "@workspace/db";
import { eq, sql, desc, asc, and, or, ilike, count, gte, lte, inArray } from "drizzle-orm";
import { requireAdmin } from "../middleware/auth";
import { CommunicationService } from "../lib/communication-service";

const router = Router();

router.get("/admin/communications/email-templates", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const templates = await db.select().from(emailTemplatesTable).orderBy(asc(emailTemplatesTable.name));
    res.json(templates);
  } catch (error) {
    console.error("[Admin] Error listing email templates:", error);
    res.status(500).json({ error: "Failed to list email templates" });
  }
});

router.get("/admin/communications/email-templates/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [template] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, id));
    if (!template) { res.status(404).json({ error: "Template not found" }); return; }
    res.json(template);
  } catch (error) {
    console.error("[Admin] Error getting email template:", error);
    res.status(500).json({ error: "Failed to get email template" });
  }
});

router.post("/admin/communications/email-templates", requireAdmin, async (req: Request, res: Response) => {
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
    }).returning();
    res.status(201).json(template);
  } catch (error: any) {
    if (error?.code === "23505") {
      res.status(409).json({ error: "Template slug already exists" });
      return;
    }
    console.error("[Admin] Error creating email template:", error);
    res.status(500).json({ error: "Failed to create email template" });
  }
});

router.put("/admin/communications/email-templates/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
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

    const [updated] = await db.update(emailTemplatesTable).set(updates).where(eq(emailTemplatesTable.id, id)).returning();
    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error updating email template:", error);
    res.status(500).json({ error: "Failed to update email template" });
  }
});

router.delete("/admin/communications/email-templates/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [deleted] = await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Template not found" }); return; }
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error deleting email template:", error);
    res.status(500).json({ error: "Failed to delete email template" });
  }
});

router.get("/admin/communications/email-templates/:id/versions", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
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

router.post("/admin/communications/email-templates/:id/restore/:versionId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const versionId = parseInt(req.params.versionId, 10);
    if (isNaN(id) || isNaN(versionId)) { res.status(400).json({ error: "Invalid IDs" }); return; }

    const [version] = await db.select().from(emailTemplateVersionsTable)
      .where(and(eq(emailTemplateVersionsTable.id, versionId), eq(emailTemplateVersionsTable.templateId, id)));
    if (!version) { res.status(404).json({ error: "Version not found" }); return; }

    const [updated] = await db.update(emailTemplatesTable).set({
      name: version.name,
      subject: version.subject,
      htmlBody: version.htmlBody,
      textBody: version.textBody,
      category: version.category,
      fromName: version.fromName,
      variables: version.variables,
    }).where(eq(emailTemplatesTable.id, id)).returning();

    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error restoring template version:", error);
    res.status(500).json({ error: "Failed to restore template version" });
  }
});

router.post("/admin/communications/email-templates/:id/preview", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
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

router.get("/admin/communications/sms-templates", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const templates = await db.select().from(smsTemplatesTable).orderBy(asc(smsTemplatesTable.name));
    res.json(templates);
  } catch (error) {
    console.error("[Admin] Error listing SMS templates:", error);
    res.status(500).json({ error: "Failed to list SMS templates" });
  }
});

router.post("/admin/communications/sms-templates", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { slug, name, body, variables } = req.body;
    if (!slug || !name || !body) {
      res.status(400).json({ error: "slug, name, and body are required" });
      return;
    }
    const [template] = await db.insert(smsTemplatesTable).values({
      slug, name, body, variables: variables || [],
    }).returning();
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

router.put("/admin/communications/sms-templates/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const { name, body, variables, active } = req.body;
    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (body !== undefined) updates.body = body;
    if (variables !== undefined) updates.variables = variables;
    if (active !== undefined) updates.active = active;

    const [updated] = await db.update(smsTemplatesTable).set(updates).where(eq(smsTemplatesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Template not found" }); return; }
    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error updating SMS template:", error);
    res.status(500).json({ error: "Failed to update SMS template" });
  }
});

router.delete("/admin/communications/sms-templates/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [deleted] = await db.delete(smsTemplatesTable).where(eq(smsTemplatesTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Template not found" }); return; }
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error deleting SMS template:", error);
    res.status(500).json({ error: "Failed to delete SMS template" });
  }
});

router.get("/admin/communications/sequences", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const sequences = await db.select().from(sequencesTable).orderBy(desc(sequencesTable.createdAt));

    const result = [];
    for (const seq of sequences) {
      const [stepCount] = await db.select({ count: count() }).from(sequenceStepsTable)
        .where(eq(sequenceStepsTable.sequenceId, seq.id));
      const [enrollmentCount] = await db.select({ count: count() }).from(sequenceEnrollmentsTable)
        .where(and(eq(sequenceEnrollmentsTable.sequenceId, seq.id), eq(sequenceEnrollmentsTable.status, "active")));
      result.push({
        ...seq,
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

router.post("/admin/communications/sequences", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, description, triggerEvent } = req.body;
    if (!name) { res.status(400).json({ error: "name is required" }); return; }
    const [sequence] = await db.insert(sequencesTable).values({
      name, description, triggerEvent,
    }).returning();
    res.status(201).json(sequence);
  } catch (error) {
    console.error("[Admin] Error creating sequence:", error);
    res.status(500).json({ error: "Failed to create sequence" });
  }
});

router.get("/admin/communications/sequences/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [sequence] = await db.select().from(sequencesTable).where(eq(sequencesTable.id, id));
    if (!sequence) { res.status(404).json({ error: "Sequence not found" }); return; }

    const steps = await db.select().from(sequenceStepsTable)
      .where(eq(sequenceStepsTable.sequenceId, id))
      .orderBy(asc(sequenceStepsTable.sortOrder));

    const enrollments = await db.select({
      enrollment: sequenceEnrollmentsTable,
      userName: usersTable.name,
      userEmail: usersTable.email,
    }).from(sequenceEnrollmentsTable)
      .leftJoin(usersTable, eq(sequenceEnrollmentsTable.userId, usersTable.id))
      .where(eq(sequenceEnrollmentsTable.sequenceId, id))
      .orderBy(desc(sequenceEnrollmentsTable.enrolledAt));

    res.json({ ...sequence, steps, enrollments });
  } catch (error) {
    console.error("[Admin] Error getting sequence:", error);
    res.status(500).json({ error: "Failed to get sequence" });
  }
});

router.put("/admin/communications/sequences/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const { name, description, triggerEvent, status } = req.body;
    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (triggerEvent !== undefined) updates.triggerEvent = triggerEvent;
    if (status !== undefined) updates.status = status;

    const [updated] = await db.update(sequencesTable).set(updates).where(eq(sequencesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Sequence not found" }); return; }
    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error updating sequence:", error);
    res.status(500).json({ error: "Failed to update sequence" });
  }
});

router.delete("/admin/communications/sequences/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [deleted] = await db.delete(sequencesTable).where(eq(sequencesTable.id, id)).returning();
    if (!deleted) { res.status(404).json({ error: "Sequence not found" }); return; }
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error deleting sequence:", error);
    res.status(500).json({ error: "Failed to delete sequence" });
  }
});

router.post("/admin/communications/sequences/:id/steps", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sequenceId = parseInt(req.params.id, 10);
    if (isNaN(sequenceId)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const { channel, templateSlug, subject, body, delayMinutes, condition, sortOrder } = req.body;

    let order = sortOrder;
    if (order === undefined) {
      const [maxOrder] = await db.select({ max: sql<number>`COALESCE(MAX(${sequenceStepsTable.sortOrder}), -1)` })
        .from(sequenceStepsTable).where(eq(sequenceStepsTable.sequenceId, sequenceId));
      order = (maxOrder?.max ?? -1) + 1;
    }

    const [step] = await db.insert(sequenceStepsTable).values({
      sequenceId, channel: channel || "email",
      templateSlug, subject, body,
      delayMinutes: delayMinutes || 0,
      condition, sortOrder: order,
    }).returning();
    res.status(201).json(step);
  } catch (error) {
    console.error("[Admin] Error adding sequence step:", error);
    res.status(500).json({ error: "Failed to add sequence step" });
  }
});

router.put("/admin/communications/sequences/:id/steps/:stepId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sequenceId = parseInt(req.params.id, 10);
    const stepId = parseInt(req.params.stepId, 10);
    if (isNaN(sequenceId) || isNaN(stepId)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const { channel, templateSlug, subject, body, delayMinutes, condition, sortOrder, active } = req.body;
    const updates: Record<string, any> = {};
    if (channel !== undefined) updates.channel = channel;
    if (templateSlug !== undefined) updates.templateSlug = templateSlug;
    if (subject !== undefined) updates.subject = subject;
    if (body !== undefined) updates.body = body;
    if (delayMinutes !== undefined) updates.delayMinutes = delayMinutes;
    if (condition !== undefined) updates.condition = condition;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    if (active !== undefined) updates.active = active;

    const [updated] = await db.update(sequenceStepsTable).set(updates)
      .where(and(eq(sequenceStepsTable.id, stepId), eq(sequenceStepsTable.sequenceId, sequenceId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Step not found" }); return; }
    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error updating sequence step:", error);
    res.status(500).json({ error: "Failed to update sequence step" });
  }
});

router.delete("/admin/communications/sequences/:id/steps/:stepId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sequenceId = parseInt(req.params.id, 10);
    const stepId = parseInt(req.params.stepId, 10);
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

router.patch("/admin/communications/sequences/:id/steps/reorder", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders)) { res.status(400).json({ error: "orders must be an array" }); return; }
    for (const { id, sortOrder } of orders) {
      await db.update(sequenceStepsTable).set({ sortOrder }).where(eq(sequenceStepsTable.id, id));
    }
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin] Error reordering steps:", error);
    res.status(500).json({ error: "Failed to reorder steps" });
  }
});

router.post("/admin/communications/sequences/:id/enroll", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sequenceId = parseInt(req.params.id, 10);
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

router.post("/admin/communications/sequences/:id/cancel-enrollment/:enrollmentId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const sequenceId = parseInt(req.params.id, 10);
    const enrollmentId = parseInt(req.params.enrollmentId, 10);
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

router.patch("/admin/communications/sequences/:id/pause", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [updated] = await db.update(sequencesTable).set({ status: "paused" }).where(eq(sequencesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Sequence not found" }); return; }
    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error pausing sequence:", error);
    res.status(500).json({ error: "Failed to pause sequence" });
  }
});

router.patch("/admin/communications/sequences/:id/resume", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [updated] = await db.update(sequencesTable).set({ status: "active" }).where(eq(sequencesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Sequence not found" }); return; }
    res.json(updated);
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

router.get("/admin/communications/broadcasts", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const broadcasts = await db.select().from(broadcastsTable).orderBy(desc(broadcastsTable.createdAt));
    res.json(broadcasts);
  } catch (error) {
    console.error("[Admin] Error listing broadcasts:", error);
    res.status(500).json({ error: "Failed to list broadcasts" });
  }
});

router.get("/admin/communications/broadcasts/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [broadcast] = await db.select().from(broadcastsTable).where(eq(broadcastsTable.id, id));
    if (!broadcast) { res.status(404).json({ error: "Broadcast not found" }); return; }
    res.json(broadcast);
  } catch (error) {
    console.error("[Admin] Error getting broadcast:", error);
    res.status(500).json({ error: "Failed to get broadcast" });
  }
});

router.post("/admin/communications/broadcasts", requireAdmin, async (req: Request, res: Response) => {
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

router.put("/admin/communications/broadcasts/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
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

router.delete("/admin/communications/broadcasts/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
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

router.post("/admin/communications/broadcasts/:id/preview", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
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

router.post("/admin/communications/broadcasts/:id/send", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
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
          variables: { member_name: user.name, portal_url: process.env.PORTAL_URL || "https://portal.buildtestscale.com" },
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

router.post("/admin/communications/broadcasts/:id/duplicate", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
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

router.get("/admin/communications/log", requireAdmin, async (req: Request, res: Response) => {
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

router.get("/admin/communications/log/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const [entry] = await db.select({
      log: communicationLogTable,
      userName: usersTable.name,
      userEmail: usersTable.email,
    }).from(communicationLogTable)
      .leftJoin(usersTable, eq(communicationLogTable.userId, usersTable.id))
      .where(eq(communicationLogTable.id, id));

    if (!entry) { res.status(404).json({ error: "Log entry not found" }); return; }
    res.json(entry);
  } catch (error) {
    console.error("[Admin] Error getting communication log entry:", error);
    res.status(500).json({ error: "Failed to get log entry" });
  }
});

router.get("/admin/communications/member/:userId/history", requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = parseInt(req.params.userId, 10);
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

router.get("/admin/communications/bounces", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const bounces = await db.select().from(emailBouncesTable).orderBy(desc(emailBouncesTable.bouncedAt));
    res.json(bounces);
  } catch (error) {
    console.error("[Admin] Error listing bounces:", error);
    res.status(500).json({ error: "Failed to list bounces" });
  }
});

router.patch("/admin/communications/bounces/:id/unsuppress", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const [updated] = await db.update(emailBouncesTable).set({ suppressed: false }).where(eq(emailBouncesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Bounce not found" }); return; }
    res.json(updated);
  } catch (error) {
    console.error("[Admin] Error unsuppressing bounce:", error);
    res.status(500).json({ error: "Failed to unsuppress bounce" });
  }
});

router.get("/admin/communications/analytics", requireAdmin, async (req: Request, res: Response) => {
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

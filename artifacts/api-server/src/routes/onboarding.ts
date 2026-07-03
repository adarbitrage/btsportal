import { Router, type IRouter } from "express";
import { db, usersTable, signedDocumentsTable, phoneChangeHistoryTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { GetOnboardingStateResponse } from "@workspace/api-zod";
import {
  PatchOnboardingStepBody,
  PatchOnboardingStepResponse,
  PatchMemberProfileBody,
  PatchMemberProfileResponse,
} from "@workspace/api-zod/schemas";
import {
  isSteppedVariant,
  getStepNames,
  getTotalSteps,
  isClientAdvanceableStep,
  type OnboardingVariant,
  type SteppedOnboardingVariant,
} from "../lib/onboarding-steps";

const router: IRouter = Router();

// Per-tier guided onboarding step contracts (Task #1640). Which array a
// member follows is decided once at creation time (see
// lib/onboarding-variant.ts) and persisted on usersTable.onboardingVariant —
// this route reads that persisted value, it never re-resolves it live.
//
// "full" (6 steps, numbering UNCHANGED from the original single-contract
// flow — renumbered from the prior 7-step contract by removing the in-portal
// ToS signing step that previously lived at step 2. Platform ToS now lives as
// a browsewrap link only; the mentorship agreement is signed upstream in GHL
// before portal access, so no in-portal signing step is needed here):
//   1. welcome                 — intro + welcome video. Client-advanceable.
//   2. profile                 — name/experience/goal. Client-advanceable
//                                 (gated on those profile fields being filled).
//   3. kickoff_booked          — book the kickoff call. EVENT-ADVANCED: only
//                                 advanceOnboardingAfterKickoffBooked() (Tier 2
//                                 booking flow) may move a member off this step.
//   4. partner_call_booked     — book the first accountability-partner call.
//                                 EVENT-ADVANCED: only
//                                 advanceOnboardingAfterPartnerCallBooked() may
//                                 move a member off this step.
//   5. pillars_watched         — watch the 7 Pillars training. Client-advanceable
//                                 (simple click-to-confirm, no server prerequisite).
//   6. partner_call_completed  — the first partner call itself. EVENT-ADVANCED:
//                                 only completeOnboardingAfterPartnerCallDone()
//                                 (Tier 3 GHL webhook) may complete onboarding
//                                 from here.
//
// "launchpad" (4 steps — no partner-call tier exists for this product):
//   1. welcome, 2. profile — identical meaning/prerequisites to "full".
//   3. kickoff_booked      — EVENT-ADVANCED, same function as "full" (the
//                             kickoff step means the same thing in both variants).
//   4. pillars_watched     — the LAST step, and it IS client-advanceable:
//                             completing it completes onboarding directly.
//
// "none" — no guided onboarding at all; onboardingComplete is set true at
// creation (see applyCreationTimeOnboardingDefaults) and this route rejects
// any GET/PATCH attempt for such a member.
//
// ToS signing is no longer part of the guided flow — signedDocumentsTable /
// GET+POST /documents remain as legal infrastructure (see routes/documents.ts)
// and the ToS is now surfaced as a browsewrap footer link instead of a gate.
//
// See lib/onboarding-advancement.ts for the internal advancement functions Tier 2
// (booking) and Tier 3 (GHL webhook) call to move members through event-only
// steps — this route intentionally REJECTS any client PATCH attempt to
// complete those steps directly, so a member can never skip ahead of a real
// booking/webhook event.
//
// NOTE: the Documents page, /documents/sign endpoint, and signed_documents
// table are intentionally NOT deleted — existing signature records remain
// legal records — but they are no longer part of the onboarding sequence or
// gated by it.

async function validateStepPrerequisites(step: number, userId: number): Promise<string | null> {
  if (step === 2) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    if (!user) return "User not found";
    if (!user.name?.trim()) return "Name is required";
    if (!user.experienceLevel) return "Experience level is required";
    if (!user.primaryGoal) return "Primary goal is required";
  }

  return null;
}

router.get("/members/me/onboarding", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const variant = (user.onboardingVariant as OnboardingVariant) ?? "full";

  const signedDocs = await db
    .select()
    .from(signedDocumentsTable)
    .where(eq(signedDocumentsTable.userId, userId));

  const stepNames = isSteppedVariant(variant) ? getStepNames(variant) : [];
  const totalSteps = stepNames.length;

  const completedSteps: string[] = [];
  for (let i = 1; i < user.onboardingStep && i <= totalSteps; i++) {
    completedSteps.push(stepNames[i - 1]);
  }

  if (user.onboardingComplete) {
    for (const step of stepNames) {
      if (!completedSteps.includes(step)) {
        completedSteps.push(step);
      }
    }
  }

  const response = {
    currentStep: user.onboardingStep,
    onboardingComplete: user.onboardingComplete,
    completedSteps,
    variant,
    stepNames,
    totalSteps,
    signedDocuments: signedDocs.map((d) => ({
      documentType: d.documentType,
      signedAt: d.signedAt.toISOString(),
    })),
  };

  res.json(GetOnboardingStateResponse.parse(response));
});

router.patch("/members/me/onboarding", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const parsed = PatchOnboardingStepBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }

  const { step } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const variant = (user.onboardingVariant as OnboardingVariant) ?? "full";
  if (!isSteppedVariant(variant)) {
    res.status(400).json({ error: "Onboarding is not applicable for this account" });
    return;
  }

  const totalSteps = getTotalSteps(variant);

  if (step < 1 || step > totalSteps) {
    res.status(400).json({ error: `Step must be between 1 and ${totalSteps}` });
    return;
  }

  if (user.onboardingComplete) {
    res.status(400).json({ error: "Onboarding already completed" });
    return;
  }

  if (step !== user.onboardingStep) {
    res.status(400).json({ error: `Cannot complete step ${step}. Current step is ${user.onboardingStep}` });
    return;
  }

  if (!isClientAdvanceableStep(variant, step)) {
    res.status(400).json({
      error: `Step ${step} advances automatically and cannot be completed directly`,
    });
    return;
  }

  const prerequisiteError = await validateStepPrerequisites(step, userId);
  if (prerequisiteError) {
    res.status(400).json({ error: prerequisiteError });
    return;
  }

  // The last client-advanceable step for a variant completes onboarding
  // directly ONLY if it's also the LAST step overall for that variant
  // (true for launchpad's step 4/pillars_watched). For "full", the last
  // client-advanceable step (5) still hands off to step 6, which remains
  // event-advanced (see completeOnboardingAfterPartnerCallDone in
  // lib/onboarding-advancement.ts) — so it does not complete onboarding here.
  const isLastStep = step === totalSteps;
  const nextStep = isLastStep ? step : step + 1;
  const onboardingComplete = isLastStep;

  await db
    .update(usersTable)
    .set({ onboardingStep: nextStep, onboardingComplete })
    .where(and(eq(usersTable.id, userId), eq(usersTable.onboardingStep, step)));

  res.json(
    PatchOnboardingStepResponse.parse({
      currentStep: nextStep,
      onboardingComplete,
    })
  );
});

router.patch("/members/me/profile", async (req, res): Promise<void> => {
  const userId = req.userId!;
  const parsed = PatchMemberProfileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }

  const { name, phone, timezone, experienceLevel, primaryGoal, smsOptIn, ticketReplySmsOptIn, securitySmsOptIn, billingSmsOptIn, coachingSmsOptIn, contentSmsOptIn, partnerCallSmsOptIn, marketingOptIn } = parsed.data;

  const updateData: Record<string, any> = {};
  if (name !== undefined) updateData.name = name;
  if (phone !== undefined) updateData.phone = phone;
  if (timezone !== undefined) updateData.timezone = timezone;
  if (experienceLevel !== undefined) updateData.experienceLevel = experienceLevel;
  if (primaryGoal !== undefined) updateData.primaryGoal = primaryGoal;
  if (smsOptIn !== undefined) updateData.smsOptIn = smsOptIn;
  if (ticketReplySmsOptIn !== undefined) updateData.ticketReplySmsOptIn = ticketReplySmsOptIn;
  if (securitySmsOptIn !== undefined) updateData.securitySmsOptIn = securitySmsOptIn;
  if (billingSmsOptIn !== undefined) updateData.billingSmsOptIn = billingSmsOptIn;
  if (coachingSmsOptIn !== undefined) updateData.coachingSmsOptIn = coachingSmsOptIn;
  if (contentSmsOptIn !== undefined) updateData.contentSmsOptIn = contentSmsOptIn;
  if (partnerCallSmsOptIn !== undefined) updateData.partnerCallSmsOptIn = partnerCallSmsOptIn;
  if (marketingOptIn !== undefined) updateData.marketingOptIn = marketingOptIn;

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  await db.transaction(async (tx) => {
    // If the phone number is being changed (and there was a real prior value
    // to remember), record the old number so the admin global search can
    // still find this member by the phone they used to have on file.
    if (phone !== undefined) {
      const [current] = await tx
        .select({ phone: usersTable.phone })
        .from(usersTable)
        .where(eq(usersTable.id, userId));
      const oldPhone = current?.phone ?? null;
      if (oldPhone && oldPhone !== phone) {
        await tx.insert(phoneChangeHistoryTable).values({
          userId,
          oldPhone,
          newPhone: phone,
        });
      }
    }
    await tx.update(usersTable).set(updateData).where(eq(usersTable.id, userId));
  });

  const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, userId));

  res.json(
    PatchMemberProfileResponse.parse({
      name: updated.name,
      phone: updated.phone,
      timezone: updated.timezone,
      experienceLevel: updated.experienceLevel,
      primaryGoal: updated.primaryGoal,
      smsOptIn: updated.smsOptIn,
      ticketReplySmsOptIn: updated.ticketReplySmsOptIn,
      securitySmsOptIn: updated.securitySmsOptIn,
      billingSmsOptIn: updated.billingSmsOptIn,
      coachingSmsOptIn: updated.coachingSmsOptIn,
      contentSmsOptIn: updated.contentSmsOptIn,
      partnerCallSmsOptIn: updated.partnerCallSmsOptIn,
      marketingOptIn: updated.marketingOptIn,
    })
  );
});

export default router;

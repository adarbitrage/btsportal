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

const router: IRouter = Router();

// The 7-step guided onboarding contract (Task #1578).
//
//   1. welcome                 — intro + welcome video. Client-advanceable.
//   2. documents (ToS)         — existing sign-doc plumbing. Client-advanceable
//                                 (gated on a signed terms_of_service row).
//   3. profile                 — name/experience/goal. Client-advanceable
//                                 (gated on those profile fields being filled).
//   4. kickoff_booked          — book the kickoff call. EVENT-ADVANCED: only
//                                 advanceOnboardingAfterKickoffBooked() (Tier 2
//                                 booking flow) may move a member off this step.
//   5. partner_call_booked     — book the first accountability-partner call.
//                                 EVENT-ADVANCED: only
//                                 advanceOnboardingAfterPartnerCallBooked() may
//                                 move a member off this step.
//   6. pillars_watched         — watch the 7 Pillars training. Client-advanceable
//                                 (simple click-to-confirm, no server prerequisite).
//   7. partner_call_completed  — the first partner call itself. EVENT-ADVANCED:
//                                 only completeOnboardingAfterPartnerCallDone()
//                                 (Tier 3 GHL webhook) may complete onboarding
//                                 from here.
//
// See lib/onboarding-advancement.ts for the internal advancement functions Tier 2
// (booking) and Tier 3 (GHL webhook) call to move members through steps 4/5/7 —
// this route intentionally REJECTS any client PATCH attempt to complete those
// steps directly, so a member can never skip ahead of a real booking/webhook event.
const STEP_NAMES = [
  "welcome",
  "documents",
  "profile",
  "kickoff_booked",
  "partner_call_booked",
  "pillars_watched",
  "partner_call_completed",
];

// Steps a member may complete themselves via PATCH /members/me/onboarding.
// Steps 4, 5, and 7 are intentionally excluded — they only ever advance via the
// internal functions in lib/onboarding-advancement.ts, triggered by a real
// booking (Tier 2) or a GHL webhook confirming the call happened (Tier 3).
const CLIENT_ADVANCEABLE_STEPS = new Set([1, 2, 3, 6]);

async function validateStepPrerequisites(step: number, userId: number): Promise<string | null> {
  if (step === 2) {
    const signedDocs = await db
      .select()
      .from(signedDocumentsTable)
      .where(eq(signedDocumentsTable.userId, userId));
    const signedTypes = new Set(signedDocs.map((d) => d.documentType));
    if (!signedTypes.has("terms_of_service")) {
      return "The Terms of Service must be signed before proceeding";
    }
  }

  if (step === 3) {
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

  const signedDocs = await db
    .select()
    .from(signedDocumentsTable)
    .where(eq(signedDocumentsTable.userId, userId));

  const completedSteps: string[] = [];
  for (let i = 1; i < user.onboardingStep; i++) {
    completedSteps.push(STEP_NAMES[i - 1]);
  }

  if (user.onboardingComplete) {
    for (const step of STEP_NAMES) {
      if (!completedSteps.includes(step)) {
        completedSteps.push(step);
      }
    }
  }

  const response = {
    currentStep: user.onboardingStep,
    onboardingComplete: user.onboardingComplete,
    completedSteps,
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

  if (step < 1 || step > 7) {
    res.status(400).json({ error: "Step must be between 1 and 7" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
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

  if (!CLIENT_ADVANCEABLE_STEPS.has(step)) {
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

  // Client-advanceable steps never complete onboarding on their own — the last
  // client-advanceable step (6) only hands off to step 7, which is
  // event-advanced (see completeOnboardingAfterPartnerCallDone in
  // lib/onboarding-advancement.ts).
  const nextStep = step + 1;

  await db
    .update(usersTable)
    .set({ onboardingStep: nextStep })
    .where(and(eq(usersTable.id, userId), eq(usersTable.onboardingStep, step)));

  res.json(
    PatchOnboardingStepResponse.parse({
      currentStep: nextStep,
      onboardingComplete: false,
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

  const { name, phone, timezone, experienceLevel, primaryGoal, smsOptIn, ticketReplySmsOptIn, securitySmsOptIn, billingSmsOptIn, coachingSmsOptIn, contentSmsOptIn, marketingOptIn } = parsed.data;

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
      marketingOptIn: updated.marketingOptIn,
    })
  );
});

export default router;

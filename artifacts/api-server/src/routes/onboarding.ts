import { Router, type IRouter } from "express";
import { db, usersTable, signedDocumentsTable, phoneChangeHistoryTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  GetOnboardingStateResponse,
  PatchOnboardingStepBody,
  PatchOnboardingStepResponse,
  PatchMemberProfileBody,
  PatchMemberProfileResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const STEP_NAMES = ["welcome", "documents", "profile", "orientation", "quick-start"];

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

  if (step < 1 || step > 5) {
    res.status(400).json({ error: "Step must be between 1 and 5" });
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

  const prerequisiteError = await validateStepPrerequisites(step, userId);
  if (prerequisiteError) {
    res.status(400).json({ error: prerequisiteError });
    return;
  }

  const nextStep = step + 1;
  const isComplete = step >= 5;

  const updateData: Record<string, any> = {
    onboardingStep: isComplete ? 5 : nextStep,
  };

  if (isComplete) {
    updateData.onboardingComplete = true;
  }

  await db.update(usersTable).set(updateData).where(eq(usersTable.id, userId));

  if (isComplete) {
    const { cancelSequence, enrollInSequence } = await import("../lib/sequence-helpers");
    await cancelSequence(userId, "onboarding_frontend");
    await cancelSequence(userId, "onboarding_mentorship");
    await enrollInSequence(userId, "nurture_frontend_to_upgrade");
  }

  res.json(
    PatchOnboardingStepResponse.parse({
      currentStep: isComplete ? 5 : nextStep,
      onboardingComplete: isComplete,
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

  const { name, phone, timezone, experienceLevel, primaryGoal, smsOptIn, marketingOptIn } = parsed.data;

  const updateData: Record<string, any> = {};
  if (name !== undefined) updateData.name = name;
  if (phone !== undefined) updateData.phone = phone;
  if (timezone !== undefined) updateData.timezone = timezone;
  if (experienceLevel !== undefined) updateData.experienceLevel = experienceLevel;
  if (primaryGoal !== undefined) updateData.primaryGoal = primaryGoal;
  if (smsOptIn !== undefined) updateData.smsOptIn = smsOptIn;
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
      marketingOptIn: updated.marketingOptIn,
    })
  );
});

export default router;

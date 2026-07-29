/**
 * One-off dev helper: create a throwaway test member stuck at the start of
 * FULL onboarding so a human can walk the wizard (welcome → profile →
 * kickoff → partner call → send-off) in the dev preview.
 *
 * Idempotent: re-running resets the same account back to step 1.
 */
import bcrypt from "bcryptjs";
import { db, usersTable, userProductsTable, productsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const EMAIL = "onboarding.demo@example.com";
const PASSWORD = "DemoWalkthrough1!";

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const [product] = await db.select().from(productsTable).where(eq(productsTable.slug, "3month"));
  if (!product) throw new Error("3month product not found");

  const existing = await db.select().from(usersTable).where(eq(usersTable.email, EMAIL));
  let userId: number;
  if (existing.length) {
    userId = existing[0].id;
    await db
      .update(usersTable)
      .set({
        passwordHash,
        onboardingComplete: false,
        onboardingStep: 1,
        onboardingVariant: "full",
        emailVerified: true,
        role: "member",
      })
      .where(eq(usersTable.id, userId));
    console.log("Reset existing test member", userId);
  } else {
    const [row] = await db
      .insert(usersTable)
      .values({
        email: EMAIL,
        passwordHash,
        name: "Demo Member",
        role: "member",
        onboardingComplete: false,
        onboardingStep: 1,
        onboardingVariant: "full",
        emailVerified: true,
      })
      .returning({ id: usersTable.id });
    userId = row.id;
    console.log("Created test member", userId);
  }

  const grant = await db
    .select()
    .from(userProductsTable)
    .where(
      and(
        eq(userProductsTable.userId, userId),
        eq(userProductsTable.productId, product.id),
        eq(userProductsTable.status, "active"),
      ),
    );
  if (!grant.length) {
    await db.insert(userProductsTable).values({ userId, productId: product.id, status: "active" });
    console.log("Granted 3month product");
  } else {
    console.log("3month grant already active");
  }

  console.log(`\nLogin: ${EMAIL} / ${PASSWORD}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

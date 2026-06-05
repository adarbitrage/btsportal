import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const EMAIL = "sandy@cherringtonmedia.com";

const PASSWORD_HASH =
  "$2b$12$.ZYdfGgw0y4r9islXiuwgePheX2GJXx/xzaEQYQDRcyR7A8XuudPi";

const [existing] = await db
  .select({ id: usersTable.id, email: usersTable.email })
  .from(usersTable)
  .where(eq(usersTable.email, EMAIL));

if (existing) {
  console.log(`User already exists (id=${existing.id}) — no action taken.`);
  process.exit(0);
}

const [inserted] = await db
  .insert(usersTable)
  .values({
    name: "Sandy Admin",
    email: EMAIL,
    passwordHash: PASSWORD_HASH,
    role: "admin",
    emailVerified: true,
    onboardingComplete: true,
  })
  .returning({ id: usersTable.id, email: usersTable.email, role: usersTable.role });

console.log(
  `Created admin account: id=${inserted.id} email=${inserted.email} role=${inserted.role}`
);

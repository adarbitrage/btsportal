import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const FIXTURE_PATH = join(__dirname, ".fixture.json");

export interface E2EFixture {
  tag: string;
  adminId: number;
  adminEmail: string;
  adminPassword: string;
  memberId: number;
  memberName: string;
  memberEmail: string;
  flexyStaffEmail: string;
}

export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL must be set for the admin Flexy E2E test (it seeds and tears down its own fixtures).",
    );
  }

  const pool = new Pool({ connectionString: url });
  const tag = randomBytes(6).toString("hex");

  const adminEmail = `e2e-admin-${tag}@e2e.local`;
  const adminPassword = `E2E-${randomBytes(9).toString("base64url")}`;
  const memberEmail = `e2e-member-${tag}@e2e.local`;
  const memberName = `E2E Member ${tag}`;
  const flexyStaffEmail = `e2e-flexy-${tag}@e2e.local`;

  const adminHash = await bcrypt.hash(adminPassword, 10);
  const memberHash = await bcrypt.hash(`unused-${randomBytes(8).toString("hex")}`, 10);

  const client = await pool.connect();
  let adminId: number;
  let memberId: number;
  try {
    await client.query("BEGIN");

    const adminRes = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
       VALUES ($1, $2, $3, 'super_admin', true, true)
       RETURNING id`,
      [`E2E Admin ${tag}`, adminEmail, adminHash],
    );
    adminId = adminRes.rows[0].id;

    const memberRes = await client.query<{ id: number }>(
      `INSERT INTO users (name, email, password_hash, role, email_verified, onboarding_complete)
       VALUES ($1, $2, $3, 'member', true, true)
       RETURNING id`,
      [memberName, memberEmail, memberHash],
    );
    memberId = memberRes.rows[0].id;

    await client.query(
      `INSERT INTO member_app_instances
        (user_id, app_name, status, provider_location_id,
         provider_staff_user_id, provider_staff_email)
       VALUES ($1, 'flexy', 'installed', $2, $3, $4)`,
      [memberId, `e2e-loc-${tag}`, `e2e-staff-${tag}`, flexyStaffEmail],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }

  const fixture: E2EFixture = {
    tag,
    adminId,
    adminEmail,
    adminPassword,
    memberId,
    memberName,
    memberEmail,
    flexyStaffEmail,
  };

  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2));
}

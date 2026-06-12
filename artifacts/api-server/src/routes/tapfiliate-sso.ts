import { Router, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";

const router = Router();

const TAPFILIATE_SSO_DASHBOARD = "https://offers.mediamavens.io";

function getSsoSecret(): string {
  const secret = process.env.TAPFILIATE_SSO_SECRET;
  if (!secret) {
    throw new Error("TAPFILIATE_SSO_SECRET is not configured");
  }
  return secret;
}

router.get("/affiliate/tapfiliate-sso", async (req: Request, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    let secret: string;
    try {
      secret = getSsoSecret();
    } catch {
      console.error("[TapfiliateSSO] TAPFILIATE_SSO_SECRET is not set");
      res.status(503).json({
        error:
          "Tapfiliate SSO is temporarily unavailable: the SSO integration is not configured. Please contact an administrator.",
      });
      return;
    }

    const [user] = await db
      .select({ email: usersTable.email, name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    const parts = (user.name ?? "").trim().split(/\s+/);
    const firstname = parts[0] || "-";
    const lastname = parts.slice(1).join(" ") || "-";

    const payload = {
      iat: Math.floor(Date.now() / 1000),
      jti: randomUUID(),
      email: user.email,
      firstname,
      lastname,
    };

    const token = jwt.sign(payload, secret, { algorithm: "HS256" });
    const redirectUrl = `${TAPFILIATE_SSO_DASHBOARD}/sso/jwt/access/?jwt=${token}`;

    res.json({ url: redirectUrl });
  } catch (error) {
    console.error("[TapfiliateSSO] Error generating SSO token:", error);
    res.status(500).json({ error: "Failed to generate SSO token" });
  }
});

export default router;

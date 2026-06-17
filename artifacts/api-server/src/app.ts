import path from "path";
import { fileURLToPath } from "url";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import qs from "qs";
import router from "./routes";
import referralRedirectRouter from "./routes/referral-redirect";
import { authenticate } from "./middleware/auth";
import { requestIdMiddleware, apiErrorHandler } from "./lib/api-errors";
import { rateLimiter } from "./middleware/rate-limiter";
import { apiRequestLogger } from "./middleware/api-request-logger";
import { startTicketJobs } from "./lib/ticket-jobs";
import { startSquidyJobs } from "./lib/squidy-jobs";
import { startInactiveAppCleanupJob } from "./lib/inactive-app-cleanup";
import { startEmailChangeAttemptsCleanupJob } from "./lib/email-change-attempts-cleanup";
import { startPasswordResetAttemptsCleanupJob } from "./lib/password-reset-attempts-cleanup";
import { startEmailChangeHistoryCleanupJob } from "./lib/email-change-history-cleanup";
import { startPhoneChangeHistoryCleanupJob } from "./lib/phone-change-history-cleanup";
import { startCoachingRecordingIngestJob } from "./lib/coaching-recording-ingest-job";
import { startPendingEmailCleanupJob } from "./lib/pending-email-cleanup";
import { startAuthTokenCleanupJob } from "./lib/auth-token-cleanup";
import { startAbuseRateLimitCleanupJob } from "./lib/abuse-rate-limit-cleanup";
import { startQueueFallbackAuditCleanupJob } from "./lib/queue-fallback-audit-cleanup";
import { startAuthRateLimitAuditCleanupJob } from "./lib/auth-rate-limit-audit-cleanup";
import { startUpgradePromptEventsCleanupJob } from "./lib/upgrade-prompt-events-cleanup";
import { startAuditLogRetentionJob } from "./lib/audit-log-retention";
import { startYseGrantRetryJob } from "./lib/yse-grant-retry";
import { seedCannedResponses } from "./lib/seed-canned-responses";
import { ensureRequiredEmailTemplates } from "./lib/seed-templates";
import { seedAffiliateNetworks } from "./lib/seed-affiliate-networks";
import { seedMediaMavens } from "./lib/seed-media-mavens";
import { seedModerationWordlist } from "./lib/seed-moderation-wordlist";
import { seedAssistantCards } from "./lib/seed-assistant-cards";
import { seedSessionPackCoaches } from "./lib/seed-session-pack-coaches";
import { subscribeWordlistInvalidations } from "./lib/moderation/wordlist";
// seedYseProducts is intentionally NOT imported/run here — it must complete
// BEFORE the server starts accepting traffic (the /api/integrations/machine-purchase
// endpoint hard-depends on the `yse_front_end` product row existing). It is
// awaited from index.ts as part of bootstrapCriticalPrerequisites().
import { startOutgoingWebhookWorker } from "./lib/outgoing-webhook-queue";
import { startTicketDeskPoller } from "./lib/ticketdesk-poller";
import { createSwaggerRouter } from "./middleware/swagger-ui";

declare global {
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}

const app: Express = express();

app.use(cors({
  credentials: true,
  origin: true,
}));

app.use("/api/webhooks", express.raw({ type: "*/*" }), (req: Request, _res: Response, next: NextFunction) => {
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body.toString("utf-8");
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      req.body = qs.parse(req.rawBody, { allowDots: true });
    } else {
      try {
        req.body = JSON.parse(req.rawBody);
      } catch {
        req.body = {};
      }
    }
  }
  next();
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use("/api/logos", express.static(path.join(__dirname, "..", "public", "logos")));
app.use("/api/media-mavens", express.static(path.join(__dirname, "..", "public", "media-mavens")));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use("/api", requestIdMiddleware);
app.use("/api", referralRedirectRouter);

const swaggerRouter = createSwaggerRouter();
if (swaggerRouter) {
  app.use("/api", swaggerRouter);
}

app.use("/api", authenticate);
app.use("/api", rateLimiter);
app.use("/api", apiRequestLogger);
app.use("/api", router);
app.use("/api", apiErrorHandler);

seedCannedResponses().catch(err => console.error("[Seed] Failed to seed canned responses:", err));
ensureRequiredEmailTemplates().catch(err => console.error("[Seed] Failed to ensure required email templates:", err));
seedAffiliateNetworks().catch(err => console.error("[Seed] Failed to seed affiliate networks:", err));
seedMediaMavens().catch(err => console.error("[Seed] Failed to seed Media Mavens products:", err));
seedModerationWordlist().catch(err => console.error("[Seed] Failed to seed moderation wordlist:", err));
seedAssistantCards().catch(err => console.error("[Seed] Failed to seed assistant cards:", err));
seedSessionPackCoaches().catch(err => console.error("[Seed] Failed to seed session-pack coaches:", err));
subscribeWordlistInvalidations();

(async () => {
  try {
    const { db: database, usersTable: users, productsTable: products, userProductsTable: userProducts } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const bcrypt = (await import("bcryptjs")).default;
    const ownerEmails = [
      { email: "mark@cherringtonmedia.com", name: "Mark Blyn", password: "Mablyn@1969" },
      { email: "adam@cherringtonmedia.com", name: "Adam", password: "Jesuslives38!" },
      { email: "abdulrahman@cherringtonmedia.com", name: "Abdou", password: "Test&$#123" },
    ];
    for (const owner of ownerEmails) {
      const [existing] = await database.select({ id: users.id, sourceProduct: users.sourceProduct, role: users.role, emailVerified: users.emailVerified })
        .from(users).where(eq(users.email, owner.email));
      if (existing) {
        // Re-run the upgrade if any owner-account invariant has drifted —
        // including emailVerified, which can be flipped back to false by the
        // email-change verification flow and would otherwise lock owners out.
        if (existing.role !== "admin" || existing.sourceProduct !== "lifetime" || !existing.emailVerified) {
          await database.update(users).set({ role: "admin", sourceProduct: "lifetime", onboardingComplete: true, emailVerified: true }).where(eq(users.id, existing.id));
          const existingProducts = await database.select({ productId: userProducts.productId }).from(userProducts).where(eq(userProducts.userId, existing.id));
          const existingIds = new Set(existingProducts.map(p => p.productId));
          const allProducts = await database.select({ id: products.id }).from(products);
          for (const p of allProducts) {
            if (!existingIds.has(p.id)) {
              await database.insert(userProducts).values({ userId: existing.id, productId: p.id, status: "active", purchasedAt: new Date() });
            }
          }
          console.log(`[Startup] Upgraded ${owner.email} to admin with all products`);
        }
      } else {
        const passwordHash = await bcrypt.hash(owner.password, 12);
        const [newUser] = await database.insert(users).values({
          email: owner.email,
          name: owner.name,
          passwordHash,
          role: "admin",
          sourceProduct: "lifetime",
          emailVerified: true,
          onboardingComplete: true,
          onboardingStep: 1,
        }).returning({ id: users.id });
        const allProducts = await database.select({ id: products.id }).from(products);
        for (const p of allProducts) {
          await database.insert(userProducts).values({ userId: newUser.id, productId: p.id, status: "active", purchasedAt: new Date() });
        }
        console.log(`[Startup] Created admin account ${owner.email} with all products`);
      }
    }
  } catch (err) {
    console.warn("[Startup] Account upgrade check skipped:", err);
  }
})();
startTicketJobs();
startSquidyJobs();
startInactiveAppCleanupJob();
startEmailChangeAttemptsCleanupJob();
startPasswordResetAttemptsCleanupJob();
startEmailChangeHistoryCleanupJob();
startPhoneChangeHistoryCleanupJob();
startCoachingRecordingIngestJob();
startPendingEmailCleanupJob();
startAuthTokenCleanupJob();
startAbuseRateLimitCleanupJob();
startQueueFallbackAuditCleanupJob();
startAuthRateLimitAuditCleanupJob();
startUpgradePromptEventsCleanupJob();
startAuditLogRetentionJob();
startYseGrantRetryJob();
if (process.env.REDIS_URL) {
  startOutgoingWebhookWorker();
}
startTicketDeskPoller();

export default app;

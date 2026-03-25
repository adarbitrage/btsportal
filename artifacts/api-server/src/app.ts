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
import { seedCannedResponses } from "./lib/seed-canned-responses";
import { startOutgoingWebhookWorker } from "./lib/outgoing-webhook-queue";
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

(async () => {
  try {
    const { db: database, usersTable: users, productsTable: products, userProductsTable: userProducts } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const [markUser] = await database.select({ id: users.id, sourceProduct: users.sourceProduct, role: users.role })
      .from(users).where(eq(users.email, "mark@cherringtonmedia.com"));
    if (markUser && (markUser.role !== "admin" || markUser.sourceProduct !== "lifetime")) {
      await database.update(users).set({ role: "admin", sourceProduct: "lifetime", onboardingComplete: true }).where(eq(users.id, markUser.id));
      const existingProducts = await database.select({ productId: userProducts.productId }).from(userProducts).where(eq(userProducts.userId, markUser.id));
      const existingIds = new Set(existingProducts.map(p => p.productId));
      const allProducts = await database.select({ id: products.id }).from(products);
      for (const p of allProducts) {
        if (!existingIds.has(p.id)) {
          await database.insert(userProducts).values({ userId: markUser.id, productId: p.id, status: "active", purchasedAt: new Date() });
        }
      }
      console.log("[Startup] Upgraded mark@cherringtonmedia.com to admin with all products");
    }
  } catch (err) {
    console.warn("[Startup] Account upgrade check skipped:", err);
  }
})();
startTicketJobs();
if (process.env.REDIS_URL) {
  startOutgoingWebhookWorker();
}

export default app;

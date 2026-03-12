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

app.use("/api", authenticate);
app.use("/api", rateLimiter);
app.use("/api", apiRequestLogger);
app.use("/api", router);
app.use("/api", apiErrorHandler);

seedCannedResponses().catch(err => console.error("[Seed] Failed to seed canned responses:", err));
startTicketJobs();
startOutgoingWebhookWorker();

export default app;

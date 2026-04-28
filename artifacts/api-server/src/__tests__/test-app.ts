import express, { type Express, type Router } from "express";
import cookieParser from "cookie-parser";
import { authenticate } from "../middleware/auth";
import { requestIdMiddleware, apiErrorHandler } from "../lib/api-errors";
import adminAppsRouter from "../routes/admin-apps";

export interface BuildTestAppOptions {
  routers?: Router[];
  trustProxy?: boolean;
}

export function buildTestApp(options: BuildTestAppOptions = {}): Express {
  const app = express();
  if (options.trustProxy) {
    // Allow tests to simulate distinct client IPs via X-Forwarded-For. Only the
    // test app opts in — production code relies on the operator configuring
    // `trust proxy` correctly at deploy time.
    app.set("trust proxy", true);
  }
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", requestIdMiddleware);
  app.use("/api", authenticate);
  const routers = options.routers ?? [adminAppsRouter];
  for (const r of routers) {
    app.use("/api", r);
  }
  app.use("/api", apiErrorHandler);
  return app;
}

export function buildTestAppWithRouters(routers: Router[]): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", requestIdMiddleware);
  app.use("/api", authenticate);
  for (const router of routers) {
    app.use("/api", router);
  }
  app.use("/api", apiErrorHandler);
  return app;
}

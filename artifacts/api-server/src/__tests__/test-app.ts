import express, { type Express, type Router } from "express";
import cookieParser from "cookie-parser";
import { authenticate } from "../middleware/auth";
import { requestIdMiddleware, apiErrorHandler } from "../lib/api-errors";
import adminAppsRouter from "../routes/admin-apps";

export interface BuildTestAppOptions {
  routers?: Router[];
}

export function buildTestApp(options: BuildTestAppOptions = {}): Express {
  const app = express();
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

import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { authenticate } from "../middleware/auth";
import { requestIdMiddleware, apiErrorHandler } from "../lib/api-errors";
import adminAppsRouter from "../routes/admin-apps";

export function buildTestApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", requestIdMiddleware);
  app.use("/api", authenticate);
  app.use("/api", adminAppsRouter);
  app.use("/api", apiErrorHandler);
  return app;
}

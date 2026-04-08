import { Router, type Request, type Response } from "express";
import swaggerUi from "swagger-ui-express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";

const __dirnameResolved = path.dirname(fileURLToPath(import.meta.url));

export function createSwaggerRouter(): Router | null {
  if (process.env.API_DOCS_ENABLED !== "true") {
    return null;
  }

  const router = Router();

  const specPath = path.resolve(
    __dirnameResolved,
    "..",
    "..",
    "..",
    "..",
    "lib",
    "api-spec",
    "openapi.yaml",
  );

  let spec: Record<string, unknown>;
  try {
    const raw = fs.readFileSync(specPath, "utf-8");
    spec = YAML.parse(raw);
  } catch (err) {
    console.error("[Swagger] Failed to load OpenAPI spec:", err);
    return null;
  }

  router.get("/docs/openapi.json", (_req: Request, res: Response) => {
    res.json(spec);
  });

  router.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: "BTS API Documentation",
      customCss: ".swagger-ui .topbar { display: none }",
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: "list",
        filter: true,
        tagsSorter: "alpha",
        operationsSorter: "alpha",
      },
    }),
  );

  return router;
}

import { Router } from "express";
import { getPublicTokenizationKey } from "../lib/payments/charge-service.js";
import { sendError, ErrorCodes } from "../lib/api-errors.js";

const router = Router();

router.get("/billing/tokenization-key", async (req, res): Promise<void> => {
  if (!req.userId) {
    sendError(res, 401, ErrorCodes.AUTHENTICATION_REQUIRED, "Authentication required");
    return;
  }

  const tokenizationKey = getPublicTokenizationKey();
  if (!tokenizationKey) {
    sendError(
      res,
      503,
      "BILLING_NOT_CONFIGURED",
      "BTS_NMI_TOKENIZATION_KEY is not configured. Contact the platform team to set up NMI billing.",
    );
    return;
  }

  res.json({ tokenizationKey });
});

export default router;

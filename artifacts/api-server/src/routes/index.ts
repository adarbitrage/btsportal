import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import membersRouter from "./members";
import productsRouter from "./products";
import dashboardRouter from "./dashboard";
import tracksRouter from "./tracks";
import progressRouter from "./progress";
import coachingRouter from "./coaching";
import ticketsRouter from "./tickets";
import announcementsRouter from "./announcements";
import webhooksRouter from "./webhooks";
import devSimulateRouter from "./dev-simulate";
import adminWebhooksRouter from "./admin-webhooks";
import adminExpirationRouter from "./admin-expiration";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(membersRouter);
router.use(productsRouter);
router.use(dashboardRouter);
router.use(tracksRouter);
router.use(progressRouter);
router.use(coachingRouter);
router.use(ticketsRouter);
router.use(announcementsRouter);
router.use(webhooksRouter);
router.use(devSimulateRouter);
router.use(adminWebhooksRouter);
router.use(adminExpirationRouter);

export default router;

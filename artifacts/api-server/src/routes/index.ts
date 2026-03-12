import { Router, type IRouter } from "express";
import healthRouter from "./health";
import membersRouter from "./members";
import productsRouter from "./products";
import dashboardRouter from "./dashboard";
import tracksRouter from "./tracks";
import progressRouter from "./progress";
import coachingRouter from "./coaching";
import ticketsRouter from "./tickets";
import announcementsRouter from "./announcements";

const router: IRouter = Router();

router.use(healthRouter);
router.use(membersRouter);
router.use(productsRouter);
router.use(dashboardRouter);
router.use(tracksRouter);
router.use(progressRouter);
router.use(coachingRouter);
router.use(ticketsRouter);
router.use(announcementsRouter);

export default router;

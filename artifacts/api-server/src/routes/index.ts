import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bggRouter from "./bgg";
import auctionRouter from "./auction";

const router: IRouter = Router();

router.use(healthRouter);
router.use(bggRouter);
router.use(auctionRouter);

export default router;

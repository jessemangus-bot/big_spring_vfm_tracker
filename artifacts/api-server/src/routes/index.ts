import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bggRouter from "./bgg";

const router: IRouter = Router();

router.use(healthRouter);
router.use(bggRouter);

export default router;

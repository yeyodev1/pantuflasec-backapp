import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";
import { optionalAuth } from "../middlewares/optionalAuth.middleware";
import * as orderController from "../controllers/order.controller";

const router = Router();

router.get("/config", orderController.config);
router.post("/", optionalAuth, orderController.create);
router.post("/confirm", orderController.confirm);
router.get("/track/:token", orderController.track);

router.get("/admin/summary", authMiddleware, adminMiddleware, orderController.summary);
router.get("/admin/all", authMiddleware, adminMiddleware, orderController.listAll);
router.get("/admin/:id", authMiddleware, adminMiddleware, orderController.getById);
router.put("/admin/:id/status", authMiddleware, adminMiddleware, orderController.setStatus);

export default router;

import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { staffMiddleware } from "../middlewares/staff.middleware";
import { optionalAuth } from "../middlewares/optionalAuth.middleware";
import * as orderController from "../controllers/order.controller";

const router = Router();

router.get("/config", orderController.config);
router.post("/", optionalAuth, orderController.create);
router.post("/confirm", orderController.confirm);
router.get("/track/:token", orderController.track);
router.post("/lookup", orderController.lookup);

// Pedidos: los ven y mueven administración y vendedores.
router.get("/admin/summary", authMiddleware, staffMiddleware, orderController.summary);
router.get("/admin/all", authMiddleware, staffMiddleware, orderController.listAll);
router.get("/admin/:id", authMiddleware, staffMiddleware, orderController.getById);
router.put("/admin/:id/status", authMiddleware, staffMiddleware, orderController.setStatus);

export default router;

import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { staffMiddleware } from "../middlewares/staff.middleware";
import { optionalAuth } from "../middlewares/optionalAuth.middleware";
import { uploadMiddleware } from "../middlewares/upload.middleware";
import * as orderController from "../controllers/order.controller";

const router = Router();

router.get("/config", orderController.config);
router.get("/quote", orderController.quote);
router.post("/", optionalAuth, orderController.create);
router.post("/confirm", orderController.confirm);
router.get("/track/:token", orderController.track);
// Con el token del pedido el cliente sube su comprobante y conversa con el equipo.
router.post("/track/:token/proof", uploadMiddleware.single("file"), orderController.uploadProof);
router.post("/track/:token/messages", orderController.customerMessage);
router.post("/lookup", orderController.lookup);

// Pedidos: los ven y mueven administración y vendedores.
router.get("/admin/summary", authMiddleware, staffMiddleware, orderController.summary);
router.get("/admin/all", authMiddleware, staffMiddleware, orderController.listAll);
router.get("/admin/:id", authMiddleware, staffMiddleware, orderController.getById);
router.put("/admin/:id/status", authMiddleware, staffMiddleware, orderController.setStatus);
router.post("/admin/:id/events", authMiddleware, staffMiddleware, orderController.addEvent);
router.put("/admin/:id/payment", authMiddleware, staffMiddleware, orderController.reviewPayment);
router.post("/admin/:id/messages", authMiddleware, staffMiddleware, orderController.teamMessage);

export default router;

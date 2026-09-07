import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";
import * as productController from "../controllers/product.controller";

const router = Router();

// Público: catálogo.
router.get("/", productController.list);
router.get("/facets", productController.facets);

// Admin. Va antes de "/:slug" para que "admin" no se lea como un slug.
router.get("/admin/all", authMiddleware, adminMiddleware, productController.listAll);
router.get("/admin/:slug", authMiddleware, adminMiddleware, productController.getById);
router.post("/", authMiddleware, adminMiddleware, productController.create);
router.put("/:id", authMiddleware, adminMiddleware, productController.update);
router.delete("/:id", authMiddleware, adminMiddleware, productController.remove);

router.get("/:slug", productController.getBySlug);

export default router;

import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";
import * as galleryController from "../controllers/gallery.controller";

const router = Router();

router.get("/", galleryController.list);

router.use(authMiddleware, adminMiddleware);
router.get("/admin/all", galleryController.listAll);
router.post("/", galleryController.create);
// "reorder" va antes de "/:id" para que no se lea como un id.
router.put("/reorder", galleryController.reorder);
router.put("/:id", galleryController.update);
router.delete("/:id", galleryController.remove);

export default router;

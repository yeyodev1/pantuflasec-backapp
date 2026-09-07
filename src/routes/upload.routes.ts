import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";
import { uploadMiddleware } from "../middlewares/upload.middleware";
import * as uploadController from "../controllers/upload.controller";

const router = Router();

router.use(authMiddleware, adminMiddleware);
router.get("/status", uploadController.status);
router.get("/", uploadController.list);
router.post("/image", uploadMiddleware.single("file"), uploadController.image);
router.delete("/:publicId", uploadController.remove);

export default router;

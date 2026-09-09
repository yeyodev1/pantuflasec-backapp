import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";
import * as settingController from "../controllers/setting.controller";

const router = Router();

router.get("/hero", settingController.hero);

router.use(authMiddleware, adminMiddleware);
router.put("/hero", settingController.setHero);
router.get("/payments", settingController.payments);
router.put("/payments", settingController.setPayments);
router.get("/bank-logo/search", settingController.searchBankLogo);
router.post("/bank-logo/import", settingController.importBankLogo);
router.get("/shipping", settingController.shipping);
router.put("/shipping", settingController.setShipping);

export default router;

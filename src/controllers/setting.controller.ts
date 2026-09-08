import { Request, Response, NextFunction } from "express";
import * as settingService from "../services/setting.service";

/** GET /api/settings/hero — portada del home (pública). */
export async function hero(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await settingService.getHero());
  } catch (error) {
    next(error);
  }
}

/** PUT /api/settings/hero — admin. */
export async function setHero(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await settingService.setHero(req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** GET /api/settings/payments — cuentas y métodos que aprueba el equipo (admin). */
export async function payments(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await settingService.getPayments());
  } catch (error) {
    next(error);
  }
}

/** PUT /api/settings/payments — admin. */
export async function setPayments(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await settingService.setPayments(req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

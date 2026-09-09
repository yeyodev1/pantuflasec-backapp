import { Request, Response, NextFunction } from "express";
import * as settingService from "../services/setting.service";
import * as shippingService from "../services/shipping.service";
import * as brandfetch from "../services/brandfetch.service";

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

/** GET /api/settings/shipping — métodos de entrega, incluidos los apagados (admin). */
export async function shipping(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ methods: await shippingService.getShipping() });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/settings/shipping — body: { methods: [...] } (admin). */
export async function setShipping(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json({ methods: await shippingService.setShipping(req.body ?? {}) });
  } catch (error) {
    next(error);
  }
}

/** GET /api/settings/bank-logo/search?q= — candidatos de Brandfetch para el nombre de un banco (admin). */
export async function searchBankLogo(req: Request, res: Response, next: NextFunction) {
  try {
    res
      .status(200)
      .json({
        configured: brandfetch.isBrandfetchConfigured(),
        items: await brandfetch.searchBrands(String(req.query.q ?? "")),
      });
  } catch (error) {
    next(error);
  }
}

/** POST /api/settings/bank-logo/import — body: { domain, icon }. Copia el logo a Cloudinary (admin). */
export async function importBankLogo(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await brandfetch.importLogo(req.body ?? {}));
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

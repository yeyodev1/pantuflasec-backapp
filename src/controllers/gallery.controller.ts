import { Request, Response, NextFunction } from "express";
import * as galleryService from "../services/gallery.service";

/** GET /api/gallery — ítems activos en orden, para el home. */
export async function list(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await galleryService.listPublic());
  } catch (error) {
    next(error);
  }
}

/** GET /api/gallery/admin/all */
export async function listAll(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await galleryService.listAll());
  } catch (error) {
    next(error);
  }
}

/** POST /api/gallery — body: { image: { url, publicId }, title?, subtitle?, link? } */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await galleryService.create(req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** PUT /api/gallery/reorder — body: { ids: string[] } */
export async function reorder(req: Request, res: Response, next: NextFunction) {
  try {
    await galleryService.reorder(req.body?.ids ?? []);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

/** PUT /api/gallery/:id */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await galleryService.update(String(req.params.id), req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/gallery/:id */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await galleryService.remove(String(req.params.id));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

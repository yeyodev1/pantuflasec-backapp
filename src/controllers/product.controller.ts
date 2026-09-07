import { Request, Response, NextFunction } from "express";
import * as productService from "../services/product.service";

/** GET /api/products — query: q, category, collection, featured, sort, page, limit */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await productService.list(req.query as productService.ListQuery);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /api/products/facets — categorías y colecciones con conteo. */
export async function facets(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.facets());
  } catch (error) {
    next(error);
  }
}

/** GET /api/products/:slug */
export async function getBySlug(req: Request, res: Response, next: NextFunction) {
  try {
    const product = await productService.getBySlug(String(req.params.slug));
    res.status(200).json(product);
  } catch (error) {
    next(error);
  }
}

/** GET /api/products/:slug/related — { complement, similar } */
export async function related(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await productService.related(String(req.params.slug)));
  } catch (error) {
    next(error);
  }
}

/** GET /api/products/admin/all — igual que list pero incluye inactivos. */
export async function listAll(req: Request, res: Response, next: NextFunction) {
  try {
    const query = { ...(req.query as productService.ListQuery), all: true };
    res.status(200).json(await productService.list(query));
  } catch (error) {
    next(error);
  }
}

/** GET /api/products/admin/:id */
export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const product = await productService.getBySlug(String(req.params.slug), true);
    res.status(200).json(product);
  } catch (error) {
    next(error);
  }
}

/** POST /api/products — body: ProductInput */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const product = await productService.create(req.body ?? {});
    res.status(201).json(product);
  } catch (error) {
    next(error);
  }
}

/** PUT /api/products/:id — body: ProductInput parcial */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const product = await productService.update(String(req.params.id), req.body ?? {});
    res.status(200).json(product);
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/products/:id */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await productService.remove(String(req.params.id));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import * as orderService from "../services/order.service";

/** GET /api/orders/config — métodos de envío, IVA y credenciales públicas de la cajita. */
export function config(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(orderService.config());
  } catch (error) {
    next(error);
  }
}

/** POST /api/orders — body: { customer, shipping, items }. Público (con o sin sesión). */
export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await orderService.create(req.body ?? {}, req.user?.userId ?? null);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/** POST /api/orders/confirm — body: { id, clientTransactionId } (lo que PayPhone manda al volver). */
export async function confirm(req: Request, res: Response, next: NextFunction) {
  try {
    const { id, clientTransactionId } = req.body ?? {};
    const order = await orderService.confirm(Number(id), String(clientTransactionId ?? ""));
    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
}

/** GET /api/orders/track/:token — el token es el clientTransactionId. */
export async function track(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await orderService.track(String(req.params.token)));
  } catch (error) {
    next(error);
  }
}

/** GET /api/orders/admin/summary — { pending, paid, preparing, today } */
export async function summary(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await orderService.summary());
  } catch (error) {
    next(error);
  }
}

/** GET /api/orders/admin/all — query: status, q, page */
export async function listAll(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await orderService.list(req.query as Record<string, string>));
  } catch (error) {
    next(error);
  }
}

/** GET /api/orders/admin/:id */
export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await orderService.getById(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** PUT /api/orders/admin/:id/status — body: { status } */
export async function setStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await orderService.setStatus(String(req.params.id), String(req.body?.status ?? ""));
    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
}

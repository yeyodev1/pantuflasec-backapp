import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import * as orderService from "../services/order.service";
import * as orderAdmin from "../services/orderAdmin.service";
import * as orderPayment from "../services/orderPayment.service";
import { addMessage } from "../services/orderMessage.service";
import { frontendUrlFor } from "../utils/origin";

/** GET /api/orders/config — envíos, IVA, cajita de PayPhone y métodos que aprueba el equipo. */
export async function config(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await orderService.config());
  } catch (error) {
    next(error);
  }
}

/** POST /api/orders — body: { customer, shipping, items }. Público (con o sin sesión). */
export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await orderService.create(
      req.body ?? {},
      req.user?.userId ?? null,
      frontendUrlFor(req),
    );
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

/** POST /api/orders/lookup — body: { email }. Siempre 200. */
export async function lookup(req: Request, res: Response, next: NextFunction) {
  try {
    await orderService.lookupByEmail(String(req.body?.email ?? ""), frontendUrlFor(req));
    res.status(200).json({ ok: true });
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

/** POST /api/orders/track/:token/proof — multipart "file" + "note". Comprobante de transferencia. */
export async function uploadProof(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await orderPayment.uploadProof(
      String(req.params.token),
      req.file,
      String(req.body?.note ?? ""),
    );
    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
}

/** POST /api/orders/track/:token/messages — body: { text }. El cliente escribe al equipo. */
export async function customerMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const order = await addMessage(
      { clientTransactionId: String(req.params.token) },
      "customer",
      "cliente",
      String(req.body?.text ?? ""),
    );
    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
}

/** POST /api/orders/admin/:id/messages — body: { text }. El equipo responde. */
export async function teamMessage(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const order = await addMessage(
      { _id: String(req.params.id) },
      "team",
      req.user?.email ?? "equipo",
      String(req.body?.text ?? ""),
    );
    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
}

/** PUT /api/orders/admin/:id/payment — body: { action: "approve" | "reject", reason? } */
export async function reviewPayment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { action, reason } = req.body ?? {};
    const order = await orderPayment.review(
      String(req.params.id),
      String(action ?? ""),
      String(reason ?? ""),
      req.user?.email ?? "equipo",
    );
    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
}

/** GET /api/orders/admin/summary — { pending, paid, preparing, review, today } */
export async function summary(_req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await orderAdmin.summary());
  } catch (error) {
    next(error);
  }
}

/** GET /api/orders/admin/all — query: status, pay, q, page */
export async function listAll(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await orderAdmin.list(req.query as Record<string, string>));
  } catch (error) {
    next(error);
  }
}

/** GET /api/orders/admin/:id */
export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await orderAdmin.getById(String(req.params.id)));
  } catch (error) {
    next(error);
  }
}

/** PUT /api/orders/admin/:id/status — body: { status } */
export async function setStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const order = await orderAdmin.setStatus(
      String(req.params.id),
      String(req.body?.status ?? ""),
      req.user?.email ?? "equipo",
    );
    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
}

/** POST /api/orders/admin/:id/events — body: { kind, detail }. Contactos y notas del equipo. */
export async function addEvent(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { kind, detail } = req.body ?? {};
    const order = await orderService.addEvent(
      String(req.params.id),
      String(kind ?? ""),
      String(detail ?? ""),
      req.user?.email ?? "equipo",
    );
    res.status(200).json(order);
  } catch (error) {
    next(error);
  }
}

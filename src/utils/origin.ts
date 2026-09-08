import { Request } from "express";
import { env } from "../config/env";
import { isOriginAllowed } from "../app";

/**
 * Desde qué front vino la petición. Se usa para que los enlaces de los
 * correos lleven al mismo dominio en el que el cliente está comprando
 * (producción, pruebas o local) y no a uno fijo.
 */
export function frontendUrlFor(req: Request): string {
  const candidates = [req.headers.origin, refererOrigin(req.headers.referer)];
  for (const c of candidates) {
    if (c && isOriginAllowed(c)) return c.replace(/\/$/, "");
  }
  return env.FRONTEND_URL.replace(/\/$/, "");
}

function refererOrigin(referer?: string): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

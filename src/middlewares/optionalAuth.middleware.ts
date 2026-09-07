import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AuthRequest, JwtPayload } from "../types/AuthRequest";

/** Si viene un Bearer válido deja req.user; si no viene o es inválido, sigue sin sesión. */
export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      req.user = jwt.verify(header.slice(7), env.JWT_SECRET) as JwtPayload;
    } catch {
      // Token vencido en un checkout de invitado: no es motivo para rechazar la compra.
    }
  }
  next();
}

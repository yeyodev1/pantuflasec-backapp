import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";

/** Cuentas que atienden pedidos: administración y vendedores. Va después de authMiddleware. */
export function staffMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const role = req.user?.accountType;
  if (role !== "admin" && role !== "staff") {
    res.status(403).json({ message: "No tienes permiso para ver esto" });
    return;
  }
  next();
}

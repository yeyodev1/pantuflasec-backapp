import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import * as userService from "../services/user.service";

/** GET /api/users — query: q, accountType, page. Solo admin. */
export async function list(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(200).json(await userService.list(req.query as Record<string, string>));
  } catch (error) {
    next(error);
  }
}

/** POST /api/users — body: { email, password, name, phone, accountType } */
export async function create(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await userService.create(req.body ?? {}));
  } catch (error) {
    next(error);
  }
}

/** PUT /api/users/:id — body parcial: { name, phone, accountType, isActive, password } */
export async function update(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await userService.update(String(req.params.id), req.body ?? {}, req.user!.userId);
    res.status(200).json(user);
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/users/:id */
export async function remove(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await userService.remove(String(req.params.id), req.user!.userId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

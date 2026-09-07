import { isConnected } from "../config/mongo";
import { CustomError } from "../errors/customError.error";
import { User, ACCOUNT_TYPES, AccountType } from "../models/user.model";
import { SessionUser, createUser } from "./auth.service";

const PAGE_SIZE = 30;

function requireDb() {
  if (!isConnected()) throw new CustomError("El servidor no tiene base de datos disponible", 503);
}

export interface AdminUser extends SessionUser {
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

function sanitize(u: any): AdminUser {
  return {
    id: u._id.toString(),
    email: u.email,
    name: u.name,
    phone: u.phone,
    accountType: u.accountType,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

export async function list(query: { q?: string; accountType?: string; page?: string }) {
  requireDb();
  const page = Math.max(1, Number(query.page) || 1);
  const filter: Record<string, unknown> = {};
  if (query.accountType && ACCOUNT_TYPES.includes(query.accountType as AccountType)) {
    filter.accountType = query.accountType;
  }
  if (query.q?.trim()) {
    const rx = new RegExp(query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ email: rx }, { name: rx }, { phone: rx }];
  }
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    User.countDocuments(filter),
  ]);
  return { items: items.map(sanitize), total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function create(input: {
  email?: string;
  password?: string;
  name?: string;
  phone?: string;
  accountType?: string;
}): Promise<AdminUser> {
  requireDb();
  const email = String(input.email ?? "").trim().toLowerCase();
  if (await User.exists({ email })) throw new CustomError("Ya existe una cuenta con ese correo", 409);
  const accountType = ACCOUNT_TYPES.includes(input.accountType as AccountType)
    ? (input.accountType as AccountType)
    : "customer";
  const created = await createUser({
    email,
    password: String(input.password ?? ""),
    name: input.name,
    phone: input.phone,
    accountType,
  });
  const user = await User.findById(created.id).lean();
  return sanitize(user);
}

/**
 * Edita nombre, teléfono, rol, estado y, si viene, contraseña. Un admin no
 * puede quitarse a sí mismo el rol ni desactivarse: se quedaría afuera.
 */
export async function update(
  id: string,
  input: { name?: string; phone?: string; accountType?: string; isActive?: boolean; password?: string },
  actorId: string,
): Promise<AdminUser> {
  requireDb();
  const user = await User.findById(id);
  if (!user) throw new CustomError("Usuario no encontrado", 404);

  const self = user._id.toString() === actorId;
  if (input.accountType !== undefined) {
    if (!ACCOUNT_TYPES.includes(input.accountType as AccountType)) {
      throw new CustomError("Tipo de cuenta inválido", 400);
    }
    if (self && input.accountType !== "admin") {
      throw new CustomError("No puedes quitarte el rol de administrador", 400);
    }
    user.accountType = input.accountType as AccountType;
  }
  if (input.isActive !== undefined) {
    if (self && !input.isActive) throw new CustomError("No puedes desactivar tu propia cuenta", 400);
    user.isActive = Boolean(input.isActive);
  }
  if (input.name !== undefined) user.name = String(input.name).trim();
  if (input.phone !== undefined) user.phone = String(input.phone).trim();
  if (input.password) {
    if (String(input.password).length < 8) {
      throw new CustomError("La contraseña debe tener al menos 8 caracteres", 400);
    }
    user.password = String(input.password);
  }
  await user.save();
  return sanitize(user);
}

export async function remove(id: string, actorId: string): Promise<void> {
  requireDb();
  if (id === actorId) throw new CustomError("No puedes eliminar tu propia cuenta", 400);
  const deleted = await User.findByIdAndDelete(id);
  if (!deleted) throw new CustomError("Usuario no encontrado", 404);
}

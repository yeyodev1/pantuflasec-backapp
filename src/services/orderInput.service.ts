import { env } from "../config/env";
import { PICKUP_POINTS, SHIPPING_METHODS, ShippingMethod, isPickup } from "../config/shop";
import { CustomError } from "../errors/customError.error";
import { IOrderItem } from "../models/order.model";
import { Product } from "../models/product.model";
import * as productService from "./product.service";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CheckoutInput {
  customer?: { name?: string; email?: string; phone?: string; documentId?: string };
  shipping?: {
    method?: string;
    address?: string;
    city?: string;
    reference?: string;
    notes?: string;
  };
  billing?: {
    wanted?: boolean;
    sameAsCustomer?: boolean;
    documentId?: string;
    name?: string;
    email?: string;
    phone?: string;
  };
  items?: Array<{ productId?: string; variantId?: string | null; qty?: number }>;
  payment?: { method?: string };
}

/** Validación y armado del pedido: precio y stock salen de la base, nunca del carrito. */

export function validateCustomer(c: NonNullable<CheckoutInput["customer"]>) {
  const name = String(c.name ?? "").trim();
  const email = String(c.email ?? "")
    .trim()
    .toLowerCase();
  const phone = String(c.phone ?? "").replace(/\s+/g, "");
  if (name.length < 3) throw new CustomError("Escribe tu nombre completo", 400);
  if (!EMAIL.test(email)) throw new CustomError("Escribe un correo válido", 400);
  if (!/^\+?\d{9,15}$/.test(phone)) throw new CustomError("Escribe un celular válido", 400);
  return {
    name,
    email,
    phone: phone.startsWith("+") ? phone : `+593${phone.replace(/^0/, "")}`,
    documentId: String(c.documentId ?? "").trim(),
  };
}

/** Factura: con los mismos datos del cliente o con RUC/cédula y nombre propios. */
export function validateBilling(
  b: NonNullable<CheckoutInput["billing"]>,
  customer: ReturnType<typeof validateCustomer>,
) {
  if (!b.wanted) return { wanted: false, documentId: "", name: "", email: "", phone: "" };
  const same = b.sameAsCustomer !== false;
  const documentId = String((same ? customer.documentId : b.documentId) ?? "").replace(/\D/g, "");
  const name = same ? customer.name : String(b.name ?? "").trim();
  const email = same
    ? customer.email
    : String(b.email ?? "")
        .trim()
        .toLowerCase();
  const phone = same ? customer.phone : String(b.phone ?? "").replace(/\s+/g, "");
  if (!/^\d{10}$|^\d{13}$/.test(documentId)) {
    throw new CustomError(
      "Para la factura escribe una cédula (10 dígitos) o RUC (13 dígitos) válido",
      400,
    );
  }
  if (name.length < 3)
    throw new CustomError("Escribe el nombre o razón social para la factura", 400);
  if (!EMAIL.test(email)) throw new CustomError("Escribe un correo válido para la factura", 400);
  return { wanted: true, documentId, name, email, phone };
}

export function validateShipping(s: NonNullable<CheckoutInput["shipping"]>) {
  const method = SHIPPING_METHODS.find((m) => m.key === s.method);
  if (!method) throw new CustomError("Elige cómo quieres recibir tu pedido", 400);
  const address = String(s.address ?? "").trim();
  const city = String(s.city ?? "").trim();
  const pickup = isPickup(method.key) ? PICKUP_POINTS[method.key] : null;
  if (!pickup && (address.length < 5 || !city)) {
    throw new CustomError("Escribe la dirección y la ciudad de entrega", 400);
  }
  return {
    method: method.key as ShippingMethod,
    label: method.label,
    address: pickup ? pickup.address : address,
    city: pickup ? pickup.city : city,
    reference: String(s.reference ?? "").trim(),
    notes: String(s.notes ?? "")
      .trim()
      .slice(0, 500),
  };
}

/** Precio y stock salen de la base, nunca del carrito del navegador. */
export async function buildItems(raw: NonNullable<CheckoutInput["items"]>): Promise<IOrderItem[]> {
  if (!raw.length) throw new CustomError("Tu carrito está vacío", 400);
  const ids = [...new Set(raw.map((i) => String(i.productId ?? "")))];
  const products = await Product.find({ _id: { $in: ids }, isActive: true }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  return raw.map((line) => {
    const product = byId.get(String(line.productId));
    if (!product) throw new CustomError("Un producto del carrito ya no está disponible", 409);
    const qty = Number(line.qty);
    if (!Number.isInteger(qty) || qty < 1)
      throw new CustomError(`Cantidad inválida en ${product.name}`, 400);

    const variant = line.variantId
      ? product.variants.find((v) => String(v._id) === String(line.variantId))
      : undefined;
    if (product.variants.length && !variant) {
      throw new CustomError(`Elige una opción para ${product.name}`, 400);
    }
    if (variant && variant.stock < qty) {
      throw new CustomError(
        `Solo quedan ${variant.stock} de ${product.name} (${variant.label})`,
        409,
      );
    }
    const unitPrice = variant?.price ?? product.price;
    return {
      productId: String(product._id),
      variantId: variant ? String(variant._id) : null,
      name: product.name,
      variantLabel: variant?.label ?? "",
      image: product.images[0]?.url ?? "",
      unitPrice,
      qty,
      subtotal: round2(unitPrice * qty),
    };
  });
}

/** Devuelve false si alguna línea no pudo descontarse (se avisa al admin, no se bloquea la venta). */
export async function discountStock(items: IOrderItem[]): Promise<boolean> {
  let ok = true;
  for (const item of items) {
    if (!item.variantId) continue;
    try {
      await productService.reserveStock(item.productId, item.variantId, item.qty);
    } catch (error) {
      ok = false;
      console.error(`[orders] sin stock al confirmar ${item.name} (${item.variantLabel}):`, error);
    }
  }
  return ok;
}

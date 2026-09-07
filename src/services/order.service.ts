import { randomUUID } from "crypto";
import { env } from "../config/env";
import { isConnected } from "../config/mongo";
import { ORDER_STATUSES, OrderStatus, PICKUP_POINTS, SHIPPING_METHODS, ShippingMethod, isPickup } from "../config/shop";
import { CustomError } from "../errors/customError.error";
import { IOrder, IOrderItem, Order, nextOrderNumber } from "../models/order.model";
import { Product } from "../models/product.model";
import * as productService from "./product.service";
import * as payphone from "./payphone.service";
import { sendOrderPaid } from "./orderEmail.service";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PAGE_SIZE = 30;

export interface CheckoutInput {
  customer?: { name?: string; email?: string; phone?: string; documentId?: string };
  shipping?: { method?: string; address?: string; city?: string; reference?: string; notes?: string };
  items?: Array<{ productId?: string; variantId?: string | null; qty?: number }>;
}

function requireDb() {
  if (!isConnected()) throw new CustomError("El servidor no tiene base de datos disponible", 503);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function config() {
  return {
    shippingMethods: SHIPPING_METHODS,
    taxRate: env.TAX_RATE,
    payphone: payphone.isPayphoneConfigured() ? payphone.boxCredentials() : null,
  };
}

/** Montos en centavos, como los pide la cajita. `amount` debe ser la suma exacta. */
export function boxParams(order: IOrder) {
  const { token, storeId } = payphone.boxCredentials();
  return {
    token,
    storeId,
    clientTransactionId: order.clientTransactionId,
    amount: payphone.toCents(order.total),
    amountWithTax: payphone.toCents(order.subtotal),
    amountWithoutTax: payphone.toCents(order.shippingCost),
    tax: payphone.toCents(order.tax),
    service: 0,
    tip: 0,
    currency: "USD" as const,
    reference: `Pedido ${order.number} · Pantuflasec`,
    email: order.customer.email,
    phoneNumber: order.customer.phone,
    documentId: order.customer.documentId,
  };
}

export async function create(input: CheckoutInput, userId: string | null) {
  requireDb();
  const customer = validateCustomer(input.customer ?? {});
  const shipping = validateShipping(input.shipping ?? {});
  const items = await buildItems(input.items ?? []);

  const subtotal = round2(items.reduce((n, i) => n + i.subtotal, 0));
  const shippingCost = SHIPPING_METHODS.find((m) => m.key === shipping.method)!.cost;
  const tax = round2(subtotal * env.TAX_RATE);
  const total = round2(subtotal + shippingCost + tax);

  const order = await Order.create({
    number: await nextOrderNumber(),
    clientTransactionId: randomUUID(),
    userId,
    customer,
    shipping,
    items,
    subtotal,
    shippingCost,
    taxRate: env.TAX_RATE,
    tax,
    total,
  });

  return { order: order.toObject(), payphone: boxParams(order) };
}

/**
 * Cierra el pedido con la respuesta de PayPhone. Es idempotente: si el
 * cliente recarga /pay-response, el segundo confirm devuelve el pedido tal
 * cual sin volver a descontar stock ni reenviar correos.
 */
export async function confirm(payphoneId: number, clientTransactionId: string): Promise<IOrder> {
  requireDb();
  const order = await Order.findOne({ clientTransactionId });
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  if (order.payment.status === "paid") return order.toObject();

  const result = await payphone.confirm(payphoneId, clientTransactionId);
  order.payment.payphoneId = payphoneId;
  order.payment.message = result.message ?? result.transactionStatus ?? "";

  if (result.statusCode !== 3) {
    order.payment.status = result.statusCode === 2 ? "cancelled" : "failed";
    order.status = "cancelled";
    await order.save();
    return order.toObject();
  }

  // PayPhone cobra lo que se le pidió; si difiere, algo se manipuló en el navegador.
  if (result.amount !== undefined && result.amount !== payphone.toCents(order.total)) {
    console.error(`[orders] monto distinto en ${order.number}: ${result.amount} vs ${order.total}`);
  }

  order.payment.status = "paid";
  order.payment.authorizationCode = result.authorizationCode ?? "";
  order.payment.cardBrand = result.cardBrand ?? "";
  order.payment.paidAt = new Date();
  order.status = "paid";
  order.stockIssue = !(await discountStock(order.items));
  await order.save();

  await sendOrderPaid(order.toObject());
  return order.toObject();
}

export async function track(clientTransactionId: string): Promise<IOrder> {
  requireDb();
  const order = await Order.findOne({ clientTransactionId }).lean();
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  return order;
}

// --- Admin ---

export async function list(query: { status?: string; page?: string; q?: string }) {
  requireDb();
  const page = Math.max(1, Number(query.page) || 1);
  const filter: Record<string, unknown> = {};
  if (query.status && ORDER_STATUSES.includes(query.status as OrderStatus)) filter.status = query.status;
  if (query.q?.trim()) {
    const rx = new RegExp(query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ number: rx }, { "customer.name": rx }, { "customer.email": rx }, { "customer.phone": rx }];
  }
  const [items, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Order.countDocuments(filter),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getById(id: string): Promise<IOrder> {
  requireDb();
  const order = await Order.findById(id).lean();
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  return order;
}

export async function setStatus(id: string, status: string): Promise<IOrder> {
  requireDb();
  if (!ORDER_STATUSES.includes(status as OrderStatus)) {
    throw new CustomError(`Estado inválido. Usa uno de: ${ORDER_STATUSES.join(", ")}`, 400);
  }
  const order = await Order.findByIdAndUpdate(id, { status }, { new: true }).lean();
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  return order;
}

// --- Validación ---

function validateCustomer(c: NonNullable<CheckoutInput["customer"]>) {
  const name = String(c.name ?? "").trim();
  const email = String(c.email ?? "").trim().toLowerCase();
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

function validateShipping(s: NonNullable<CheckoutInput["shipping"]>) {
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
    notes: String(s.notes ?? "").trim().slice(0, 500),
  };
}

/** Precio y stock salen de la base, nunca del carrito del navegador. */
async function buildItems(raw: NonNullable<CheckoutInput["items"]>): Promise<IOrderItem[]> {
  if (!raw.length) throw new CustomError("Tu carrito está vacío", 400);
  const ids = [...new Set(raw.map((i) => String(i.productId ?? "")))];
  const products = await Product.find({ _id: { $in: ids }, isActive: true }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  return raw.map((line) => {
    const product = byId.get(String(line.productId));
    if (!product) throw new CustomError("Un producto del carrito ya no está disponible", 409);
    const qty = Number(line.qty);
    if (!Number.isInteger(qty) || qty < 1) throw new CustomError(`Cantidad inválida en ${product.name}`, 400);

    const variant = line.variantId
      ? product.variants.find((v) => String(v._id) === String(line.variantId))
      : undefined;
    if (product.variants.length && !variant) {
      throw new CustomError(`Elige una opción para ${product.name}`, 400);
    }
    if (variant && variant.stock < qty) {
      throw new CustomError(`Solo quedan ${variant.stock} de ${product.name} (${variant.label})`, 409);
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
async function discountStock(items: IOrderItem[]): Promise<boolean> {
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

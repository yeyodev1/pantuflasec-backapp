import { randomUUID } from "crypto";
import { env } from "../config/env";
import { isConnected } from "../config/mongo";
import {
  ORDER_STATUSES,
  OrderStatus,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PaymentMethod,
  PaymentStatus,
  SHIPPING_METHODS,
  isPickup,
} from "../config/shop";
import { CustomError } from "../errors/customError.error";
import { IOrder, Order, nextOrderNumber } from "../models/order.model";
import * as payphone from "./payphone.service";
import { sendOrderCreated, sendOrderLinks, sendOrderStatus } from "./orderEmail.service";
import { sendCashReserved, sendTransferInstructions } from "./paymentEmail.service";
import {
  CheckoutInput,
  buildItems,
  validateBilling,
  validateCustomer,
  validateShipping,
} from "./orderInput.service";
import { markPaid } from "./orderPayment.service";
import { getPayments } from "./setting.service";
import { logEvent } from "./orderEvent.service";

export type { CheckoutInput };
export { logEvent };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PAGE_SIZE = 30;

function requireDb() {
  if (!isConnected()) throw new CustomError("El servidor no tiene base de datos disponible", 503);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function config() {
  requireDb();
  const payments = await getPayments();
  return {
    shippingMethods: SHIPPING_METHODS,
    taxRate: env.TAX_RATE,
    /** Los precios del catálogo ya traen IVA: el checkout lo muestra, no lo suma. */
    taxIncluded: true,
    payphone: payphone.isPayphoneConfigured() ? payphone.boxCredentials() : null,
    payments,
  };
}

/**
 * Montos en centavos, como los pide la cajita. `amount` debe ser la suma
 * exacta: base gravada + IVA + lo no gravado (envío).
 */
export function boxParams(order: IOrder) {
  const { token, storeId } = payphone.boxCredentials();
  return {
    token,
    storeId,
    clientTransactionId: order.clientTransactionId,
    amount: payphone.toCents(order.total),
    amountWithTax: payphone.toCents(round2(order.subtotal - order.tax)),
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

/** Qué método eligió el cliente y si está disponible para ese pedido. */
async function validatePayment(
  raw: string | undefined,
  shippingMethod: string,
): Promise<PaymentMethod> {
  const method = (raw || "payphone") as PaymentMethod;
  if (!PAYMENT_METHODS.includes(method)) throw new CustomError("Elige cómo quieres pagar", 400);
  if (method === "payphone" && !payphone.isPayphoneConfigured()) {
    throw new CustomError("Los pagos con tarjeta no están disponibles por ahora", 503);
  }
  if (method !== "payphone") {
    const payments = await getPayments();
    if (method === "transfer" && !payments.transfer.enabled) {
      throw new CustomError("Las transferencias no están disponibles por ahora", 400);
    }
    if (method === "cash" && !payments.cash.enabled) {
      throw new CustomError("El pago en efectivo no está disponible por ahora", 400);
    }
    if (method === "cash" && !isPickup(shippingMethod)) {
      throw new CustomError("El pago en efectivo es solo para retiro en tienda", 400);
    }
  }
  return method;
}

export async function create(input: CheckoutInput, userId: string | null, siteUrl: string) {
  requireDb();
  const customer = validateCustomer(input.customer ?? {});
  const shipping = validateShipping(input.shipping ?? {});
  const billing = validateBilling(input.billing ?? {}, customer);
  const method = await validatePayment(input.payment?.method, shipping.method);
  const items = await buildItems(input.items ?? []);

  // Los precios ya incluyen IVA: se desglosa para la factura y PayPhone, no se suma.
  const subtotal = round2(items.reduce((n, i) => n + i.subtotal, 0));
  const shippingCost = SHIPPING_METHODS.find((m) => m.key === shipping.method)!.cost;
  const tax = round2(subtotal - subtotal / (1 + env.TAX_RATE));
  const total = round2(subtotal + shippingCost);

  const order = await Order.create({
    number: await nextOrderNumber(),
    clientTransactionId: randomUUID(),
    siteUrl,
    userId,
    customer,
    billing,
    shipping,
    items,
    subtotal,
    shippingCost,
    taxRate: env.TAX_RATE,
    tax,
    taxIncluded: true,
    total,
    payment: { method },
  });

  const plain = order.toObject();
  // No se espera: los correos no deben retrasar la respuesta al cliente.
  void logEvent(order.id, "created", `Pedido creado desde ${siteUrl}`, customer.name);
  void sendOrderCreated(plain).then((ok) =>
    logEvent(
      order.id,
      ok ? "email" : "email-failed",
      `Aviso al admin (${env.ADMIN_EMAIL}): nuevo pedido en espera de pago`,
      "sistema",
    ),
  );
  if (method === "transfer") {
    const { transfer } = await getPayments();
    void sendTransferInstructions(plain, transfer).then((ok) =>
      logEvent(
        order.id,
        ok ? "email" : "email-failed",
        `Datos de transferencia enviados a ${customer.email}`,
        "sistema",
      ),
    );
  } else if (method === "cash") {
    void sendCashReserved(plain).then((ok) =>
      logEvent(
        order.id,
        ok ? "email" : "email-failed",
        `Reserva con pago en tienda enviada a ${customer.email}`,
        "sistema",
      ),
    );
  }
  return { order: plain, payphone: method === "payphone" ? boxParams(order) : null };
}

export const EVENT_KINDS = ["contact-whatsapp", "contact-call", "contact-email", "note"] as const;

/** Contacto o nota que hace el equipo desde el panel. */
export async function addEvent(
  orderId: string,
  kind: string,
  detail: string,
  by: string,
): Promise<IOrder> {
  requireDb();
  if (!EVENT_KINDS.includes(kind as (typeof EVENT_KINDS)[number])) {
    throw new CustomError("Tipo de evento inválido", 400);
  }
  const order = await Order.findByIdAndUpdate(
    orderId,
    { $push: { events: { at: new Date(), kind, detail: String(detail ?? "").slice(0, 300), by } } },
    { new: true },
  ).lean();
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  return order;
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
    order.events.push({
      at: new Date(),
      kind: "payment-failed",
      detail: `PayPhone: ${order.payment.message || result.transactionStatus}`,
      by: "PayPhone",
    });
    await order.save();
    return order.toObject();
  }

  // PayPhone cobra lo que se le pidió; si difiere, algo se manipuló en el navegador.
  if (result.amount !== undefined && result.amount !== payphone.toCents(order.total)) {
    console.error(`[orders] monto distinto en ${order.number}: ${result.amount} vs ${order.total}`);
  }
  order.payment.authorizationCode = result.authorizationCode ?? "";
  order.payment.cardBrand = result.cardBrand ?? "";
  return markPaid(
    order,
    "PayPhone",
    `Pago aprobado · ${order.payment.cardBrand} · aut. ${order.payment.authorizationCode}`,
  );
}

export async function track(clientTransactionId: string): Promise<IOrder> {
  requireDb();
  const order = await Order.findOne({ clientTransactionId }).lean();
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  return order;
}

/**
 * Manda por correo los enlaces de los pedidos de ese correo. Responde igual
 * exista o no: el formulario no sirve para descubrir clientes.
 */
export async function lookupByEmail(rawEmail: string, siteUrl: string): Promise<void> {
  requireDb();
  const email = String(rawEmail ?? "")
    .trim()
    .toLowerCase();
  if (!EMAIL.test(email)) throw new CustomError("Escribe un correo válido", 400);
  const orders = await Order.find({ "customer.email": email })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();
  if (orders.length) void sendOrderLinks(email, orders, siteUrl);
}

// --- Admin ---

export async function list(query: { status?: string; page?: string; q?: string; pay?: string }) {
  requireDb();
  const page = Math.max(1, Number(query.page) || 1);
  const filter: Record<string, unknown> = {};
  if (query.status && ORDER_STATUSES.includes(query.status as OrderStatus))
    filter.status = query.status;
  if (query.pay && PAYMENT_STATUSES.includes(query.pay as PaymentStatus))
    filter["payment.status"] = query.pay;
  if (query.q?.trim()) {
    const rx = new RegExp(query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { number: rx },
      { "customer.name": rx },
      { "customer.email": rx },
      { "customer.phone": rx },
    ];
  }
  const [items, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
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

export async function setStatus(id: string, status: string, by = "equipo"): Promise<IOrder> {
  requireDb();
  if (!ORDER_STATUSES.includes(status as OrderStatus)) {
    throw new CustomError(`Estado inválido. Usa uno de: ${ORDER_STATUSES.join(", ")}`, 400);
  }
  const previous = await Order.findById(id).select("status").lean();
  if (!previous) throw new CustomError("Pedido no encontrado", 404);
  const order = await Order.findByIdAndUpdate(
    id,
    {
      status,
      $push: {
        events: { at: new Date(), kind: "status", detail: `${previous.status} → ${status}`, by },
      },
    },
    { new: true },
  ).lean();
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  if (previous.status !== order.status) {
    void sendOrderStatus(order).then((sent) => {
      if (sent)
        void logEvent(
          id,
          "email",
          `Correo "${status}" enviado a ${order.customer.email}`,
          "sistema",
        );
    });
  }
  return order;
}

/** Resumen para el header del admin: pedidos pagados por atender y comprobantes por revisar. */
export async function summary() {
  requireDb();
  const [paid, preparing, review, today] = await Promise.all([
    Order.countDocuments({ status: "paid" }),
    Order.countDocuments({ status: "preparing" }),
    Order.countDocuments({ "payment.status": "review" }),
    Order.countDocuments({
      "payment.status": "paid",
      createdAt: { $gte: new Date(Date.now() - 86_400_000) },
    }),
  ]);
  return { pending: paid + preparing + review, paid, preparing, review, today };
}

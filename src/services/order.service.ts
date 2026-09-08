import { randomUUID } from "crypto";
import { env } from "../config/env";
import { isConnected } from "../config/mongo";
import { PAYMENT_METHODS, PaymentMethod, isPickup } from "../config/shop";
import { CustomError } from "../errors/customError.error";
import { IOrder, Order, nextOrderNumber } from "../models/order.model";
import * as payphone from "./payphone.service";
import { sendOrderCreated, sendOrderLinks } from "./orderEmail.service";
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
import { MAX_DELIVERY_KM } from "../config/shop";
import { activeShipping } from "./shipping.service";
import { logEvent } from "./orderEvent.service";

export type { CheckoutInput };
export { logEvent };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function requireDb() {
  if (!isConnected()) throw new CustomError("El servidor no tiene base de datos disponible", 503);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function config() {
  requireDb();
  const [payments, shippingMethods] = await Promise.all([getPayments(), activeShipping()]);
  return {
    shippingMethods: shippingMethods.map(({ key, label, description, cost, kind }) => ({
      key,
      label,
      description,
      cost,
      kind,
    })),
    taxRate: env.TAX_RATE,
    /** Los precios del catálogo ya traen IVA: el checkout lo muestra, no lo suma. */
    taxIncluded: true,
    /** Radio de la entrega en moto y punto de salida, para el mapa del checkout. */
    delivery: { maxKm: MAX_DELIVERY_KM, origin: { lat: env.STORE_LAT, lng: env.STORE_LNG } },
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
  const { cost: shippingCost, ...shipping } = await validateShipping(input.shipping ?? {});
  const billing = validateBilling(input.billing ?? {}, customer);
  const method = await validatePayment(input.payment?.method, shipping.method);
  const items = await buildItems(input.items ?? []);

  // Los precios ya incluyen IVA: se desglosa para la factura y PayPhone, no se suma.
  const subtotal = round2(items.reduce((n, i) => n + i.subtotal, 0));
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
    /** Radio de la entrega en moto y punto de salida, para el mapa del checkout. */
    delivery: { maxKm: MAX_DELIVERY_KM, origin: { lat: env.STORE_LAT, lng: env.STORE_LNG } },
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

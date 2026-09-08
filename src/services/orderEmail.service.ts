import { env } from "../config/env";
import { PAYMENT_METHOD_LABELS } from "../config/shop";
import { IOrder } from "../models/order.model";
import { layout, sendEmail } from "./email.service";

export const money = (n: number) => `$${n.toFixed(2)}`;
export const base = (order: IOrder) => (order.siteUrl || env.FRONTEND_URL).replace(/\/$/, "");

/** Cómo se pagó (o se va a pagar), para los correos del admin. */
function paymentLine(order: IOrder): string {
  const label = PAYMENT_METHOD_LABELS[order.payment.method] ?? order.payment.method;
  if (order.payment.method === "payphone" && order.payment.authorizationCode) {
    return `${label} · ${order.payment.cardBrand} · aut. ${order.payment.authorizationCode}`;
  }
  return label;
}

/** Entrega en moto: el punto exacto para el motorizado, con los km cotizados. */
export function mapsLink(order: IOrder): string {
  const c = order.shipping.coords;
  if (!c) return "";
  const km = order.shipping.km != null ? ` · ${order.shipping.km} km` : "";
  return ` · <a href="https://www.google.com/maps?q=${c.lat},${c.lng}">Ver en Google Maps</a>${km}`;
}

export function itemsTable(order: IOrder): string {
  const rows = order.items
    .map(
      (i) => `<tr>
        <td style="padding:6px 0">${i.name}${i.variantLabel ? ` <span style="color:#71717a">(${i.variantLabel})</span>` : ""} × ${i.qty}</td>
        <td align="right" style="padding:6px 0">${money(i.subtotal)}</td></tr>`,
    )
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eee;border-bottom:1px solid #eee;margin:16px 0">
    ${rows}
    <tr><td style="padding:6px 0;color:#71717a">Envío · ${order.shipping.label}</td><td align="right">${money(order.shippingCost)}</td></tr>
    <tr><td style="padding:6px 0;color:#71717a">${order.taxIncluded ? "IVA incluido en el precio" : "IVA"}</td><td align="right" style="color:#71717a">${money(order.tax)}</td></tr>
    <tr><td style="padding:10px 0;font-weight:bold">Total</td><td align="right" style="font-weight:bold">${money(order.total)}</td></tr>
  </table>`;
}

/** Al cliente: confirmación de pago. Al admin: aviso para preparar. Nunca lanza. */
export async function sendOrderPaid(order: IOrder): Promise<boolean> {
  const link = `${base(order)}/pedido/${order.clientTransactionId}`;
  const address = order.shipping.method.startsWith("pickup")
    ? `${order.shipping.label}: ${order.shipping.address}, ${order.shipping.city}.`
    : `${order.shipping.address}, ${order.shipping.city}${order.shipping.reference ? ` (${order.shipping.reference})` : ""}${mapsLink(order)}`;

  const sent = await sendEmail(
    order.customer.email,
    `Pedido ${order.number} confirmado — Pantuflasec`,
    layout(
      base(order),
      `¡Gracias, ${order.customer.name.split(" ")[0]}!`,
      `<p>Recibimos tu pago y ya estamos preparando tu pedido <strong>${order.number}</strong>.</p>
       ${itemsTable(order)}
       <p><strong>Entrega:</strong> ${address}</p>
       <p>Puedes ver el estado en <a href="${link}">${link}</a>.</p>
       <p>Si tienes dudas, escríbenos por WhatsApp al 098 240 1562.</p>`,
    ),
  );

  void sendEmail(
    env.ADMIN_EMAIL,
    `Nuevo pedido pagado ${order.number} · ${money(order.total)}`,
    layout(
      base(order),
      `Pedido ${order.number}`,
      `<p><strong>${order.customer.name}</strong> · ${order.customer.email} · ${order.customer.phone}</p>
       ${itemsTable(order)}
       <p><strong>Entrega:</strong> ${address}</p>
       ${order.shipping.notes ? `<p><strong>Notas:</strong> ${order.shipping.notes}</p>` : ""}
       ${order.billing?.wanted ? `<p><strong>Factura:</strong> ${order.billing.name} · ${order.billing.documentId} · ${order.billing.email}${order.billing.phone ? ` · ${order.billing.phone}` : ""}</p>` : "<p>Sin factura.</p>"}
       ${order.stockIssue ? `<p style="color:#c2554f"><strong>Atención:</strong> no se pudo descontar stock de algún ítem. Revisar inventario.</p>` : ""}
       <p><strong>Pago:</strong> ${paymentLine(order)}</p>`,
    ),
  );
  return sent;
}

const STATUS_COPY: Record<string, { subject: string; title: string; text: string }> = {
  preparing: {
    subject: "Tu pedido ya está empacado",
    title: "¡Empacado y listo!",
    text: "Armamos tu pedido con mucho cuidado y ya está empacado. Te avisamos en cuanto salga en camino o esté listo para retirar.",
  },
  shipped: {
    subject: "Tu pedido va en camino",
    title: "¡Salió tu pedido!",
    text: "Tu pedido ya está en camino. Si elegiste retiro en tienda, ya puedes pasar a recogerlo.",
  },
  delivered: {
    subject: "Tu pedido fue entregado",
    title: "¡Entregado!",
    text: "Esperamos que lo disfrutes. Si algo no llegó como esperabas, escríbenos por WhatsApp y lo resolvemos.",
  },
  cancelled: {
    subject: "Tu pedido fue cancelado",
    title: "Pedido cancelado",
    text: "Tu pedido quedó cancelado. Si fue un error o tienes dudas sobre el reembolso, escríbenos por WhatsApp.",
  },
};

/** Al cliente cuando el admin cambia el estado. Estados sin copy (pending, paid) no mandan nada. */
export async function sendOrderStatus(order: IOrder): Promise<boolean> {
  const copy = STATUS_COPY[order.status];
  if (!copy) return false;
  const link = `${base(order)}/pedido/${order.clientTransactionId}`;
  return sendEmail(
    order.customer.email,
    `${copy.subject} · ${order.number}`,
    layout(
      base(order),
      copy.title,
      `<p>Hola ${order.customer.name.split(" ")[0]}, ${copy.text}</p>
       ${itemsTable(order)}
       <p><strong>Entrega:</strong> ${order.shipping.label}${order.shipping.address ? ` · ${order.shipping.address}, ${order.shipping.city}` : ""}</p>
       <p>Sigue tu pedido en <a href="${link}">${link}</a>.</p>`,
    ),
  );
}

/** Al admin apenas se crea un pedido (aún sin pagar): para tener visibilidad de intentos de compra. */
export async function sendOrderCreated(order: IOrder): Promise<boolean> {
  return sendEmail(
    env.ADMIN_EMAIL,
    `Nuevo pedido ${order.number} en espera de pago · ${money(order.total)}`,
    layout(
      base(order),
      `Pedido ${order.number} creado`,
      `<p><strong>${order.customer.name}</strong> · ${order.customer.email} · ${order.customer.phone}</p>
       ${itemsTable(order)}
       <p><strong>Pago:</strong> ${paymentLine(order)}.</p>
       <p>${order.payment.method === "payphone" ? "Cuando PayPhone confirme el cobro te llega otro correo." : order.payment.method === "transfer" ? "Cuando el cliente suba el comprobante te llega otro correo para aprobarlo desde el panel." : "El cliente paga en efectivo al retirar: registra el pago desde el panel."}</p>`,
    ),
  );
}

/**
 * "Mis pedidos" desde otro dispositivo: se manda al correo la lista con sus
 * enlaces de seguimiento. Así nadie ve pedidos ajenos con solo saber un correo.
 */
export async function sendOrderLinks(
  email: string,
  orders: IOrder[],
  siteUrl: string,
): Promise<void> {
  const rows = orders
    .map(
      (o) => `<tr>
        <td style="padding:8px 0"><strong>${o.number}</strong><br><span style="color:#71717a;font-size:13px">${new Date(o.createdAt ?? Date.now()).toLocaleDateString("es-EC")} · ${money(o.total)}</span></td>
        <td align="right" style="padding:8px 0"><a href="${(o.siteUrl || siteUrl).replace(/\/$/, "")}/pedido/${o.clientTransactionId}" style="background:#2f7ce6;color:#fff;padding:8px 14px;border-radius:999px;text-decoration:none;font-size:13px">Ver pedido</a></td></tr>`,
    )
    .join("");
  await sendEmail(
    email,
    "Tus pedidos en Pantuflas Ecuador",
    layout(
      siteUrl,
      "Aquí están tus pedidos",
      `<p>Estos son los pedidos hechos con este correo. Toca "Ver pedido" para seguir cada uno.</p>
       <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eee">${rows}</table>
       <p style="color:#71717a;font-size:13px">Si no pediste este correo, ignóralo.</p>`,
    ),
  );
}

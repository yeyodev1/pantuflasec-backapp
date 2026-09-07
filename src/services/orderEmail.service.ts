import { env } from "../config/env";
import { IOrder } from "../models/order.model";
import { layout, sendEmail } from "./email.service";

const money = (n: number) => `$${n.toFixed(2)}`;

function itemsTable(order: IOrder): string {
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
    <tr><td style="padding:6px 0;color:#71717a">IVA</td><td align="right">${money(order.tax)}</td></tr>
    <tr><td style="padding:10px 0;font-weight:bold">Total</td><td align="right" style="font-weight:bold">${money(order.total)}</td></tr>
  </table>`;
}

/** Al cliente: confirmación de pago. Al admin: aviso para preparar. Nunca lanza. */
export async function sendOrderPaid(order: IOrder): Promise<void> {
  const link = `${env.FRONTEND_URL}/pedido/${order.clientTransactionId}`;
  const address =
    order.shipping.method === "pickup"
      ? "Retiro en tienda: La Garzota, av. Agustín Freire frente al Garzocentro, Guayaquil."
      : `${order.shipping.address}, ${order.shipping.city}${order.shipping.reference ? ` (${order.shipping.reference})` : ""}`;

  await sendEmail(
    order.customer.email,
    `Pedido ${order.number} confirmado — Pantuflasec`,
    layout(
      `¡Gracias, ${order.customer.name.split(" ")[0]}!`,
      `<p>Recibimos tu pago y ya estamos preparando tu pedido <strong>${order.number}</strong>.</p>
       ${itemsTable(order)}
       <p><strong>Entrega:</strong> ${address}</p>
       <p>Puedes ver el estado en <a href="${link}">${link}</a>.</p>
       <p>Si tienes dudas, escríbenos por WhatsApp al 098 240 1562.</p>`,
    ),
  );

  await sendEmail(
    env.ADMIN_EMAIL,
    `Nuevo pedido pagado ${order.number} · ${money(order.total)}`,
    layout(
      `Pedido ${order.number}`,
      `<p><strong>${order.customer.name}</strong> · ${order.customer.email} · ${order.customer.phone}</p>
       ${itemsTable(order)}
       <p><strong>Entrega:</strong> ${address}</p>
       ${order.shipping.notes ? `<p><strong>Notas:</strong> ${order.shipping.notes}</p>` : ""}
       ${order.stockIssue ? `<p style="color:#c2554f"><strong>Atención:</strong> no se pudo descontar stock de algún ítem. Revisar inventario.</p>` : ""}
       <p>PayPhone: ${order.payment.authorizationCode} · ${order.payment.cardBrand}</p>`,
    ),
  );
}

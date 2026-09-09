import { env } from "../config/env";
import { PAYMENT_METHOD_LABELS } from "../config/shop";
import { IOrder } from "../models/order.model";
import { layout, sendEmail } from "./email.service";
import { base, itemsTable, money } from "./orderEmail.service";
import { PaymentSettings } from "./setting.service";

/** Correos de transferencia, efectivo y mensajes. Ninguno lanza. */

const trackLink = (o: IOrder) => `${base(o)}/pedido/${o.clientTransactionId}`;
const adminLink = (o: IOrder) => `${base(o)}/admin/pedidos/${String((o as any)._id)}`;
const first = (o: IOrder) => o.customer.name.split(" ")[0];

export function accountsTable(accounts: PaymentSettings["transfer"]["accounts"]): string {
  return accounts
    .map(
      (
        a,
      ) => `<div style="border:1px solid #efe6c9;border-radius:12px;padding:12px 16px;margin:10px 0">
        ${a.showLogo && a.logo?.url ? `<img src="${a.logo.url}" alt="" width="36" height="36" style="vertical-align:middle;border-radius:8px;margin-right:8px">` : ""}<strong>${a.bank}</strong>${a.type ? ` · ${a.type}` : ""}<br>
        <span style="font-size:18px;letter-spacing:0.04em">${a.number}</span><br>
        <span style="color:#4a5472">${a.holder}${a.documentId ? ` · ${a.documentId}` : ""}${a.email ? ` · ${a.email}` : ""}</span>
      </div>`,
    )
    .join("");
}

/** Al cliente al crear un pedido por transferencia: cuentas, monto y dónde subir el comprobante. */
const WA = `<a href="https://wa.me/593982401562" style="color:#2f7ce6">WhatsApp +593 98 240 1562</a>`;

export async function sendTransferInstructions(
  order: IOrder,
  transfer: PaymentSettings["transfer"],
): Promise<boolean> {
  return sendEmail(
    order.customer.email,
    `Pedido ${order.number}: datos para tu transferencia`,
    layout(
      base(order),
      `¡Gracias, ${first(order)}!`,
      `<p>Reservamos tu pedido <strong>${order.number}</strong>. Para confirmarlo, transfiere <strong>${money(order.total)}</strong>${transfer.accounts.length ? " a una de estas cuentas:" : "."}</p>
       ${transfer.accounts.length ? accountsTable(transfer.accounts) : `<p>Escríbenos por ${WA} y te pasamos los datos de la cuenta.</p>`}
       <p style="color:#4a5472">${transfer.instructions}</p>
       <p>Luego sube la captura del comprobante en <a href="${trackLink(order)}">${trackLink(order)}</a>. Apenas la revisemos te avisamos por aquí.</p>
       ${itemsTable(order)}`,
    ),
  );
}

/** Al cliente al reservar con pago en efectivo al retirar. */
export async function sendCashReserved(order: IOrder): Promise<boolean> {
  return sendEmail(
    order.customer.email,
    `Pedido ${order.number} reservado · paga al retirar`,
    layout(
      base(order),
      `¡Listo, ${first(order)}!`,
      `<p>Reservamos tu pedido <strong>${order.number}</strong>. Pagas <strong>${money(order.total)}</strong> en efectivo al retirarlo en <strong>${order.shipping.label}</strong> (${order.shipping.address}, ${order.shipping.city}).</p>
       <p>Te avisamos por correo cuando esté listo. Puedes seguirlo en <a href="${trackLink(order)}">${trackLink(order)}</a>.</p>
       ${itemsTable(order)}`,
    ),
  );
}

/** Al admin: hay un comprobante para revisar. */
export async function sendProofReceived(order: IOrder): Promise<boolean> {
  return sendEmail(
    env.ADMIN_EMAIL,
    `Comprobante recibido · ${order.number} · ${money(order.total)}`,
    layout(
      base(order),
      `Revisar transferencia de ${order.number}`,
      `<p><strong>${order.customer.name}</strong> · ${order.customer.email} · ${order.customer.phone}</p>
       ${order.payment.proof.note ? `<p><strong>Nota del cliente:</strong> ${order.payment.proof.note}</p>` : ""}
       <p><a href="${order.payment.proof.url}">Ver comprobante</a></p>
       <p><a href="${adminLink(order)}" style="background:#2f7ce6;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Aprobar o rechazar en el panel</a></p>
       ${itemsTable(order)}`,
    ),
  );
}

/** Al cliente: recibimos el comprobante, estamos revisando. */
export async function sendProofAck(order: IOrder): Promise<boolean> {
  return sendEmail(
    order.customer.email,
    `Recibimos tu comprobante · ${order.number}`,
    layout(
      base(order),
      "¡Comprobante recibido!",
      `<p>Hola ${first(order)}, ya tenemos la captura de tu transferencia para el pedido <strong>${order.number}</strong>. La revisamos y te confirmamos por correo, normalmente el mismo día.</p>
       <p>Sigue tu pedido en <a href="${trackLink(order)}">${trackLink(order)}</a>.</p>`,
    ),
  );
}

/** Al cliente: el comprobante no pasó; puede subir otro o escribir. */
export async function sendPaymentRejected(order: IOrder): Promise<boolean> {
  return sendEmail(
    order.customer.email,
    `Revisa tu transferencia · ${order.number}`,
    layout(
      base(order),
      "No pudimos validar el comprobante",
      `<p>Hola ${first(order)}, revisamos la transferencia de tu pedido <strong>${order.number}</strong> y hubo un problema:</p>
       <p style="background:#fff6d6;border-radius:10px;padding:12px 16px"><strong>${order.payment.rejectReason}</strong></p>
       <p>Puedes subir otro comprobante o escribirnos desde <a href="${trackLink(order)}">${trackLink(order)}</a>. Tu pedido sigue reservado.</p>`,
    ),
  );
}

/** Al admin: el cliente escribió desde el seguimiento. */
export async function sendCustomerMessage(order: IOrder, text: string): Promise<boolean> {
  return sendEmail(
    env.ADMIN_EMAIL,
    `Mensaje de ${order.customer.name} · ${order.number}`,
    layout(
      base(order),
      `Mensaje en el pedido ${order.number}`,
      `<p><strong>${order.customer.name}</strong> (${PAYMENT_METHOD_LABELS[order.payment.method]}) escribió:</p>
       <p style="background:#fff6d6;border-radius:10px;padding:12px 16px;white-space:pre-line">${text}</p>
       <p><a href="${adminLink(order)}" style="background:#2f7ce6;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Responder desde el panel</a></p>`,
    ),
  );
}

/** Al cliente: el equipo respondió. */
export async function sendTeamMessage(order: IOrder, text: string): Promise<boolean> {
  return sendEmail(
    order.customer.email,
    `Respuesta sobre tu pedido ${order.number}`,
    layout(
      base(order),
      `Te respondimos, ${first(order)}`,
      `<p style="background:#fff6d6;border-radius:10px;padding:12px 16px;white-space:pre-line">${text}</p>
       <p>Puedes contestar desde <a href="${trackLink(order)}">${trackLink(order)}</a>.</p>`,
    ),
  );
}

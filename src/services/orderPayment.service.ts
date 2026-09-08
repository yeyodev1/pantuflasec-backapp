import { HydratedDocument } from "mongoose";
import { isConnected } from "../config/mongo";
import { CustomError } from "../errors/customError.error";
import { IOrder, Order } from "../models/order.model";
import { uploadBuffer } from "./cloudinary.service";
import { sendOrderPaid } from "./orderEmail.service";
import { logEvent } from "./orderEvent.service";
import { discountStock } from "./orderInput.service";
import { sendPaymentRejected, sendProofAck, sendProofReceived } from "./paymentEmail.service";

/**
 * Pagos que no confirma PayPhone: el cliente sube el comprobante de la
 * transferencia y el equipo lo aprueba o rechaza; el efectivo se registra al
 * retirar. Aprobar hace lo mismo que un cobro con tarjeta: stock y correos.
 */

// Fuera de `pantuflasec/` para que no aparezca en la biblioteca del admin.
const PROOF_FOLDER = "pantuflasec-comprobantes";

function requireDb() {
  if (!isConnected()) throw new CustomError("El servidor no tiene base de datos disponible", 503);
}

/** Cierra el cobro: estado, stock, historial y correos. Común a tarjeta, transferencia y efectivo. */
export async function markPaid(
  order: HydratedDocument<IOrder>,
  by: string,
  detail: string,
): Promise<IOrder> {
  order.payment.status = "paid";
  order.payment.paidAt = new Date();
  order.payment.rejectReason = "";
  // Un pedido en efectivo puede estar ya empacado o listo: no se lo regresa a "pagado".
  if (order.status === "pending_payment" || order.status === "cancelled") order.status = "paid";
  order.stockIssue = !(await discountStock(order.items));
  order.events.push({ at: new Date(), kind: "paid", detail, by });
  await order.save();

  const sent = await sendOrderPaid(order.toObject());
  await logEvent(
    order.id,
    sent ? "email" : "email-failed",
    `Confirmación de pago a ${order.customer.email} y aviso al admin`,
    "sistema",
  );
  return order.toObject();
}

export interface ProofFile {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
}

/** El cliente sube la captura desde el seguimiento (solo con el token del pedido). */
export async function uploadProof(
  clientTransactionId: string,
  file: ProofFile | undefined,
  rawNote: string,
): Promise<IOrder> {
  requireDb();
  if (!file) throw new CustomError("Adjunta la captura o foto del comprobante", 400);
  const isImage =
    file.mimetype.startsWith("image/") || /\.(png|jpe?g|webp|heic)$/i.test(file.originalname ?? "");
  if (!isImage) throw new CustomError("El comprobante debe ser una imagen (captura o foto)", 400);

  const order = await Order.findOne({ clientTransactionId });
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  if (order.payment.method !== "transfer")
    throw new CustomError("Este pedido no se paga por transferencia", 400);
  if (order.payment.status === "paid") throw new CustomError("Este pedido ya está pagado", 409);
  if (order.status === "cancelled") {
    throw new CustomError(
      "Este pedido está cancelado. Escríbenos por WhatsApp si quieres retomarlo",
      409,
    );
  }

  const { url, publicId } = await uploadBuffer(file.buffer, PROOF_FOLDER);
  const note = String(rawNote ?? "")
    .trim()
    .slice(0, 300);
  order.payment.proof = { url, publicId, note, uploadedAt: new Date() };
  order.payment.status = "review";
  order.payment.rejectReason = "";
  order.events.push({
    at: new Date(),
    kind: "proof",
    detail: note ? `Comprobante subido · "${note}"` : "Comprobante subido",
    by: order.customer.name,
  });
  await order.save();

  const plain = order.toObject();
  void sendProofReceived(plain).then((ok) =>
    logEvent(
      order.id,
      ok ? "email" : "email-failed",
      "Aviso al admin: comprobante por revisar",
      "sistema",
    ),
  );
  void sendProofAck(plain);
  return plain;
}

/** El equipo aprueba (transferencia o efectivo) o rechaza (solo transferencia, con motivo). */
export async function review(
  id: string,
  action: string,
  rawReason: string,
  by: string,
): Promise<IOrder> {
  requireDb();
  const order = await Order.findById(id);
  if (!order) throw new CustomError("Pedido no encontrado", 404);
  if (order.payment.method === "payphone")
    throw new CustomError("Los pagos con tarjeta los confirma PayPhone", 400);
  if (order.payment.status === "paid") throw new CustomError("Este pedido ya está pagado", 409);

  order.payment.reviewedBy = by;
  order.payment.reviewedAt = new Date();

  if (action === "approve") {
    const detail =
      order.payment.method === "transfer"
        ? "Transferencia aprobada"
        : "Pago en efectivo registrado en tienda";
    return markPaid(order, by, detail);
  }
  if (action === "reject") {
    if (order.payment.method !== "transfer")
      throw new CustomError("Solo se rechazan comprobantes de transferencia", 400);
    const reason =
      String(rawReason ?? "")
        .trim()
        .slice(0, 300) || "No pudimos validar el comprobante";
    order.payment.status = "rejected";
    order.payment.rejectReason = reason;
    order.events.push({ at: new Date(), kind: "payment-rejected", detail: reason, by });
    await order.save();
    const plain = order.toObject();
    void sendPaymentRejected(plain).then((ok) =>
      logEvent(
        order.id,
        ok ? "email" : "email-failed",
        `Aviso de rechazo a ${order.customer.email}`,
        "sistema",
      ),
    );
    return plain;
  }
  throw new CustomError("Acción inválida: usa approve o reject", 400);
}

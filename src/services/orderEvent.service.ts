import { Order } from "../models/order.model";

/**
 * Anota un hecho en el historial del pedido. Nunca lanza: es solo registro.
 * Vive aparte para que los servicios de pago y mensajes lo usen sin importar
 * `order.service` en círculo.
 */
export async function logEvent(
  orderId: string,
  kind: string,
  detail: string,
  by: string,
): Promise<void> {
  try {
    await Order.updateOne(
      { _id: orderId },
      { $push: { events: { at: new Date(), kind, detail, by } } },
    );
  } catch (error) {
    console.error("[orders] no se pudo registrar el evento:", error);
  }
}

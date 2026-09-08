import { isConnected } from "../config/mongo";
import { CustomError } from "../errors/customError.error";
import { IOrder, Order } from "../models/order.model";
import { logEvent } from "./orderEvent.service";
import { sendCustomerMessage, sendTeamMessage } from "./paymentEmail.service";

/**
 * Conversación sobre el pedido. El cliente escribe desde el seguimiento (con
 * el token) y el equipo desde el panel; cada mensaje avisa por correo al otro
 * lado con el enlace para responder.
 */
function requireDb() {
  if (!isConnected()) throw new CustomError("El servidor no tiene base de datos disponible", 503);
}

export async function addMessage(
  filter: { clientTransactionId: string } | { _id: string },
  from: "customer" | "team",
  by: string,
  rawText: string,
): Promise<IOrder> {
  requireDb();
  const text = String(rawText ?? "")
    .trim()
    .slice(0, 1000);
  if (text.length < 2) throw new CustomError("Escribe un mensaje", 400);

  const order = await Order.findOneAndUpdate(
    filter,
    { $push: { messages: { at: new Date(), from, by, text } } },
    { new: true },
  ).lean();
  if (!order) throw new CustomError("Pedido no encontrado", 404);

  const id = String(order._id);
  if (from === "customer") {
    void sendCustomerMessage(order, text).then((ok) =>
      logEvent(id, ok ? "email" : "email-failed", "Aviso al admin: mensaje del cliente", "sistema"),
    );
  } else {
    void sendTeamMessage(order, text).then((ok) =>
      logEvent(
        id,
        ok ? "email" : "email-failed",
        `Respuesta enviada a ${order.customer.email}`,
        "sistema",
      ),
    );
  }
  return order;
}

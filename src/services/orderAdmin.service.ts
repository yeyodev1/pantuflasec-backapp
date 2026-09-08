import { isConnected } from "../config/mongo";
import { ORDER_STATUSES, OrderStatus, PAYMENT_STATUSES, PaymentStatus } from "../config/shop";
import { CustomError } from "../errors/customError.error";
import { IOrder, Order } from "../models/order.model";
import { sendOrderStatus } from "./orderEmail.service";
import { logEvent } from "./orderEvent.service";

/** Lo que el equipo hace desde el panel: listar, ver, cambiar estado y el contador del header. */

const PAGE_SIZE = 30;

function requireDb() {
  if (!isConnected()) throw new CustomError("El servidor no tiene base de datos disponible", 503);
}

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

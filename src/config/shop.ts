/**
 * Reglas comerciales de la tienda. Viven en código y no en la base porque
 * cambian con el negocio, no con el día a día; el front las lee por el API.
 * Lo que sí edita el admin (cuentas bancarias, portada) está en `Setting`.
 */
/** Puntos de retiro. La dirección se copia al pedido para que salga en correos y seguimiento. */
export const PICKUP_POINTS: Record<string, { name: string; address: string; city: string }> = {
  "pickup-garzota": {
    name: "La Garzota",
    address: "Av. Agustín Freire, frente al Garzocentro",
    city: "Guayaquil",
  },
  "pickup-joya": {
    name: "La Joya",
    address: "Plaza Sevilla, urbanización La Joya",
    city: "Daule",
  },
};

/** Métodos de entrega iniciales. El admin los edita en `Setting` (`shipping.service.ts`). */
export const SHIPPING_METHODS = [
  { key: "pickup-garzota", label: "Retiro en La Garzota (Guayaquil)", cost: 0 },
  { key: "pickup-joya", label: "Retiro en La Joya (Plaza Sevilla)", cost: 0 },
  { key: "gye", label: "Envío en Guayaquil", cost: 3 },
  { key: "ec", label: "Envío a provincias (Servientrega, 24 a 72 h)", cost: 6 },
] as const;
/** Las claves las genera el admin: los retiros siempre empiezan con `pickup-`. */
export type ShippingMethod = string;
export const isPickup = (key: string) => key.startsWith("pickup");

export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "preparing",
  "shipped",
  "delivered",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Cómo paga el cliente. Tarjeta la confirma PayPhone; transferencia y efectivo
 * los aprueba el equipo desde el panel (con comprobante en el caso de la
 * transferencia). Efectivo solo aplica al retirar en tienda.
 */
export const PAYMENT_METHODS = ["payphone", "transfer", "cash"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  payphone: "Tarjeta (PayPhone)",
  transfer: "Transferencia bancaria",
  cash: "Efectivo en tienda",
};

/** `review` = el cliente subió comprobante y el equipo aún no lo revisa. */
export const PAYMENT_STATUSES = [
  "pending",
  "review",
  "paid",
  "rejected",
  "failed",
  "cancelled",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

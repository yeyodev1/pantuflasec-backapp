/**
 * Reglas comerciales de la tienda. Viven en código y no en la base porque
 * cambian con el negocio, no con el día a día; el front las lee por el API.
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

export const SHIPPING_METHODS = [
  { key: "pickup-garzota", label: "Retiro en La Garzota (Guayaquil)", cost: 0 },
  { key: "pickup-joya", label: "Retiro en La Joya (Plaza Sevilla)", cost: 0 },
  { key: "gye", label: "Envío en Guayaquil", cost: 3 },
  { key: "ec", label: "Envío a provincias (Servientrega, 24 a 72 h)", cost: 6 },
] as const;
export type ShippingMethod = (typeof SHIPPING_METHODS)[number]["key"];
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

export const PAYMENT_STATUSES = ["pending", "paid", "failed", "cancelled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

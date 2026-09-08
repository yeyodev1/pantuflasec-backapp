import { isConnected } from "../config/mongo";
import { PICKUP_POINTS, SHIPPING_METHODS } from "../config/shop";
import { CustomError } from "../errors/customError.error";
import { Setting } from "../models/setting.model";
import { slugify } from "../utils/slugify";

/**
 * Métodos de entrega que el admin edita desde el panel (tarifas por zona,
 * courier de flores, nuevos puntos de retiro). Los de `config/shop.ts` son
 * solo el arranque. La clave de un retiro empieza con `pickup-`: el resto del
 * sistema (correos, front, efectivo en tienda) distingue retiro por ese prefijo.
 */
export interface ShippingMethodSetting {
  key: string;
  label: string;
  /** Texto corto bajo el nombre en el checkout: tiempos, courier, zona. */
  description: string;
  cost: number;
  kind: "pickup" | "delivery";
  /** Solo retiro: se copia al pedido para correos y seguimiento. */
  address: string;
  city: string;
  enabled: boolean;
}

const DESCRIPTIONS: Record<string, string> = {
  "pickup-garzota": "Te avisamos cuando esté listo.",
  "pickup-joya": "Te avisamos cuando esté listo.",
  gye: "Entrega en la ciudad en 1 a 2 días hábiles.",
  ec: "Servientrega a todo el país, de 24 a 72 horas.",
};

export const SHIPPING_DEFAULTS: ShippingMethodSetting[] = SHIPPING_METHODS.map((m) => {
  const pickup = PICKUP_POINTS[m.key];
  return {
    key: m.key,
    label: m.label,
    description: DESCRIPTIONS[m.key] ?? "",
    cost: m.cost,
    kind: pickup ? "pickup" : "delivery",
    address: pickup?.address ?? "",
    city: pickup?.city ?? "",
    enabled: true,
  };
});

function requireDb() {
  if (!isConnected()) throw new CustomError("El servidor no tiene base de datos disponible", 503);
}

const text = (v: unknown, max: number) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Todos, incluidos los apagados (panel). */
export async function getShipping(): Promise<ShippingMethodSetting[]> {
  requireDb();
  const doc = await Setting.findOne({ key: "shipping" }).lean();
  const saved = (doc?.value as { methods?: ShippingMethodSetting[] } | undefined)?.methods;
  return Array.isArray(saved) && saved.length ? saved : SHIPPING_DEFAULTS;
}

/** Solo los activos, en orden (checkout). */
export async function activeShipping(): Promise<ShippingMethodSetting[]> {
  return (await getShipping()).filter((m) => m.enabled);
}

export async function findShipping(key: string): Promise<ShippingMethodSetting | undefined> {
  return (await activeShipping()).find((m) => m.key === key);
}

export async function setShipping(input: { methods?: unknown }): Promise<ShippingMethodSetting[]> {
  requireDb();
  if (!Array.isArray(input.methods)) throw new CustomError("Se esperaba una lista de métodos", 400);
  const seen = new Set<string>();
  const methods = input.methods.map((raw: any, i: number): ShippingMethodSetting => {
    const label = text(raw?.label, 80);
    if (!label) throw new CustomError(`El método ${i + 1} necesita un nombre`, 400);
    const kind: ShippingMethodSetting["kind"] = raw?.kind === "pickup" ? "pickup" : "delivery";
    const cost = round2(Number(raw?.cost ?? 0));
    if (!Number.isFinite(cost) || cost < 0)
      throw new CustomError(`Precio inválido en "${label}"`, 400);
    // La clave se conserva si ya existía (los pedidos viejos la referencian); si es nueva, sale del nombre.
    const prefix = kind === "pickup" ? "pickup-" : "envio-";
    let key = text(raw?.key, 80);
    if (!key || (kind === "pickup") !== key.startsWith("pickup"))
      key = `${prefix}${slugify(label)}`;
    if (seen.has(key))
      throw new CustomError(`Hay dos métodos con el mismo nombre: "${label}"`, 400);
    seen.add(key);
    const address = text(raw?.address, 160);
    const city = text(raw?.city, 60);
    if (kind === "pickup" && (!address || !city)) {
      throw new CustomError(`El retiro "${label}" necesita dirección y ciudad`, 400);
    }
    return {
      key,
      label,
      description: text(raw?.description, 160),
      cost,
      kind,
      address,
      city,
      enabled: raw?.enabled !== false,
    };
  });
  if (!methods.some((m) => m.enabled))
    throw new CustomError("Deja al menos un método de entrega activo", 400);
  await Setting.updateOne({ key: "shipping" }, { value: { methods } }, { upsert: true });
  return methods;
}

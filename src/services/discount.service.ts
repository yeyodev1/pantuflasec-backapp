import { isConnected } from "../config/mongo";
import { CustomError } from "../errors/customError.error";
import { CATEGORIES, Category, IProduct } from "../models/product.model";
import { Setting } from "../models/setting.model";

/**
 * Descuento por categoría (Black Friday: tazas 20 %, pantuflas 10 %...).
 * Se aplica al leer, nunca se escribe en el producto: apagarlo es poner 0 y
 * los precios de la base quedan intactos.
 *
 * Cada categoría es una lista de tramos "desde $X → Y %" porque en peluches
 * (de $10 a $125) un solo porcentaje no sirve. Un descuento plano es un tramo
 * desde $0. Va ordenada de mayor a menor `from`.
 */
export interface PriceTier {
  from: number;
  percent: number;
}
export type CategoryDiscounts = Partial<Record<Category, PriceTier[]>>;

const MAX_PERCENT = 90;

function requireDb() {
  if (!isConnected()) throw new CustomError("El servidor no tiene base de datos disponible", 503);
}

export async function getDiscounts(): Promise<CategoryDiscounts> {
  requireDb();
  const doc = await Setting.findOne({ key: "discounts" }).lean();
  const value = (doc?.value ?? {}) as Record<string, number | PriceTier[]>;
  // Antes se guardaba un número por categoría: se lee como un tramo desde $0.
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, typeof v === "number" ? [{ from: 0, percent: v }] : v]),
  );
}

function parseTiers(key: string, raw: unknown): PriceTier[] {
  const list = typeof raw === "number" || typeof raw === "string" ? [{ from: 0, percent: raw }] : raw;
  if (!Array.isArray(list)) throw new CustomError(`El descuento de ${key} no es válido`, 400);
  const tiers = list.map((t) => {
    const from = Number(t?.from ?? 0);
    const percent = Number(t?.percent);
    if (!Number.isFinite(from) || from < 0) {
      throw new CustomError(`El precio "desde" de ${key} debe ser 0 o más`, 400);
    }
    if (!Number.isInteger(percent) || percent < 0 || percent > MAX_PERCENT) {
      throw new CustomError(`El descuento de ${key} debe ser un número entero entre 0 y ${MAX_PERCENT}`, 400);
    }
    return { from: Math.round(from * 100) / 100, percent };
  });
  if (new Set(tiers.map((t) => t.from)).size !== tiers.length) {
    throw new CustomError(`En ${key} hay dos rangos que empiezan en el mismo precio`, 400);
  }
  return tiers.sort((a, b) => b.from - a.from);
}

/** Porcentaje que le toca a un precio: el del tramo más alto que alcanza. */
export function percentFor(tiers: PriceTier[] | undefined, price: number): number {
  return tiers?.find((t) => price >= t.from)?.percent ?? 0;
}

export async function setDiscounts(input: Record<string, unknown>): Promise<CategoryDiscounts> {
  requireDb();
  const value: CategoryDiscounts = {};
  for (const key of CATEGORIES) {
    const raw = input?.[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const tiers = parseTiers(key, raw);
    // Un tramo en 0 % sí cuenta (excluye un rango); solo se borra si todos son 0.
    if (tiers.some((t) => t.percent > 0)) value[key] = tiers;
  }
  await Setting.updateOne({ key: "discounts" }, { value }, { upsert: true });
  return value;
}

export function discounted(price: number, percent = 0): number {
  return percent > 0 ? Math.round(price * (100 - percent)) / 100 : price;
}

/**
 * Devuelve el producto con el descuento de su categoría ya puesto. El precio
 * original pasa a `compareAtPrice` (tachado) y `discountPercent` alimenta la
 * etiqueta "-20 %" de la tarjeta.
 */
export function applyDiscount<T extends IProduct>(product: T, discounts: CategoryDiscounts) {
  const tiers = discounts[product.category];
  const percent = percentFor(tiers, product.price);
  // shortcut: si el precio base no tiene descuento se ignoran tallas con precio propio en otro tramo; raro en el catálogo.
  if (!percent) return product;
  return {
    ...product,
    discountPercent: percent,
    compareAtPrice: Math.max(product.compareAtPrice ?? 0, product.price),
    price: discounted(product.price, percent),
    variants: product.variants.map((v) => ({
      ...v,
      price: v.price === null ? null : discounted(v.price, percentFor(tiers, v.price)),
      // Precio antes del descuento, para tachar el correcto en cada talla.
      listPrice: v.price ?? product.price,
    })),
  };
}

export async function withDiscounts<T extends IProduct>(products: T[]) {
  const discounts = await getDiscounts();
  return products.map((p) => applyDiscount(p, discounts));
}

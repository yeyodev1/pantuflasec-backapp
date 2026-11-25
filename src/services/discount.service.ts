import { isConnected } from "../config/mongo";
import { CustomError } from "../errors/customError.error";
import { CATEGORIES, Category, IProduct } from "../models/product.model";
import { Setting } from "../models/setting.model";

/**
 * Descuento por categoría (Black Friday: tazas 20 %, pantuflas 10 %...).
 * Se aplica al leer, nunca se escribe en el producto: apagarlo es poner 0 y
 * los precios de la base quedan intactos.
 */
export type CategoryDiscounts = Partial<Record<Category, number>>;

const MAX_PERCENT = 90;

function requireDb() {
  if (!isConnected()) throw new CustomError("El servidor no tiene base de datos disponible", 503);
}

export async function getDiscounts(): Promise<CategoryDiscounts> {
  requireDb();
  const doc = await Setting.findOne({ key: "discounts" }).lean();
  return (doc?.value as CategoryDiscounts) ?? {};
}

export async function setDiscounts(input: Record<string, unknown>): Promise<CategoryDiscounts> {
  requireDb();
  const value: CategoryDiscounts = {};
  for (const key of CATEGORIES) {
    const raw = input?.[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const pct = Number(raw);
    if (!Number.isInteger(pct) || pct < 0 || pct > MAX_PERCENT) {
      throw new CustomError(`El descuento de ${key} debe ser un número entero entre 0 y ${MAX_PERCENT}`, 400);
    }
    if (pct > 0) value[key] = pct;
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
  const percent = discounts[product.category] ?? 0;
  if (!percent) return product;
  return {
    ...product,
    discountPercent: percent,
    compareAtPrice: Math.max(product.compareAtPrice ?? 0, product.price),
    price: discounted(product.price, percent),
    variants: product.variants.map((v) => ({
      ...v,
      price: v.price === null ? null : discounted(v.price, percent),
      // Precio antes del descuento, para tachar el correcto en cada talla.
      listPrice: v.price ?? product.price,
    })),
  };
}

export async function withDiscounts<T extends IProduct>(products: T[]) {
  const discounts = await getDiscounts();
  return products.map((p) => applyDiscount(p, discounts));
}

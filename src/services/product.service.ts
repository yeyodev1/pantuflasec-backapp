import { isConnected } from "../config/mongo";
import { CustomError } from "../errors/customError.error";
import { Product, IProduct, IVariant, CATEGORIES, Category } from "../models/product.model";
import { slugify } from "../utils/slugify";

const PAGE_SIZE_MAX = 60;

export interface ListQuery {
  q?: string;
  category?: string;
  collection?: string;
  featured?: string;
  sort?: string;
  page?: string;
  limit?: string;
  /** Solo admin: incluye productos inactivos. */
  all?: boolean;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pages: number;
}

function requireDb() {
  if (!isConnected()) throw new CustomError("El servidor no tiene base de datos disponible", 503);
}

const SORTS: Record<string, Record<string, 1 | -1>> = {
  recent: { createdAt: -1 },
  "price-asc": { price: 1, sortOrder: 1 },
  "price-desc": { price: -1, sortOrder: 1 },
  name: { name: 1 },
  featured: { featured: -1, sortOrder: 1, createdAt: -1 },
};

export async function list(query: ListQuery): Promise<Paginated<IProduct>> {
  requireDb();
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(query.limit) || 24));

  const filter: Record<string, unknown> = {};
  if (!query.all) filter.isActive = true;
  if (query.category) filter.category = query.category;
  if (query.collection) filter.collection = new RegExp(`^${escapeRegex(query.collection)}$`, "i");
  if (query.featured === "true") filter.featured = true;

  const q = query.q?.trim();
  let sort = SORTS[query.sort ?? ""] ?? SORTS.featured;
  if (q) {
    filter.$text = { $search: q };
    // Con búsqueda manda la relevancia, salvo que el usuario haya pedido orden.
    if (!query.sort) sort = { score: { $meta: "textScore" } } as any;
  }

  const [items, total] = await Promise.all([
    Product.find(filter, q ? { score: { $meta: "textScore" } } : undefined)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Product.countDocuments(filter),
  ]);

  return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}

export async function getBySlug(slug: string, includeInactive = false): Promise<IProduct> {
  requireDb();
  const filter: Record<string, unknown> = { slug };
  if (!includeInactive) filter.isActive = true;
  const product = await Product.findOne(filter).lean();
  if (!product) throw new CustomError("Producto no encontrado", 404);
  return product;
}

/**
 * Relacionados para vender más desde la página de producto:
 * - complement: misma colección pero otra categoría (cross-selling: la taza del
 *   mismo personaje que el peluche que estás viendo).
 * - similar: misma categoría, primero la misma colección y luego el resto, con
 *   los más caros primero (upselling: la versión más grande).
 */
export async function related(slug: string) {
  requireDb();
  const product = await Product.findOne({ slug, isActive: true }).lean();
  if (!product) throw new CustomError("Producto no encontrado", 404);
  const not = { _id: { $ne: product._id }, isActive: true };
  const byCollection = product.collection
    ? { collection: new RegExp(`^${escapeRegex(product.collection)}$`, "i") }
    : null;

  const [complementRaw, sameLine, sameCategory] = await Promise.all([
    byCollection
      ? Product.find({ ...not, ...byCollection, category: { $ne: product.category } })
          .sort({ featured: -1, price: -1 })
          .limit(40)
          .lean()
      : [],
    byCollection
      ? Product.find({ ...not, ...byCollection, category: product.category })
          .sort({ price: -1 })
          .limit(8)
          .lean()
      : [],
    Product.find({ ...not, category: product.category, ...(byCollection ? { collection: { $not: byCollection.collection } } : {}) })
      .sort({ featured: -1, createdAt: -1 })
      .limit(8)
      .lean(),
  ]);
  // Cross-selling variado: se reparte por categoría (una taza, unas pantuflas,
  // una pijama...) en vez de ocho llaveros seguidos.
  const buckets = new Map<string, IProduct[]>();
  for (const p of complementRaw as IProduct[]) {
    const list = buckets.get(p.category) ?? [];
    list.push(p);
    buckets.set(p.category, list);
  }
  const complement: IProduct[] = [];
  for (let round = 0; complement.length < 8; round++) {
    let added = false;
    for (const list of buckets.values()) {
      if (list[round] && complement.length < 8) {
        complement.push(list[round]);
        added = true;
      }
    }
    if (!added) break;
  }
  const seen = new Set<string>();
  const dedupe = (list: IProduct[]) =>
    list.filter((p) => {
      const id = String((p as any)._id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  return {
    complement: dedupe(complement),
    similar: dedupe([...(sameLine as IProduct[]), ...(sameCategory as IProduct[])]).slice(0, 8),
  };
}

/** Categorías y colecciones con cantidad de productos activos, para los filtros del front. */
export async function facets() {
  requireDb();
  const [byCategory, byCollection] = await Promise.all([
    Product.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ]),
    Product.aggregate([
      { $match: { isActive: true, collection: { $ne: "" } } },
      { $group: { _id: "$collection", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
  ]);
  const counts = new Map(byCategory.map((c) => [c._id, c.count]));
  // Foto de portada por categoría: el destacado más reciente con imagen.
  const covers = await Promise.all(
    CATEGORIES.map((key) =>
      Product.findOne({ category: key, isActive: true, "images.0": { $exists: true } })
        .sort({ featured: -1, createdAt: -1 })
        .select("images slug")
        .lean(),
    ),
  );
  return {
    categories: CATEGORIES.map((key, i) => ({
      key,
      count: counts.get(key) ?? 0,
      cover: covers[i]?.images[0]?.url ?? null,
    })),
    collections: byCollection.map((c) => ({ name: c._id as string, count: c.count as number })),
  };
}

export type ProductInput = Partial<Omit<IProduct, "slug" | "createdAt" | "updatedAt">>;

export async function create(input: ProductInput): Promise<IProduct> {
  requireDb();
  const data = validate(input, true);
  data.slug = await uniqueSlug(data.name as string);
  const product = await Product.create(data);
  return product.toObject();
}

export async function update(id: string, input: ProductInput): Promise<IProduct> {
  requireDb();
  const product = await Product.findById(id);
  if (!product) throw new CustomError("Producto no encontrado", 404);

  const data = validate(input, false);
  // El slug es la URL pública: solo cambia si cambia el nombre.
  if (data.name && data.name !== product.name) {
    data.slug = await uniqueSlug(data.name as string, id);
  }
  product.set(data);
  await product.save();
  return product.toObject();
}

export async function remove(id: string): Promise<void> {
  requireDb();
  const deleted = await Product.findByIdAndDelete(id);
  if (!deleted) throw new CustomError("Producto no encontrado", 404);
}

/**
 * Descuenta stock de una variante (o del producto si no tiene variantes).
 * Es atómico: la condición `stock >= qty` va en el filtro para que dos compras
 * simultáneas no dejen el inventario en negativo.
 */
export async function reserveStock(productId: string, variantId: string | null, qty: number) {
  requireDb();
  const filter: Record<string, unknown> = { _id: productId, isActive: true };
  const update: Record<string, unknown> = {};
  if (variantId) {
    filter["variants"] = { $elemMatch: { _id: variantId, stock: { $gte: qty } } };
    update.$inc = { "variants.$.stock": -qty };
  }
  const result = variantId
    ? await Product.findOneAndUpdate(filter, update, { new: true })
    : await Product.findOne(filter);
  if (!result) throw new CustomError("No hay stock suficiente para este producto", 409);
  return result;
}

function validate(input: ProductInput, creating: boolean): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  if (creating || input.name !== undefined) {
    const name = String(input.name ?? "").trim();
    if (!name) throw new CustomError("El producto necesita un nombre", 400);
    data.name = name;
  }
  if (creating || input.category !== undefined) {
    if (!CATEGORIES.includes(input.category as Category)) {
      throw new CustomError(`Categoría inválida. Usa una de: ${CATEGORIES.join(", ")}`, 400);
    }
    data.category = input.category;
  }
  if (creating || input.price !== undefined) {
    const price = Number(input.price);
    if (!Number.isFinite(price) || price < 0) throw new CustomError("Precio inválido", 400);
    data.price = round2(price);
  }
  if (input.compareAtPrice !== undefined) {
    data.compareAtPrice = input.compareAtPrice === null ? null : round2(Number(input.compareAtPrice));
  }
  if (input.variants !== undefined) data.variants = validateVariants(input.variants);
  if (input.images !== undefined) {
    data.images = (input.images ?? [])
      .filter((i) => i && typeof i.url === "string" && i.url.trim())
      .map((i) => ({ url: i.url.trim(), publicId: i.publicId ?? "" }));
  }
  if (input.tags !== undefined) {
    data.tags = (input.tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  }

  for (const key of ["description", "collection"] as const) {
    if (input[key] !== undefined) data[key] = String(input[key] ?? "").trim();
  }
  for (const key of ["isActive", "featured"] as const) {
    if (input[key] !== undefined) data[key] = Boolean(input[key]);
  }
  if (input.sortOrder !== undefined) data.sortOrder = Number(input.sortOrder) || 0;

  return data;
}

function validateVariants(variants: IVariant[]): IVariant[] {
  if (!Array.isArray(variants)) throw new CustomError("Las variantes deben ser una lista", 400);
  return variants.map((v, i) => {
    const size = String(v.size ?? "").trim();
    const color = String(v.color ?? "").trim();
    const label = String(v.label ?? "").trim() || [size, color].filter(Boolean).join(" · ");
    if (!label) throw new CustomError(`La variante ${i + 1} necesita talla, color o etiqueta`, 400);
    const stock = Number(v.stock ?? 0);
    if (!Number.isInteger(stock) || stock < 0) {
      throw new CustomError(`Stock inválido en la variante "${label}"`, 400);
    }
    const price = v.price === null || v.price === undefined ? null : round2(Number(v.price));
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      throw new CustomError(`Precio inválido en la variante "${label}"`, 400);
    }
    const out: IVariant = { label, size, color, sku: String(v.sku ?? "").trim(), price, stock };
    if (v._id) out._id = v._id;
    return out;
  });
}

async function uniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base = slugify(name) || "producto";
  let slug = base;
  for (let n = 2; ; n++) {
    const clash = await Product.exists(excludeId ? { slug, _id: { $ne: excludeId } } : { slug });
    if (!clash) return slug;
    slug = `${base}-${n}`;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

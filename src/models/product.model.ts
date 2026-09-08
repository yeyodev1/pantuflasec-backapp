import mongoose, { Model, Schema, Types } from "mongoose";

/**
 * Categorías fijas del catálogo. Son un enum y no una colección aparte porque
 * el negocio las cambia una vez al año y el front necesita la lista completa
 * para armar los filtros sin una consulta extra.
 */
export const CATEGORIES = [
  "pantuflas",
  "peluches",
  "tazas",
  "tomatodos",
  "pijamas",
  "mantas",
  "arreglos",
  "accesorios",
  "otros",
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Una variante es una combinación vendible: talla y/o color con su propio
 * stock. `price` en null significa "usa el precio base del producto"; así una
 * pantufla con tallas 28-32 a $15 y 34-44 a $20 cabe en un solo producto.
 */
export interface IVariant {
  _id?: Types.ObjectId;
  label: string;
  size: string;
  color: string;
  sku: string;
  price: number | null;
  stock: number;
}

export interface IProductImage {
  url: string;
  publicId: string;
}

export interface IProduct {
  name: string;
  slug: string;
  description: string;
  category: Category;
  /** Licencia o línea: "Stitch", "Snoopy", "Sanrio"... Texto libre. */
  collection: string;
  price: number;
  compareAtPrice: number | null;
  images: IProductImage[];
  variants: IVariant[];
  tags: string[];
  isActive: boolean;
  featured: boolean;
  /** Sección "Nuevo" de la tienda: lo marca el admin cuando llega mercadería. */
  newArrival: boolean;
  sortOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const variantSchema = new Schema<IVariant>(
  {
    label: { type: String, required: true, trim: true },
    size: { type: String, default: "", trim: true },
    color: { type: String, default: "", trim: true },
    sku: { type: String, default: "", trim: true },
    price: { type: Number, default: null, min: 0 },
    stock: { type: Number, default: 0, min: 0 },
  },
  { _id: true },
);

const imageSchema = new Schema<IProductImage>(
  {
    url: { type: String, required: true },
    publicId: { type: String, default: "" },
  },
  { _id: false },
);

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    description: { type: String, default: "" },
    category: { type: String, enum: CATEGORIES, required: true, index: true },
    collection: { type: String, default: "", trim: true, index: true },
    price: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number, default: null, min: 0 },
    images: { type: [imageSchema], default: [] },
    variants: { type: [variantSchema], default: [] },
    tags: { type: [String], default: [] },
    isActive: { type: Boolean, default: true, index: true },
    featured: { type: Boolean, default: false },
    newArrival: { type: Boolean, default: false, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  // `collection` es nombre reservado en Mongoose; se comprobó que get/set/save
  // funcionan bien con él, así que solo se silencia el aviso.
  { timestamps: true, suppressReservedKeysWarning: true },
);

// Búsqueda libre del catálogo. `collection` pesa más que la descripción porque
// la gente busca "stitch" o "snoopy", no frases.
productSchema.index(
  { name: "text", collection: "text", tags: "text", description: "text" },
  { weights: { name: 10, collection: 8, tags: 5, description: 1 }, default_language: "spanish" },
);

export const Product: Model<IProduct> =
  (mongoose.models.Product as Model<IProduct>) ||
  mongoose.model<IProduct>("Product", productSchema);

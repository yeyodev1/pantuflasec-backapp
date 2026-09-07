import { isConnected } from "../config/mongo";
import { CustomError } from "../errors/customError.error";
import { GalleryItem, IGalleryItem } from "../models/gallery.model";

function requireDb() {
  if (!isConnected()) throw new CustomError("El servidor no tiene base de datos disponible", 503);
}

export type GalleryInput = Partial<Omit<IGalleryItem, "createdAt" | "updatedAt">>;

export async function listPublic(): Promise<IGalleryItem[]> {
  requireDb();
  return GalleryItem.find({ isActive: true }).sort({ order: 1, createdAt: -1 }).lean();
}

export async function listAll(): Promise<IGalleryItem[]> {
  requireDb();
  return GalleryItem.find().sort({ order: 1, createdAt: -1 }).lean();
}

function clean(input: GalleryInput, creating: boolean): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (creating || input.image !== undefined) {
    const url = String(input.image?.url ?? "").trim();
    if (!/^https?:\/\//.test(url)) throw new CustomError("La imagen debe ser una URL válida", 400);
    data.image = { url, publicId: String(input.image?.publicId ?? "") };
  }
  for (const key of ["title", "subtitle", "link"] as const) {
    if (input[key] !== undefined) data[key] = String(input[key] ?? "").trim().slice(0, 140);
  }
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);
  if (input.order !== undefined) data.order = Number(input.order) || 0;
  return data;
}

export async function create(input: GalleryInput): Promise<IGalleryItem> {
  requireDb();
  const data = clean(input, true);
  if (data.order === undefined) {
    const last = await GalleryItem.findOne().sort({ order: -1 }).lean();
    data.order = (last?.order ?? -1) + 1;
  }
  const item = await GalleryItem.create(data);
  return item.toObject();
}

export async function update(id: string, input: GalleryInput): Promise<IGalleryItem> {
  requireDb();
  const item = await GalleryItem.findByIdAndUpdate(id, clean(input, false), { new: true }).lean();
  if (!item) throw new CustomError("Elemento no encontrado", 404);
  return item;
}

export async function remove(id: string): Promise<void> {
  requireDb();
  const deleted = await GalleryItem.findByIdAndDelete(id);
  if (!deleted) throw new CustomError("Elemento no encontrado", 404);
}

/** Recibe los ids en el orden deseado y los renumera. */
export async function reorder(ids: string[]): Promise<void> {
  requireDb();
  if (!Array.isArray(ids)) throw new CustomError("Se esperaba una lista de ids", 400);
  await GalleryItem.bulkWrite(
    ids.map((id, order) => ({ updateOne: { filter: { _id: id }, update: { order } } })),
  );
}

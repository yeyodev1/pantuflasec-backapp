import mongoose, { Model, Schema } from "mongoose";

/**
 * Galería del home: fotos que el admin elige y ordena. Cada ítem puede
 * enlazar a una ruta de la tienda (colección, producto, categoría).
 */
export interface IGalleryItem {
  title: string;
  subtitle: string;
  image: { url: string; publicId: string };
  link: string;
  order: number;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const gallerySchema = new Schema<IGalleryItem>(
  {
    title: { type: String, default: "", trim: true },
    subtitle: { type: String, default: "", trim: true },
    image: {
      url: { type: String, required: true },
      publicId: { type: String, default: "" },
    },
    link: { type: String, default: "", trim: true },
    order: { type: Number, default: 0, index: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

export const GalleryItem: Model<IGalleryItem> =
  (mongoose.models.GalleryItem as Model<IGalleryItem>) ||
  mongoose.model<IGalleryItem>("GalleryItem", gallerySchema);

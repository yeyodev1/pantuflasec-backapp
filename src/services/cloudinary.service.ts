import { v2 as cloudinary, UploadApiResponse } from "cloudinary";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";

let configured = false;

export function isCloudinaryConfigured(): boolean {
  return !!(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

function ensureConfig() {
  if (configured) return;
  if (!isCloudinaryConfigured()) {
    throw new CustomError("Cloudinary no está configurado en el servidor", 503);
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  });
  configured = true;
}

const DEFAULT_FOLDER = "pantuflasec-backapp";

/** Sube un buffer (multer memoryStorage). */
export function uploadBuffer(
  buffer: Buffer,
  folder = DEFAULT_FOLDER,
): Promise<{ url: string; publicId: string }> {
  ensureConfig();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image", transformation: [{ quality: "auto", fetch_format: "auto" }] },
      (error, result?: UploadApiResponse) => {
        if (error || !result) return reject(error || new Error("Cloudinary sin respuesta"));
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(buffer);
  });
}

/** Sube un data URI base64 o una URL remota. */
export async function uploadImage(
  source: string,
  folder = DEFAULT_FOLDER,
): Promise<{ url: string; publicId: string }> {
  ensureConfig();
  const result = await cloudinary.uploader.upload(source, {
    folder,
    resource_type: "image",
    transformation: [{ quality: "auto", fetch_format: "auto" }],
  });
  return { url: result.secure_url, publicId: result.public_id };
}

export async function deleteImage(publicId: string): Promise<void> {
  ensureConfig();
  await cloudinary.uploader.destroy(publicId);
}

export interface MediaItem {
  publicId: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
  format: string;
  createdAt: string;
}

/** Lista las imágenes de una carpeta, más nuevas primero. `cursor` pagina. */
export async function listImages(
  folder = DEFAULT_FOLDER,
  cursor?: string,
  max = 40,
): Promise<{ items: MediaItem[]; nextCursor: string | null }> {
  ensureConfig();
  const result = await cloudinary.api.resources({
    type: "upload",
    resource_type: "image",
    prefix: `${folder}/`,
    max_results: max,
    next_cursor: cursor || undefined,
    direction: "desc",
  });
  return {
    items: (result.resources as any[]).map((r) => ({
      publicId: r.public_id,
      url: r.secure_url,
      width: r.width,
      height: r.height,
      bytes: r.bytes,
      format: r.format,
      createdAt: r.created_at,
    })),
    nextCursor: result.next_cursor ?? null,
  };
}

import { Request, Response, NextFunction } from "express";
import { CustomError } from "../errors/customError.error";
import { Product } from "../models/product.model";
import {
  deleteImage,
  isCloudinaryConfigured,
  listImages,
  uploadBuffer,
} from "../services/cloudinary.service";

const FOLDER = "pantuflasec";

/** POST /api/uploads/image — multipart "file". Devuelve { url, publicId }. */
export async function image(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new CustomError("Adjunta una imagen en el campo 'file'", 400);
    // Algunos clientes mandan octet-stream para .webp/.heic: se valida también por extensión.
    const isImage =
      req.file.mimetype.startsWith("image/") ||
      /\.(png|jpe?g|webp|gif|avif|heic)$/i.test(req.file.originalname ?? "");
    if (!isImage) throw new CustomError("Solo se aceptan imágenes", 400);
    const folder = typeof req.body?.folder === "string" && req.body.folder ? req.body.folder : "productos";
    const result = await uploadBuffer(req.file.buffer, `${FOLDER}/${folder.replace(/[^a-z0-9_-]/gi, "")}`);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /api/uploads/status — el admin sabe si puede subir fotos o solo pegar URLs. */
export function status(_req: Request, res: Response) {
  res.status(200).json({ cloudinary: isCloudinaryConfigured() });
}

/** GET /api/uploads — query: cursor. Biblioteca de imágenes de la tienda. */
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    res.status(200).json(await listImages(FOLDER, cursor));
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/uploads/:publicId — el publicId viene codificado (tiene barras).
 * Si la imagen está en algún producto se rechaza: primero hay que quitarla de ahí.
 */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const publicId = decodeURIComponent(String(req.params.publicId));
    const used = await Product.findOne({ "images.publicId": publicId }).select("name slug").lean();
    if (used) {
      throw new CustomError(`Esa imagen la usa el producto "${used.name}". Quítala de ahí primero.`, 409);
    }
    await deleteImage(publicId);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

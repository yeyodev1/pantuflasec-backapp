import { Request, Response, NextFunction } from "express";
import { CustomError } from "../errors/customError.error";
import { uploadBuffer, isCloudinaryConfigured } from "../services/cloudinary.service";

/** POST /api/uploads/image — multipart "file". Devuelve { url, publicId }. */
export async function image(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new CustomError("Adjunta una imagen en el campo 'file'", 400);
    if (!req.file.mimetype.startsWith("image/")) {
      throw new CustomError("Solo se aceptan imágenes", 400);
    }
    const result = await uploadBuffer(req.file.buffer, "pantuflasec/productos");
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
}

/** GET /api/uploads/status — el admin sabe si puede subir fotos o solo pegar URLs. */
export function status(_req: Request, res: Response) {
  res.status(200).json({ cloudinary: isCloudinaryConfigured() });
}

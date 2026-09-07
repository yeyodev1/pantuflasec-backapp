/**
 * Sube a Cloudinary las fotos del catálogo que hoy apuntan a /catalogo/*.webp
 * y reescribe las URLs de los productos. Es idempotente: las que ya son
 * https:// se saltan, así se puede relanzar si se corta a la mitad.
 *
 * Uso: pnpm images:migrate <carpeta con los .webp>   (p. ej. ../pantuflasec-frontapp/public/catalogo)
 */
import "dotenv/config";
import { readFileSync, existsSync } from "fs";
import { join, basename } from "path";
import mongoose from "mongoose";
import { env } from "../config/env";
import { Product } from "../models/product.model";
import { uploadBuffer, isCloudinaryConfigured } from "../services/cloudinary.service";

const FOLDER = "pantuflasec/catalogo";
const PARALLEL = 4;

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Uso: pnpm images:migrate <carpeta con los .webp>");
    process.exit(1);
  }
  if (!isCloudinaryConfigured()) {
    console.error("✖ Faltan CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET en el .env");
    process.exit(1);
  }

  await mongoose.connect(env.DB_URI);
  const products = await Product.find({ "images.url": /^\/catalogo\// });
  console.log(`${products.length} productos con fotos locales`);

  let uploaded = 0;
  let missing = 0;
  const queue = [...products];
  async function worker() {
    for (let p = queue.shift(); p; p = queue.shift()) {
      let changed = false;
      for (const img of p.images) {
        if (!img.url.startsWith("/catalogo/")) continue;
        const file = join(dir, basename(img.url));
        if (!existsSync(file)) {
          console.warn(`  falta ${file} (${p.name})`);
          missing += 1;
          continue;
        }
        // public_id fijo por nombre de archivo: relanzar no duplica en Cloudinary.
        const { url, publicId } = await uploadBuffer(readFileSync(file), FOLDER);
        img.url = url;
        img.publicId = publicId;
        uploaded += 1;
        changed = true;
      }
      if (changed) {
        p.markModified("images");
        await p.save();
        console.log(`✔ ${p.name} (${p.images.length} fotos)`);
      }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  console.log(`\nSubidas: ${uploaded} · faltantes: ${missing}`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("✖ Falló la migración:", error);
  process.exit(1);
});

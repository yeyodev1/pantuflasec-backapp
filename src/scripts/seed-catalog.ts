/**
 * Importa el catálogo desde un JSON (salida de la extracción de los PDFs).
 * Uso: pnpm seed:catalog ruta/al/catalog.json [--reset]
 *
 * Hace upsert por slug: los productos que ya existen se actualizan (nombre,
 * precio, fotos, variantes) sin tocar el stock que el admin haya ajustado;
 * con --reset se borra todo el catálogo antes de importar.
 */
import "dotenv/config";
import { readFileSync } from "fs";
import mongoose from "mongoose";
import { env } from "../config/env";
import { Product, IProduct } from "../models/product.model";

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file) {
    console.error("Uso: pnpm seed:catalog <catalog.json> [--reset]");
    process.exit(1);
  }
  const items = JSON.parse(readFileSync(file, "utf8")) as Array<Partial<IProduct> & { slug: string }>;

  await mongoose.connect(env.DB_URI);
  if (flag === "--reset") {
    const { deletedCount } = await Product.deleteMany({});
    console.log(`Catálogo previo borrado: ${deletedCount} productos`);
  }

  let created = 0;
  let updated = 0;
  for (const item of items) {
    const existing = await Product.findOne({ slug: item.slug });
    if (!existing) {
      await Product.create(item);
      created += 1;
      continue;
    }
    // Se conserva el stock editado a mano: se casa cada variante por etiqueta.
    const stockByLabel = new Map(existing.variants.map((v) => [v.label, v.stock]));
    const variants = (item.variants ?? []).map((v) => ({
      ...v,
      stock: stockByLabel.get(v.label) ?? v.stock,
    }));
    existing.set({ ...item, variants, isActive: existing.isActive, featured: existing.featured });
    await existing.save();
    updated += 1;
  }

  console.log(`✔ Importados: ${created} nuevos, ${updated} actualizados (${items.length} en total)`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("✖ Falló la importación:", error);
  process.exit(1);
});

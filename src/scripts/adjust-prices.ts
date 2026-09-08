/**
 * Sube todos los precios del catálogo para absorber la comisión de PayPhone
 * (5% + IVA sobre la comisión = 5,75% del cobro). Para recibir el precio de
 * lista P al cobrar con tarjeta hay que cobrar P / 0,9425; se redondea hacia
 * arriba al múltiplo de $0,05 para que queden precios limpios.
 *
 * Marca cada producto con `feeIncludedAt`, así correrlo dos veces no lo sube
 * dos veces. Guarda un respaldo JSON con los precios anteriores.
 *
 * Uso: pnpm prices:adjust <respaldo.json> [--apply]   (sin --apply solo muestra)
 */
import "dotenv/config";
import { writeFileSync } from "fs";
import mongoose from "mongoose";
import { env } from "../config/env";
import { Product } from "../models/product.model";

const PAYPHONE_FEE = 0.05 * 1.15;
const FACTOR = 1 / (1 - PAYPHONE_FEE);

/** Redondea hacia arriba a $0,05 con aritmética en centavos (sin errores de coma flotante). */
export function withFee(price: number): number {
  const cents = Math.round(price * 100);
  const raised = cents * FACTOR;
  return Math.ceil(raised / 5 - 1e-9) * 5 / 100;
}

async function main() {
  const [backupPath, flag] = process.argv.slice(2);
  const apply = flag === "--apply";
  if (!backupPath) {
    console.error("Uso: pnpm prices:adjust <respaldo.json> [--apply]");
    process.exit(1);
  }
  await mongoose.connect(env.DB_URI);
  const products = await Product.find({ feeIncludedAt: null });
  const backup: unknown[] = [];
  let changed = 0;
  for (const p of products) {
    backup.push({
      _id: String(p._id),
      slug: p.slug,
      price: p.price,
      compareAtPrice: p.compareAtPrice,
      variants: p.variants.map((v) => ({ _id: String(v._id), label: v.label, price: v.price })),
    });
    const before = p.price;
    p.price = withFee(p.price);
    if (p.compareAtPrice) p.compareAtPrice = withFee(p.compareAtPrice);
    for (const v of p.variants) if (v.price !== null && v.price !== undefined) v.price = withFee(v.price);
    p.feeIncludedAt = new Date();
    changed += 1;
    if (changed <= 8 || !apply) console.log(`${p.slug}: ${before.toFixed(2)} → ${p.price.toFixed(2)}`);
    if (apply) await p.save();
  }
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`${apply ? "✔ Actualizados" : "Se actualizarían"} ${changed} productos (de ${products.length} sin comisión). Respaldo: ${backupPath}`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

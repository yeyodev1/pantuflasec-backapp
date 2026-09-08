/**
 * Crea o actualiza una cuenta desde la terminal.
 * Uso: pnpm user:create <correo> <contraseña> [admin|staff|customer] [nombre]
 */
import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../config/env";
import { User } from "../models/user.model";

async function main() {
  const [email, password, accountType = "admin", ...nameParts] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Uso: pnpm user:create <correo> <contraseña> [admin|customer] [nombre]");
    process.exit(1);
  }
  await mongoose.connect(env.DB_URI);
  const existing = await User.findOne({ email: email.toLowerCase() }).select("+password");
  if (existing) {
    existing.password = password;
    existing.accountType = accountType as "admin" | "staff" | "customer";
    existing.isActive = true;
    if (nameParts.length) existing.name = nameParts.join(" ");
    await existing.save();
    console.log(`✔ Cuenta actualizada: ${email} (${accountType})`);
  } else {
    await User.create({ email, password, accountType, name: nameParts.join(" ") });
    console.log(`✔ Cuenta creada: ${email} (${accountType})`);
  }
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("✖ Falló:", error);
  process.exit(1);
});

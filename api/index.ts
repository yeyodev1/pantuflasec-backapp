import "dotenv/config";
import type { Express } from "express";
import { dbConnect, isConnected } from "../src/config/mongo";
import { createApp } from "../src/app";
import { seedAdmin } from "../src/services/auth.service";

/**
 * Entrada para Vercel.
 *
 * El arranque se guarda como promesa, no como bandera: dos peticiones que
 * lleguen juntas a una instancia fría entrarían las dos al arranque y se
 * atenderían antes de que Mongo terminara de conectar.
 *
 * Además se reintenta la conexión en cada invocación si se cayó, porque una
 * instancia puede sobrevivir a la conexión que tenía.
 */
let arranque: Promise<Express> | null = null;

/**
 * Conecta con reintentos cortos. En un arranque frío Atlas o el DNS pueden
 * fallar el primer intento y sin esto la instancia respondía 503 a todo.
 */
async function connectWithRetry(attempts = 3, waitMs = 600): Promise<boolean> {
  for (let i = 1; i <= attempts; i++) {
    if (await dbConnect()) return true;
    if (i < attempts) await new Promise((r) => setTimeout(r, waitMs * i));
  }
  return false;
}

async function ensureApp(): Promise<Express> {
  if (!arranque) {
    arranque = (async () => {
      const ok = await connectWithRetry();
      if (ok) await seedAdmin();
      return createApp().app;
    })().catch((error) => {
      // No se cachea un arranque fallido: la siguiente petición reintenta.
      arranque = null;
      throw error;
    });
  }

  const app = await arranque;

  if (!isConnected()) {
    const reconectado = await connectWithRetry();
    if (reconectado) await seedAdmin();
  }

  return app;
}

export default async function handler(req: any, res: any) {
  try {
    const application = await ensureApp();
    application(req, res);
  } catch (error) {
    console.error("[api] no se pudo iniciar la aplicación:", error);
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Retry-After", "2");
    res.end(JSON.stringify({ message: "Servicio no disponible. Intenta de nuevo." }));
  }
}

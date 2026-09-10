import mongoose from "mongoose";
import { env } from "./env";

/**
 * Conexión a Mongo pensada para serverless (Vercel, instancias que se congelan
 * entre peticiones y despiertan con los heartbeats vencidos).
 *
 * Reglas aprendidas el 2026-09-10, cuando la tienda estuvo caída dos veces:
 *
 * 1. Si Mongoose está en "disconnected" pero el MongoClient sigue vivo, NO se
 *    llama a `mongoose.connect`: Mongoose crearía otro cliente sin cerrar el
 *    anterior y cada reconexión suma ~10 conexiones por instancia. Así se
 *    llenó el tope de 500 del M0 de Atlas.
 * 2. Ese estado casi siempre es transitorio (instancia recién despertada o
 *    elección de primario en Atlas): el driver reconecta solo en menos de un
 *    segundo. Primero se espera; solo si no vuelve se reemplaza el cliente.
 * 3. Nunca `close(true)`: el cierre forzado deja `$wasForceClosed` en la
 *    conexión y desde entonces toda consulta de esa instancia falla con
 *    "Connection was force closed" hasta que Vercel la recicle.
 * 4. Una sola reconexión a la vez: las peticiones concurrentes de la misma
 *    instancia comparten la promesa en vez de pisarse.
 */

const RECOVERY_MS = 4000;
let inflight: Promise<boolean> | null = null;

/** 1 = conectado. */
export function isConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

async function waitForRecovery(ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!isConnected() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  return isConnected();
}

async function releaseStaleClient(): Promise<void> {
  try {
    await mongoose.connection.close();
  } catch (error) {
    console.warn("[mongo] no se pudo cerrar el cliente anterior:", error);
  }
}

async function connectOnce(): Promise<boolean> {
  const hasClient = Boolean(mongoose.connection.getClient());

  if (hasClient) {
    if (await waitForRecovery(RECOVERY_MS)) return true;
    console.warn("[mongo] el driver no recuperó la conexión: se reemplaza el cliente");
    await releaseStaleClient();
  }

  try {
    await mongoose.connect(env.DB_URI, {
      // Fallar rápido y reintentar es mejor que dejar la petición colgada
      // (el front corta a los 15 s: dos intentos de 5 s caben ahí).
      serverSelectionTimeoutMS: 5000,
      // Menos conexiones por instancia: en serverless hay muchas instancias y Atlas M0 tiene tope.
      maxPoolSize: 5,
      // Un socket ocioso se devuelve a Atlas en vez de quedarse contando contra el tope.
      maxIdleTimeMS: 60000,
      // Sin buffer, una consulta lanzada antes de tiempo falla en vez de
      // quedarse esperando en silencio.
      bufferCommands: false,
    });
    console.log("Connected to MongoDB");
    return true;
  } catch (error) {
    console.error("MongoDB connection error:", error);
    if (!env.IS_VERCEL) process.exit(1);
    return false;
  }
}

export async function dbConnect(): Promise<boolean> {
  if (isConnected()) return true;
  if (!inflight) {
    inflight = connectOnce().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

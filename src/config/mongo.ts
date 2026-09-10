import mongoose from "mongoose";
import { env } from "./env";

/**
 * Conexión a Mongo pensada para serverless.
 *
 * Se guarda la *promesa* de conexión a nivel de módulo: las invocaciones que
 * reusan la instancia esperan la misma promesa en vez de abrir otra conexión
 * (Atlas tiene un tope) y ninguna consulta corre antes de tiempo.
 *
 * Una conexión fallida no se cachea: si se guardara, la instancia quedaría
 * inservible hasta que Vercel la recicle.
 */

let promesa: Promise<typeof mongoose> | null = null;

/** 1 = conectado. */
export function isConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * Suelta el cliente anterior antes de reconectar.
 *
 * Cuando Atlas pierde el primario un momento, Mongoose pasa a "disconnected"
 * pero el MongoClient sigue vivo con su pool y sus monitores. Si se llama a
 * `mongoose.connect` en ese estado, Mongoose crea un cliente NUEVO sin cerrar
 * el viejo: cada reconexión sumaba ~10 conexiones por instancia y el
 * 2026-09-10 el M0 (tope 500) se llenó y rechazó a todo el mundo.
 */
async function releaseStaleClient(): Promise<void> {
  if (!mongoose.connection.getClient()) return;
  try {
    await mongoose.connection.close(true);
  } catch (error) {
    console.warn("[mongo] no se pudo cerrar el cliente anterior:", error);
  }
}

export async function dbConnect(): Promise<boolean> {
  if (isConnected()) return true;

  // 2 = conectando: se espera esa misma promesa. Cualquier otro estado reconecta.
  if (!promesa || mongoose.connection.readyState !== 2) {
    await releaseStaleClient();
    promesa = mongoose.connect(env.DB_URI, {
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
  }

  try {
    await promesa;
    console.log("Connected to MongoDB");
    return true;
  } catch (error) {
    promesa = null;
    console.error("MongoDB connection error:", error);
    if (!env.IS_VERCEL) process.exit(1);
    return false;
  }
}

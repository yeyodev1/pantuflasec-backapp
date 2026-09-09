import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";
import { uploadImage } from "./cloudinary.service";

/**
 * Logos de bancos vía Brandfetch. La búsqueda por nombre (Brand Search API,
 * gratis con client ID) ya devuelve un icono; con API key se pide además el
 * logo completo a la Brand API. Lo elegido se copia a Cloudinary para no
 * depender del CDN de terceros ni de la cuota.
 */
export interface BrandCandidate {
  name: string;
  domain: string;
  icon: string;
}

const LOGO_FOLDER = "pantuflasec/bancos";

export function isBrandfetchConfigured(): boolean {
  return Boolean(env.BRANDFETCH_CLIENT_ID);
}

export async function searchBrands(rawQuery: string): Promise<BrandCandidate[]> {
  if (!isBrandfetchConfigured()) {
    throw new CustomError(
      "Falta configurar BRANDFETCH_CLIENT_ID en el servidor. Mientras tanto sube el logo a mano.",
      503,
    );
  }
  const q = String(rawQuery ?? "").trim();
  if (q.length < 2) throw new CustomError("Escribe el nombre del banco", 400);
  const url = `https://api.brandfetch.io/v2/search/${encodeURIComponent(q)}?c=${env.BRANDFETCH_CLIENT_ID}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok)
    throw new CustomError("Brandfetch no respondió. Intenta de nuevo o sube el logo a mano.", 502);
  const data = (await response.json()) as Array<{ name?: string; domain?: string; icon?: string }>;
  return data
    .filter((b) => b.domain && b.icon)
    .slice(0, 8)
    .map((b) => ({ name: b.name || b.domain!, domain: b.domain!, icon: b.icon! }));
}

/** Con API key, el logo "de verdad" (no el favicon) del dominio elegido; si no hay, null. */
async function brandApiLogo(domain: string): Promise<string | null> {
  if (!env.BRANDFETCH_API_KEY) return null;
  try {
    const response = await fetch(
      `https://api.brandfetch.io/v2/brands/domain/${encodeURIComponent(domain)}`,
      {
        headers: { Authorization: `Bearer ${env.BRANDFETCH_API_KEY}` },
      },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      logos?: Array<{
        type?: string;
        theme?: string;
        formats?: Array<{ src?: string; format?: string }>;
      }>;
    };
    // Prioridad: logo completo sobre fondo claro, en PNG o SVG.
    const ranked = [...(data.logos ?? [])].sort((a, b) => score(b) - score(a));
    for (const logo of ranked) {
      const src =
        logo.formats?.find((f) => f.format === "png")?.src ??
        logo.formats?.find((f) => f.format === "svg")?.src;
      if (src) return src;
    }
    return null;
  } catch {
    return null;
  }
}

function score(l: { type?: string; theme?: string }): number {
  return (l.type === "logo" ? 2 : l.type === "icon" ? 1 : 0) + (l.theme === "light" ? 0.5 : 0);
}

/** Copia el logo elegido a Cloudinary. Devuelve la URL que se guarda en la cuenta. */
export async function importLogo(candidate: {
  domain?: string;
  icon?: string;
}): Promise<{ url: string; publicId: string }> {
  const source = (candidate.domain && (await brandApiLogo(candidate.domain))) || candidate.icon;
  if (!source || !/^https?:\/\//.test(source))
    throw new CustomError("No hay un logo que importar", 400);
  return uploadImage(source, LOGO_FOLDER);
}

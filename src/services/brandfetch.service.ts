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

/**
 * Con API key, el mejor logo del dominio para pintar sobre fondo claro.
 * Brandfetch llama "light" a los logos blancos (para fondos oscuros): esos solo
 * sirven compuestos sobre el color de marca, que la misma API trae. Orden:
 * logo oscuro grande > logo blanco sobre color de marca > ícono oscuro >
 * logo oscuro chico. Si nada aplica, null y se usa el icono de la búsqueda.
 */
async function brandApiLogo(domain: string): Promise<{ src: string; background?: string } | null> {
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
      colors?: Array<{ hex?: string; type?: string }>;
      logos?: Array<{
        type?: string;
        theme?: string;
        formats?: Array<{ src?: string; format?: string; width?: number }>;
      }>;
    };
    const brand = (data.colors?.find((c) => c.type === "brand") ?? data.colors?.[0])?.hex?.replace(
      "#",
      "",
    );
    const candidates: Array<{ src: string; score: number; background?: string }> = [];
    for (const logo of data.logos ?? []) {
      for (const f of logo.formats ?? []) {
        if (!f.src || !["png", "svg", "jpeg", "jpg"].includes(f.format ?? "")) continue;
        const wide = (f.width ?? 0) >= 100;
        let score = 0;
        let background: string | undefined;
        if (logo.theme === "dark")
          score = logo.type === "logo" ? (wide ? 4 : 1) : logo.type === "icon" ? 2 : 0;
        else if (logo.theme === "light" && logo.type === "logo" && wide && brand) {
          score = 3;
          background = brand;
        }
        if (score)
          candidates.push({
            src: f.src,
            score: score + (f.format === "png" ? 0.2 : 0),
            background,
          });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}

/** Copia el logo elegido a Cloudinary. Devuelve la URL que se guarda en la cuenta. */
export async function importLogo(candidate: {
  domain?: string;
  icon?: string;
}): Promise<{ url: string; publicId: string }> {
  const best = candidate.domain ? await brandApiLogo(candidate.domain) : null;
  const source = best?.src || candidate.icon;
  if (!source || !/^https?:\/\//.test(source))
    throw new CustomError("No hay un logo que importar", 400);
  return uploadImage(source, LOGO_FOLDER, best?.background);
}

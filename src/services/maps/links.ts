/**
 * Saca coordenadas de lo que el cliente pega: un "lat,lng" del mapa de la
 * tienda, un enlace de Google Maps (corto o largo) o el HTML al que redirige.
 * Portado de Teque Cruncheese; las heurísticas están explicadas ahí.
 */
export interface Coords {
  lat: number;
  lng: number;
}

/** Ecuador continental: cualquier par fuera es un número de calle o un zoom, no una dirección. */
const EC_BBOX = { minLat: -5.2, maxLat: 1.8, minLng: -81.3, maxLng: -74.9 };

const NUM = "(-?\\d+\\.\\d+)";
/** De más a menos confiable: `!3d!4d` es el pin resuelto, `@` solo el centro del mapa. */
const COORD_PATTERNS: RegExp[] = [
  new RegExp(`!3d${NUM}!4d${NUM}`),
  new RegExp(
    `[?&](?:q|query|destination|daddr|saddr|ll|sll|center|mlat)=(?:loc:)?${NUM},\\+?${NUM}`,
  ),
  new RegExp(`/maps/(?:search|dir|place)/${NUM},\\+?${NUM}`),
  new RegExp(`@${NUM},${NUM}`),
  new RegExp(`"latitude"\\s*:\\s*${NUM}[\\s\\S]{0,120}?"longitude"\\s*:\\s*${NUM}`),
];
export const BARE_COORDS_RE = new RegExp(`^\\s*${NUM}\\s*,\\s*${NUM}\\s*$`);
/** Enlace de "cómo llegar": lo que importa es el destino, no el origen. */
export const DIRECTIONS_RE = /[?&](?:daddr|destination)=|\/maps\/dir\//i;
const DEST_PATTERNS: RegExp[] = [
  new RegExp(`[?&](?:daddr|destination)=(?:loc:)?${NUM},\\+?${NUM}`),
  new RegExp(`/maps/dir/[^/?#]*/${NUM},\\+?${NUM}`),
];
const ALLOWED_HOST_RE =
  /^(?:(?:www|maps)\.)?(?:google\.[a-z.]{2,6}|goo\.gl|g\.co|maps\.app\.goo\.gl|app\.goo\.gl)$/i;

export function isPlausible(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return (
    lat >= EC_BBOX.minLat && lat <= EC_BBOX.maxLat && lng >= EC_BBOX.minLng && lng <= EC_BBOX.maxLng
  );
}

/** Decodifica escape por escape: un `%` suelto no puede anular todo el texto. */
function decodeSafe(text: string): string {
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (seq) => {
    try {
      return decodeURIComponent(seq);
    } catch {
      return seq;
    }
  });
}

function matchAllCoords(text: string, pattern: RegExp): Coords[] {
  const found: Coords[] = [];
  for (const match of text.matchAll(new RegExp(pattern.source, "gi"))) {
    const lat = parseFloat(match[1]!);
    const lng = parseFloat(match[2]!);
    if (isPlausible(lat, lng)) found.push({ lat, lng });
  }
  return found;
}

/** `preferLast`: en una ruta los puntos van en orden de viaje, el último es el destino. */
export function extractCoords(text: string, preferLast = false): Coords | null {
  if (!text) return null;
  const bare = text.match(BARE_COORDS_RE);
  if (bare) {
    const lat = parseFloat(bare[1]!);
    const lng = parseFloat(bare[2]!);
    if (isPlausible(lat, lng)) return { lat, lng };
  }
  const decoded = decodeSafe(text);
  for (const candidate of decoded === text ? [text] : [text, decoded]) {
    for (const pattern of COORD_PATTERNS) {
      const hits = matchAllCoords(candidate, pattern);
      if (hits.length) return preferLast ? hits[hits.length - 1]! : hits[0]!;
    }
  }
  return null;
}

export function extractDestinationCoords(url: string, body: string, origin: Coords): Coords | null {
  for (const source of [url, decodeSafe(url)]) {
    for (const pattern of DEST_PATTERNS) {
      const hits = matchAllCoords(source, pattern);
      if (hits.length) return hits[0]!;
    }
  }
  const last = extractCoords(body, true);
  // Un pin sobre la tienda es el origen colándose, no la casa del cliente.
  if (last && haversineKm(origin, last) > 0.05) return last;
  return null;
}

/** Normaliza lo pegado (sin protocolo, con texto alrededor, con puntuación final) a una URL de Maps. */
export function normalizeMapsUrl(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const urlMatch = trimmed.match(/(https?:\/\/[^\s<>"']+)/i);
  let candidate = urlMatch
    ? urlMatch[1]!
    : /^(?:www\.|maps\.|goo\.gl|g\.co)/i.test(trimmed)
      ? `https://${trimmed.split(/\s+/)[0]}`
      : null;
  if (!candidate) return null;
  candidate = candidate.replace(/[.,;)\]]+$/, "");
  try {
    const parsed = new URL(candidate);
    if (!ALLOWED_HOST_RE.test(parsed.hostname)) return null;
    parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Nombre de lugar que trae un enlace sin pin (`?q=Mall del Sol, Guayaquil`), para geocodificar. */
export function extractPlaceQuery(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  for (const key of ["q", "query", "destination", "daddr"]) {
    const raw = parsed.searchParams.get(key);
    if (!raw) continue;
    const value = raw.replace(/^loc:/i, "").trim();
    if (!value || BARE_COORDS_RE.test(value) || !/[a-zA-ZÀ-ÿ]/.test(value)) continue;
    return value;
  }
  return null;
}

export function haversineKm(a: Coords, b: Coords): number {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

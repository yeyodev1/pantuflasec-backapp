import { env } from "../config/env";
import { DELIVERY_TARIFF } from "../config/shop";
import {
  Coords,
  DIRECTIONS_RE,
  extractCoords,
  extractDestinationCoords,
  extractPlaceQuery,
  haversineKm,
  normalizeMapsUrl,
} from "./maps/links";
import { drivingKm, followAndRead, geocodeAddress } from "./maps/routing";

/**
 * Cotización de la entrega en moto: de lo que el cliente pegó o marcó en el
 * mapa a coordenadas, kilómetros por carretera desde la tienda y precio del
 * tarifario. El front muestra una vista previa, pero el monto que se cobra es
 * siempre el que sale de aquí al crear el pedido.
 */
export interface DeliveryQuote {
  resolvedUrl: string;
  coords: Coords | null;
  km: number | null;
  /** null con coordenadas = fuera de la zona de la moto. */
  cost: number | null;
  kmSource: "driving" | "straight" | null;
}

const ORIGIN = (): Coords => ({ lat: env.STORE_LAT, lng: env.STORE_LNG });
const SAME_PLACE_KM = 0.05;

/**
 * `maps.app.goo.gl` responde a Chrome de escritorio con una interstitial sin
 * coordenadas y a los demás con un 302 limpio; por eso el agente simple va primero.
 */
const USER_AGENTS = [
  "Mozilla/5.0 (compatible; PantuflasBot/1.0)",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
];

/** Precio del tarifario para una distancia, o null si queda fuera del último tramo. */
export function deliveryCost(km: number): number | null {
  if (!Number.isFinite(km) || km < 0) return null;
  for (const [maxKm, price] of DELIVERY_TARIFF) if (km <= maxKm) return price;
  return null;
}

async function finalize(resolvedUrl: string, coords: Coords): Promise<DeliveryQuote> {
  const origin = ORIGIN();
  const straight = haversineKm(origin, coords);
  let km = straight;
  let kmSource: DeliveryQuote["kmSource"] = "straight";
  // Se rutea salvo que el pin esté sobre la tienda; una ruta absurda (mal
  // enganchada a otra vía) se descarta y vale la línea recta.
  if (straight > SAME_PLACE_KM) {
    const road = await drivingKm(origin, coords);
    if (road !== null && road >= straight * 0.9 && road <= straight * 3 + 2) {
      km = road;
      kmSource = "driving";
    }
  }
  km = Math.round(km * 100) / 100;
  return { resolvedUrl, coords, km, cost: deliveryCost(km), kmSource };
}

/** Nunca lanza: lo que no se pudo ubicar devuelve `coords: null`. */
export async function quote(raw: string): Promise<DeliveryQuote> {
  const input = String(raw ?? "").trim();
  const empty: DeliveryQuote = {
    resolvedUrl: input,
    coords: null,
    km: null,
    cost: null,
    kmSource: null,
  };
  if (!input) return empty;

  const direct = extractCoords(input);
  const normalized = normalizeMapsUrl(input);
  if (!normalized) {
    if (direct) return finalize(input, direct);
    // No es un enlace: puede ser una dirección escrita o un Plus Code.
    if (input.length >= 6 && /[a-zA-ZÀ-ÿ0-9]/.test(input)) {
      const geocoded = await geocodeAddress(input);
      if (geocoded) return finalize(input, geocoded);
    }
    return empty;
  }

  const origin = ORIGIN();
  const fromUrl = DIRECTIONS_RE.test(normalized)
    ? extractDestinationCoords(normalized, normalized, origin)
    : extractCoords(normalized);
  if (fromUrl) return finalize(normalized, fromUrl);

  let lastUrl = normalized;
  let placeQuery: string | null = extractPlaceQuery(normalized);
  for (const userAgent of USER_AGENTS) {
    const read = await followAndRead(normalized, userAgent);
    if (!read) continue;
    lastUrl = read.finalUrl;
    const coords = DIRECTIONS_RE.test(read.finalUrl)
      ? extractDestinationCoords(read.finalUrl, read.body, origin)
      : (extractCoords(read.finalUrl) ?? extractCoords(read.body));
    if (coords) return finalize(read.finalUrl, coords);
    placeQuery ??= extractPlaceQuery(read.finalUrl);
  }
  if (direct) return finalize(lastUrl, direct);
  if (placeQuery) {
    const geocoded = await geocodeAddress(placeQuery);
    if (geocoded) return finalize(lastUrl, geocoded);
  }
  return { ...empty, resolvedUrl: lastUrl };
}

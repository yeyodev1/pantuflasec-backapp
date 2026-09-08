import { env } from "../../config/env";
import { Coords, isPlausible } from "./links";

/**
 * Distancia por carretera en km. Google Routes si hay key (es el número que el
 * cliente compara con su app); si no, Valhalla y luego OSRM, gratis y sin key.
 * La línea recta se queda corta en Guayaquil por los ríos, por eso se rutea.
 */
export async function drivingKm(a: Coords, b: Coords): Promise<number | null> {
  if (env.GOOGLE_MAPS_API_KEY) {
    const km = await googleDrivingKm(a, b);
    if (km !== null) return km;
  }
  return (await valhallaDrivingKm(a, b)) ?? (await osrmDrivingKm(a, b));
}

async function withTimeout<T>(
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function googleDrivingKm(a: Coords, b: Coords): Promise<number | null> {
  return withTimeout(5000, async (signal) => {
    const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: a.lat, longitude: a.lng } } },
        destination: { location: { latLng: { latitude: b.lat, longitude: b.lng } } },
        travelMode: "DRIVE",
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { routes?: Array<{ distanceMeters?: number }> };
    const meters = data.routes?.[0]?.distanceMeters;
    return typeof meters === "number" && meters > 0 ? (meters / 1000) * env.GOOGLE_KM_FACTOR : null;
  });
}

async function valhallaDrivingKm(a: Coords, b: Coords): Promise<number | null> {
  return withTimeout(5000, async (signal) => {
    const response = await fetch("https://valhalla1.openstreetmap.de/route", {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "User-Agent": "PantuflasBot/1.0" },
      body: JSON.stringify({
        locations: [
          { lat: a.lat, lon: a.lng },
          { lat: b.lat, lon: b.lng },
        ],
        costing: "auto",
        units: "kilometers",
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { trip?: { summary?: { length?: number } } };
    const km = data.trip?.summary?.length;
    return typeof km === "number" && km > 0 ? km : null;
  });
}

async function osrmDrivingKm(a: Coords, b: Coords): Promise<number | null> {
  return withTimeout(5000, async (signal) => {
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=false&alternatives=false`;
    const response = await fetch(url, { signal, headers: { "User-Agent": "PantuflasBot/1.0" } });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      code?: string;
      routes?: Array<{ distance?: number }>;
    };
    const meters = data.code === "Ok" ? data.routes?.[0]?.distance : undefined;
    return typeof meters === "number" && meters > 0 ? meters / 1000 : null;
  });
}

/** Coordenadas de una dirección escrita (Google Geocoding, sesgado a Ecuador). Sin key, nada. */
export async function geocodeAddress(query: string): Promise<Coords | null> {
  if (!env.GOOGLE_MAPS_API_KEY) return null;
  return withTimeout(5000, async (signal) => {
    const url =
      "https://maps.googleapis.com/maps/api/geocode/json" +
      `?address=${encodeURIComponent(query)}&region=ec&language=es` +
      `&bounds=-5.2,-81.3|1.8,-74.9&key=${env.GOOGLE_MAPS_API_KEY}`;
    const response = await fetch(url, { signal });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      status?: string;
      results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
    };
    const loc = data.status === "OK" ? data.results?.[0]?.geometry?.location : undefined;
    if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number") return null;
    return isPlausible(loc.lat, loc.lng) ? { lat: loc.lat, lng: loc.lng } : null;
  });
}

/** Sigue redirecciones (los enlaces cortos llevan las coordenadas en la URL final o en el HTML). */
export async function followAndRead(
  url: string,
  userAgent: string,
): Promise<{ finalUrl: string; body: string } | null> {
  return withTimeout(8000, async (signal) => {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal,
      headers: {
        "User-Agent": userAgent,
        "Accept-Language": "es-EC,es;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    let body = "";
    try {
      body = (await response.text()).slice(0, 200_000);
    } catch {
      /* con la URL final suele bastar */
    }
    return { finalUrl: response.url || url, body };
  });
}

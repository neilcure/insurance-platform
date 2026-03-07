import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { parseHongKongAddress, HONG_KONG_DISTRICTS } from "@/lib/address/hk";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type GeocodeOk = {
  ok: true;
  provider: "google_geocode";
  query: string;
  formattedAddress?: string;
  placeId?: string;
  partialMatch?: boolean;
  locationType?: string;
  location?: { lat: number; lng: number };
  inHongKong?: boolean;
  parts?: {
    flatNumber?: string;
    floorNumber?: string;
    blockNumber?: string;
    blockName?: string;
    streetNumber?: string;
    streetName?: string;
    propertyName?: string;
    districtName?: string;
    area?: string;
  };
};

type GeocodeErr = {
  ok: false;
  error: string;
  errorMessage?: string;
  details?: unknown;
};

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function inHongKongBounds(lat?: number, lng?: number): boolean | undefined {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return undefined;
  // Rough bounding box for Hong Kong.
  return lat >= 22.14 && lat <= 22.58 && lng >= 113.83 && lng <= 114.45;
}

function deriveAreaFromDistrict(d?: string): string | undefined {
  if (!d) return undefined;
  const s = d.toLowerCase();
  // Official 18 districts
  const kowloon = ["kowloon city", "yau tsim mong", "sham shui po", "wong tai sin", "kwun tong"];
  const hkIsland = ["central and western", "eastern", "southern", "wan chai"];
  const newTerr = ["islands", "kwai tsing", "north", "sai kung", "sha tin", "tai po", "tsuen wan", "tuen mun", "yuen long"];
  if (kowloon.some((k) => s.includes(k))) return "Kowloon";
  if (hkIsland.some((k) => s.includes(k))) return "Hong Kong Island";
  if (newTerr.some((k) => s.includes(k))) return "New Territories";
  // Common neighborhood → area mapping
  const kowloonNeighborhoods = [
    "to kwa wan", "kowloon tong", "kowloon bay", "ngau tau kok", "kwai chung",
    "tsing yi", "lei yue mun", "diamond hill", "san po kong", "cheung sha wan",
    "lai chi kok", "hung hom", "mong kok", "tsim sha tsui", "jordan", "lam tin",
  ];
  const hkIslandNeighborhoods = [
    "aberdeen", "ap lei chau", "stanley", "repulse bay", "happy valley",
    "pok fu lam", "kennedy town", "sai ying pun", "mid-levels", "north point",
    "quarry bay", "chai wan", "shau kei wan", "sai wan ho", "sheung wan", "causeway bay",
  ];
  const newTerrNeighborhoods = [
    "fanling", "sheung shui", "tin shui wai", "tseung kwan o", "ma on shan",
    "tung chung", "yuen long town", "kam tin", "shatin", "tai wai",
    "lo wu", "lok ma chau", "discovery bay", "cheung chau", "peng chau",
    "lamma island", "mui wo",
  ];
  if (kowloonNeighborhoods.some((k) => s.includes(k))) return "Kowloon";
  if (hkIslandNeighborhoods.some((k) => s.includes(k))) return "Hong Kong Island";
  if (newTerrNeighborhoods.some((k) => s.includes(k))) return "New Territories";
  return undefined;
}

function cleanText(x: unknown): string | undefined {
  const s = String(x ?? "").trim();
  return s ? s : undefined;
}

function pickComponent(
  components: Array<{ long_name?: unknown; short_name?: unknown; types?: unknown }> | null | undefined,
  wantType: string,
  which: "long" | "short" = "long",
): string | undefined {
  if (!Array.isArray(components)) return undefined;
  for (const c of components) {
    const types = Array.isArray((c as any)?.types) ? ((c as any).types as string[]) : [];
    if (types.includes(wantType)) {
      return cleanText(which === "short" ? (c as any).short_name : (c as any).long_name);
    }
  }
  return undefined;
}

export async function POST(request: Request) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" } satisfies GeocodeErr, { status: 401 });
  }

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" } satisfies GeocodeErr, { status: 400 });
  }

  const query = String(body?.text ?? body?.address ?? body?.query ?? "").trim();
  if (!query) {
    return NextResponse.json({ ok: false, error: "Missing address text" } satisfies GeocodeErr, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "Geocoding provider not configured (missing GOOGLE_MAPS_API_KEY)",
      } satisfies GeocodeErr,
      { status: 501 },
    );
  }

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("region", "hk");
  url.searchParams.set("components", "country:HK");
  url.searchParams.set("language", "en");
  url.searchParams.set("key", apiKey);

  let data: any = null;
  try {
    const res = await fetch(url.toString(), { method: "GET", cache: "no-store" });
    data = await res.json().catch(() => null);
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: "Geocoding request failed", details: (err as any)?.message ?? err } satisfies GeocodeErr,
      { status: 502 },
    );
  }

  const status = String(data?.status ?? "");
  if (status !== "OK") {
    const errorMessage = typeof data?.error_message === "string" ? data.error_message : undefined;
    const http =
      status === "OVER_QUERY_LIMIT" ? 429 : status === "REQUEST_DENIED" ? 403 : status === "INVALID_REQUEST" ? 400 : 422;
    return NextResponse.json(
      {
        ok: false,
        error: status || "Geocoding failed",
        errorMessage,
        details: errorMessage ?? data,
      } satisfies GeocodeErr,
      { status: http },
    );
  }

  const first = Array.isArray(data?.results) ? data.results[0] : null;
  const addressComponents = (Array.isArray(first?.address_components) ? first.address_components : null) as Array<{
    long_name?: unknown;
    short_name?: unknown;
    types?: unknown;
  }> | null;
  const location = first?.geometry?.location ?? null;
  const lat = typeof location?.lat === "number" ? location.lat : Number(location?.lat);
  const lng = typeof location?.lng === "number" ? location.lng : Number(location?.lng);

  // Best-effort HK-oriented extraction from Google's address_components.
  // Note: Google components vary; this is heuristic and intended as "helpful defaults", not a strict parser.
  const streetNumber = pickComponent(addressComponents, "street_number");
  const streetName = pickComponent(addressComponents, "route");
  const flatNumber = pickComponent(addressComponents, "subpremise");
  const floorNumber = pickComponent(addressComponents, "floor");
  const neighborhoodRaw = pickComponent(addressComponents, "neighborhood");
  const isNeighborhoodADistrict = neighborhoodRaw
    ? HONG_KONG_DISTRICTS.some((d) => d.toLowerCase() === neighborhoodRaw.toLowerCase())
    : false;
  const propertyName =
    pickComponent(addressComponents, "premise") ||
    pickComponent(addressComponents, "establishment") ||
    pickComponent(addressComponents, "point_of_interest") ||
    (isNeighborhoodADistrict ? undefined : neighborhoodRaw);
  const districtName =
    pickComponent(addressComponents, "administrative_area_level_3") ||
    pickComponent(addressComponents, "administrative_area_level_2") ||
    pickComponent(addressComponents, "sublocality_level_1") ||
    pickComponent(addressComponents, "locality") ||
    (isNeighborhoodADistrict ? neighborhoodRaw : undefined);
  const area =
    pickComponent(addressComponents, "administrative_area_level_1") ||
    pickComponent(addressComponents, "sublocality") ||
    pickComponent(addressComponents, "postal_town");

  // Parse raw text to recover unit/floor/block that Google often omits.
  const parsed = parseHongKongAddress(query);
  const parsedArea = deriveAreaFromDistrict(parsed?.districtName);

  const merged = {
    flatNumber: flatNumber ?? parsed?.flatNumber,
    floorNumber: floorNumber ?? parsed?.floorNumber,
    // Google usually doesn't provide block number/name for HK addresses; prefer parsed.
    blockNumber: parsed?.blockNumber,
    blockName: parsed?.blockName,
    streetNumber: streetNumber ?? parsed?.streetNumber,
    streetName: streetName ?? parsed?.streetName,
    propertyName: propertyName ?? parsed?.propertyName,
    districtName: districtName ?? parsed?.districtName,
    area: area ?? parsedArea,
  };

  const payload: GeocodeOk = {
    ok: true,
    provider: "google_geocode",
    query,
    formattedAddress: typeof first?.formatted_address === "string" ? first.formatted_address : undefined,
    placeId: typeof first?.place_id === "string" ? first.place_id : undefined,
    partialMatch: typeof first?.partial_match === "boolean" ? first.partial_match : undefined,
    locationType: typeof first?.geometry?.location_type === "string" ? first.geometry.location_type : undefined,
    location: isFiniteNumber(lat) && isFiniteNumber(lng) ? { lat, lng } : undefined,
    inHongKong: inHongKongBounds(isFiniteNumber(lat) ? lat : undefined, isFiniteNumber(lng) ? lng : undefined),
    parts: {
      ...merged,
    },
  };

  return NextResponse.json(payload, {
    status: 200,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}


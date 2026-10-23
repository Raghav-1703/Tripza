import { TALEGAON_LANDMARKS, TALEGAON_CENTER, LocalLandmark } from "@/data/talegaonLandmarks";

export interface LocationSearchResult {
  name: string;
  lat: number;
  lon: number;
  category?: string;
  subtitle?: string;
  isLocal?: boolean;
  distanceKm?: number;
}

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeString(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface ScoredMatch {
  item: LocalLandmark;
  score: number;
}

// 1. Curated local landmark matching with fuzzy, alias, and prefix scoring
function matchLocalLandmarks(query: string): ScoredMatch[] {
  const qClean = query.toLowerCase().trim();
  const qNorm = normalizeString(query);
  const qTokens = qClean.split(/\s+/).filter(Boolean);

  const scored: ScoredMatch[] = [];

  for (const item of TALEGAON_LANDMARKS) {
    let bestScore = 0;
    const nameClean = item.name.toLowerCase();
    const nameNorm = normalizeString(item.name);

    // Exact or prefix matches on landmark name
    if (nameClean === qClean || nameNorm === qNorm) {
      bestScore = Math.max(bestScore, 100);
    } else if (nameClean.startsWith(qClean) || nameNorm.startsWith(qNorm)) {
      bestScore = Math.max(bestScore, 88);
    } else if (nameClean.includes(qClean) || nameNorm.includes(qNorm)) {
      bestScore = Math.max(bestScore, 72);
    }

    // Matches on aliases (spelling variations, abbreviations, partial keywords)
    for (const alias of item.aliases) {
      const aClean = alias.toLowerCase();
      const aNorm = normalizeString(alias);
      if (aClean === qClean || aNorm === qNorm) {
        bestScore = Math.max(bestScore, 95);
      } else if (aClean.startsWith(qClean) || aNorm.startsWith(qNorm)) {
        bestScore = Math.max(bestScore, 82);
      } else if (aClean.includes(qClean) || aNorm.includes(qNorm)) {
        bestScore = Math.max(bestScore, 68);
      }
    }

    // Tokenized search for multi-word queries
    if (qTokens.length > 1) {
      const matchesAllTokens = qTokens.every(
        (tok) =>
          nameClean.includes(tok) ||
          item.subtitle.toLowerCase().includes(tok) ||
          item.aliases.some((a) => a.includes(tok))
      );
      if (matchesAllTokens) {
        bestScore = Math.max(bestScore, 80);
      }
    }

    if (bestScore > 0) {
      scored.push({ item, score: bestScore });
    }
  }

  return scored.sort((a, b) => b.score - a.score);
}

interface PhotonFeature {
  properties?: {
    name?: string;
    street?: string;
    locality?: string;
    city?: string;
    district?: string;
    subdistrict?: string;
    county?: string;
    state?: string;
    country?: string;
    osm_value?: string;
    type?: string;
  };
  geometry?: {
    coordinates?: [number, number];
  };
}

interface NominatimFeature {
  place_id?: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  type?: string;
  class?: string;
}

interface ScoredLocationResult extends LocationSearchResult {
  score: number;
}

// 2. Fetch remote OpenStreetMap geocoding (Photon with Nominatim fallback)
async function fetchPhotonResults(query: string, limit: number = 8): Promise<ScoredLocationResult[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=${TALEGAON_CENTER.lat}&lon=${TALEGAON_CENTER.lon}&limit=${limit}`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) return [];

    const data = await res.json();
    if (!data || !Array.isArray(data.features)) return [];

    const qNorm = normalizeString(query);

    return data.features
      .filter((f: PhotonFeature) => f?.geometry?.coordinates && Array.isArray(f.geometry.coordinates))
      .map((f: PhotonFeature) => {
        const p = f.properties || {};
        const [lon, lat] = f.geometry!.coordinates!;

        const displayName = p.name || p.street || p.city || "Location";
        const parts = [
          p.street,
          p.locality,
          p.district || p.subdistrict || p.county,
          p.city,
          p.state,
          p.country,
        ].filter(Boolean);

        // Remove duplicates and trim subtitle
        const uniqueParts = Array.from(new Set(parts)).filter((part) => part !== displayName);
        const subtitle = uniqueParts.slice(0, 3).join(", ") || p.state || "Maharashtra, India";

        const dist = haversineDistanceKm(TALEGAON_CENTER.lat, TALEGAON_CENTER.lon, lat, lon);

        // Calculate relevance score
        let score = 30;
        if (dist <= 8) score += 45; // Inside Talegaon Dabhade & immediate surroundings
        else if (dist <= 25) score += 30; // PCMC / Pimpri-Chinchwad / Mawal
        else if (dist <= 60) score += 15; // Greater Pune / Lonavala
        else if (dist > 500) score -= 35; // Foreign or overseas penalty

        const normDisplay = normalizeString(displayName);
        if (normDisplay === qNorm) score += 25;
        else if (normDisplay.startsWith(qNorm)) score += 15;

        return {
          name: displayName,
          lat,
          lon,
          subtitle,
          category: p.osm_value || p.type || "place",
          distanceKm: dist,
          isLocal: dist <= 12,
          score,
        };
      });
  } catch {
    // Photon unavailable or timed out, will fallback
    return [];
  }
}

async function fetchNominatimResults(query: string, limit: number = 6): Promise<ScoredLocationResult[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=${limit}&addressdetails=1`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "TPool-App/1.0 (talegaon-carpooling)",
        "Accept-Language": "en",
      },
    });
    clearTimeout(timeoutId);

    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];

    const qNorm = normalizeString(query);

    return (data as NominatimFeature[]).map((item) => {
      const lat = parseFloat(item.lat);
      const lon = parseFloat(item.lon);
      const displayName = item.name || item.display_name.split(",")[0].trim();
      const rawParts = item.display_name.split(",").map((s: string) => s.trim());
      const uniqueParts = Array.from(new Set(rawParts)).filter((s) => s !== displayName);
      const subtitle = uniqueParts.slice(0, 3).join(", ") || "India";

      const dist = haversineDistanceKm(TALEGAON_CENTER.lat, TALEGAON_CENTER.lon, lat, lon);

      let score = 25;
      if (dist <= 8) score += 40;
      else if (dist <= 25) score += 25;
      else if (dist <= 60) score += 10;
      else if (dist > 500) score -= 30;

      const normDisplay = normalizeString(displayName);
      if (normDisplay === qNorm) score += 25;
      else if (normDisplay.startsWith(qNorm)) score += 15;

      return {
        name: displayName,
        lat,
        lon,
        subtitle,
        category: item.type || item.class || "place",
        distanceKm: dist,
        isLocal: dist <= 12,
        score,
      };
    });
  } catch {
    return [];
  }
}

async function fetchRemoteResults(query: string, limit: number = 8): Promise<ScoredLocationResult[]> {
  const photon = await fetchPhotonResults(query, limit);
  if (photon.length > 0) return photon;
  return await fetchNominatimResults(query, limit);
}

/**
 * Main Hybrid Location Search
 * Prioritizes verified local landmarks in Talegaon Dabhade while seamlessly allowing regional & out-of-town searches.
 */
export async function searchLocations(
  query: string,
  options?: { limit?: number; biasCenter?: { lat: number; lon: number } }
): Promise<LocationSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) return [];

  const limit = options?.limit || 6;
  const localMatches = matchLocalLandmarks(trimmed);

  // Map local matches to LocationSearchResult with high initial scores
  const localResults: ScoredLocationResult[] = localMatches.map(({ item, score }) => ({
    name: item.name,
    lat: item.lat,
    lon: item.lon,
    subtitle: item.subtitle,
    category: item.category,
    distanceKm: haversineDistanceKm(TALEGAON_CENTER.lat, TALEGAON_CENTER.lon, item.lat, item.lon),
    isLocal: true,
    score: score + 50, // Prioritize local landmarks
  }));

  // Fetch remote results (Photon biased with Nominatim fallback)
  const remoteResults = await fetchRemoteResults(trimmed, 10);

  // Merge & Deduplicate
  const merged: ScoredLocationResult[] = [...localResults];

  for (const pr of remoteResults) {
    // Check if duplicate of an existing local landmark (within 300m or identical normalized name within 1km)
    const isDuplicate = merged.some((mr) => {
      const d = haversineDistanceKm(mr.lat, mr.lon, pr.lat, pr.lon);
      return d < 0.3 || (normalizeString(mr.name) === normalizeString(pr.name) && d < 1.5);
    });

    if (!isDuplicate) {
      // Discard overseas / far results (>300km) if we already have strong local matches
      if (localResults.length > 0 && (pr.distanceKm || 0) > 300) {
        continue;
      }
      merged.push(pr);
    }
  }

  // Sort by score descending and return top matches
  return merged
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => ({
      name: item.name,
      lat: item.lat,
      lon: item.lon,
      subtitle: item.subtitle,
      category: item.category,
      distanceKm: item.distanceKm,
      isLocal: item.isLocal,
    }));
}

/**
 * Resolves a location name or search string into exact coordinates.
 * Checks local verified landmarks first, then falls back to geocoding.
 */
export async function resolveLocationText(
  text: string
): Promise<{ name: string; lat: number; lon: number } | null> {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 2) return null;

  // 1. Direct local landmark check
  const local = matchLocalLandmarks(trimmed);
  if (local.length > 0 && local[0].score >= 70) {
    return {
      name: local[0].item.name,
      lat: local[0].item.lat,
      lon: local[0].item.lon,
    };
  }

  // 2. Fall back to searchLocations
  const results = await searchLocations(trimmed, { limit: 1 });
  if (results.length > 0) {
    return {
      name: results[0].name,
      lat: results[0].lat,
      lon: results[0].lon,
    };
  }

  return null;
}

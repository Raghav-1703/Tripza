import { resolveLocationText } from "./locationSearch";

export async function geocode(query: string) {
  if (!query || query.trim().length < 2) return null;
  const trimmed = query.trim();

  // 1. Check verified local landmarks and hybrid search resolver first
  try {
    const resolved = await resolveLocationText(trimmed);
    if (resolved && typeof resolved.lat === "number" && typeof resolved.lon === "number") {
      return { lat: resolved.lat, lon: resolved.lon };
    }
  } catch (e) {
    console.error("resolveLocationText failed:", e);
  }

  // 2. Try Photon API with Talegaon coordinate bias
  try {
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(trimmed)}&lat=18.735&lon=73.675&limit=1`);
    const data = await res.json();
    if (data && data.features && data.features.length > 0) {
      const coords = data.features[0].geometry.coordinates; // Photon coordinates format: [lon, lat]
      return { lat: coords[1], lon: coords[0] };
    }
  } catch (e) {
    console.error("Photon geocode failed:", e);
  }

  // 3. Fall back to Nominatim
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(trimmed)}&limit=1`, {
      headers: { "User-Agent": "TpoolApp/1.0" }
    });
    const data = await res.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
  } catch (e) {
    console.error("Nominatim geocode fallback failed:", e);
  }

  return null;
}

export function decodePolyline6(str: string): [number, number][] {
  let index = 0, lat = 0, lng = 0;
  const coordinates: [number, number][] = [];
  const factor = 1e6;
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += dlng;
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

export function getProjectedPoint(lat: number, lon: number, lat1: number, lon1: number, lat2: number, lon2: number) {
  const x0 = lon; const y0 = lat;
  const x1 = lon1; const y1 = lat1;
  const x2 = lon2; const y2 = lat2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx*dx + dy*dy;
  if (l2 === 0) return { lat: lat1, lon: lon1, t: 0 };
  let t = ((x0 - x1) * dx + (y0 - y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return { lat: y1 + t * dy, lon: x1 + t * dx, t };
}

export function pointToSegmentDistance(lat: number, lon: number, lat1: number, lon1: number, lat2: number, lon2: number) {
  const proj = getProjectedPoint(lat, lon, lat1, lon1, lat2, lon2);
  return haversineDistance(lat, lon, proj.lat, proj.lon);
}

export function pointToRouteDistance(lat: number, lon: number, route: [number, number][]) {
  let minDist = Infinity;
  let minIndex = -1;
  let minProj = { lat: 0, lon: 0, t: 0 };
  for (let i = 0; i < route.length - 1; i++) {
    const proj = getProjectedPoint(lat, lon, route[i][0], route[i][1], route[i+1][0], route[i+1][1]);
    const d = haversineDistance(lat, lon, proj.lat, proj.lon);
    if (d < minDist) {
      minDist = d;
      minIndex = i;
      minProj = proj;
    }
  }
  return { minDist, minIndex, minProj };
}

export function getRouteSegmentDistance(
  route: [number, number][],
  startIndex: number,
  startProj: { lat: number, lon: number },
  endIndex: number,
  endProj: { lat: number, lon: number }
) {
  if (startIndex > endIndex) return 0; // Invalid direction
  
  if (startIndex === endIndex) {
    return haversineDistance(startProj.lat, startProj.lon, endProj.lat, endProj.lon);
  }

  let dist = 0;
  // Distance from projected start to the end of the start segment
  dist += haversineDistance(startProj.lat, startProj.lon, route[startIndex+1][0], route[startIndex+1][1]);
  
  // Full segments in between
  for (let i = startIndex + 1; i < endIndex; i++) {
    dist += haversineDistance(route[i][0], route[i][1], route[i+1][0], route[i+1][1]);
  }
  
  // Distance from start of end segment to projected end
  dist += haversineDistance(route[endIndex][0], route[endIndex][1], endProj.lat, endProj.lon);
  
  return dist; // in km
}

export const TALEGAON_STATION_COORDS = {
  name: "Talegaon Railway Station",
  lat: 18.7367,
  lon: 73.6705,
};

export function shouldRouteViaTalegaonStation(
  start: { lat: number; lon: number; name?: string },
  end: { lat: number; lon: number; name?: string },
  startName?: string,
  endName?: string
): boolean {
  const sName = (startName || start.name || "").toLowerCase();
  const eName = (endName || end.name || "").toLowerCase();

  const isZudioStart = sName.includes("zudio") || haversineDistance(start.lat, start.lon, 18.7213, 73.6685) <= 1.0;
  const isIiitEnd = eName.includes("iiit") || haversineDistance(end.lat, end.lon, 18.7659, 73.6848) <= 1.0;

  const isIiitStart = sName.includes("iiit") || haversineDistance(start.lat, start.lon, 18.7659, 73.6848) <= 1.0;
  const isZudioEnd = eName.includes("zudio") || haversineDistance(end.lat, end.lon, 18.7213, 73.6685) <= 1.0;

  if ((isZudioStart && isIiitEnd) || (isIiitStart && isZudioEnd)) {
    const sDistStn = haversineDistance(start.lat, start.lon, TALEGAON_STATION_COORDS.lat, TALEGAON_STATION_COORDS.lon);
    const eDistStn = haversineDistance(end.lat, end.lon, TALEGAON_STATION_COORDS.lat, TALEGAON_STATION_COORDS.lon);
    if (sDistStn < 0.4 || eDistStn < 0.4) return false;
    return true;
  }

  // General Talegaon South-to-North corridor through Station Road
  const inTalegaonLat = (lat: number) => lat >= 18.70 && lat <= 18.78;
  const inTalegaonLon = (lon: number) => lon >= 73.64 && lon <= 73.71;

  if (inTalegaonLat(start.lat) && inTalegaonLon(start.lon) && inTalegaonLat(end.lat) && inTalegaonLon(end.lon)) {
    const sDistStn = haversineDistance(start.lat, start.lon, TALEGAON_STATION_COORDS.lat, TALEGAON_STATION_COORDS.lon);
    const eDistStn = haversineDistance(end.lat, end.lon, TALEGAON_STATION_COORDS.lat, TALEGAON_STATION_COORDS.lon);
    if (sDistStn < 0.4 || eDistStn < 0.4) return false;

    if ((start.lat < 18.732 && end.lat > 18.745) || (start.lat > 18.745 && end.lat < 18.732)) {
      return true;
    }
  }

  return false;
}

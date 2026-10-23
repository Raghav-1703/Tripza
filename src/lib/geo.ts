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

"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useState, useRef, ReactNode, CSSProperties } from "react";
import { TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import { LeafletProvider, createLeafletContext } from "@react-leaflet/core";
import L, { Map as LeafletMap, MapOptions } from "leaflet";
import type { LiveLocationData } from "./RouteMap";
import { resolveLocationText } from "@/lib/locationSearch";
import { TALEGAON_STATION_COORDS, shouldRouteViaTalegaonStation } from "@/lib/geo";

// Fix Leaflet marker icons in Next.js
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

interface Location {
  lat: number;
  lon: number;
  name: string;
}

export interface RouteInfo {
  distance: number; // in meters
  duration: number; // in seconds
}

export interface MapLocation {
  name: string;
  lat?: number;
  lon?: number;
}

export interface RouteStopPoint {
  id: string;
  type: "PICKUP" | "DROP";
  bookingId?: string;
  passengerName?: string;
  locationName: string;
  lat: number;
  lon: number;
}

export interface RouteMapClientProps {
  origin: string | MapLocation;
  destination: string | MapLocation;
  passengerOrigin?: string | MapLocation;
  passengerDestination?: string | MapLocation;
  liveLocation?: LiveLocationData | null;
  routeGeometry?: [number, number][];
  stops?: RouteStopPoint[];
  onRouteCalculated?: (info: RouteInfo | null) => void;
}

const greenIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const redIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// High-visibility, top-down animated moving vehicle pointer with forward directional beacon
function createVehicleIcon(initialHeading?: number | null) {
  const rotation = typeof initialHeading === "number" && !isNaN(initialHeading) ? Math.round(initialHeading) : 0;

  return L.divIcon({
    className: "driver-moving-vehicle-icon-wrapper",
    html: `
      <div style="position: relative; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; pointer-events: auto;">
        <!-- Pulsing radar wave -->
        <span style="position: absolute; width: 42px; height: 42px; border-radius: 9999px; background-color: rgba(16, 185, 129, 0.35); animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></span>
        
        <!-- Rotating vehicle puck (default base orientation: North / 0° pointing UP) -->
        <div class="vehicle-puck-rotator" style="position: relative; width: 34px; height: 34px; border-radius: 9999px; background: linear-gradient(135deg, #10b981 0%, #047857 100%); border: 2.5px solid #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; transform: rotate(${rotation}deg); transform-origin: 50% 50%; transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);">
          
          <!-- Forward direction pointer arrowhead (Pointing UP / North) -->
          <div style="position: absolute; top: -6px; left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 7px solid #10b981; filter: drop-shadow(0 -1px 2px rgba(0,0,0,0.35));"></div>
          
          <!-- Top-down car body silhouette facing UP (North = 0°) -->
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" style="display: block;">
            <!-- Car body (front at y=3, rear at y=21) -->
            <path d="M7 6.5C7 4.5 8.5 3 12 3C15.5 3 17 4.5 17 6.5V17.5C17 19.5 15.5 21 12 21C8.5 21 7 19.5 7 17.5V6.5Z" fill="#ffffff" />
            <!-- Windshield (dark glass near top / front) -->
            <path d="M8.2 7.8C8.8 6.6 9.8 6 12 6C14.2 6 15.2 6.6 15.8 7.8C15.5 9 14.8 9.5 12 9.5C9.2 9.5 8.5 9 8.2 7.8Z" fill="#047857" />
            <!-- Rear window (near bottom / rear) -->
            <path d="M8.8 16C9.2 15.2 10.2 14.8 12 14.8C13.8 14.8 14.8 15.2 15.2 16C15 16.8 14.2 17.2 12 17.2C9.8 17.2 9 16.8 8.8 16Z" fill="#047857" />
            <!-- Left side mirror -->
            <rect x="5.5" y="7.5" width="1.5" height="3" rx="0.75" fill="#ffffff" />
            <!-- Right side mirror -->
            <rect x="17" y="7.5" width="1.5" height="3" rx="0.75" fill="#ffffff" />
            <!-- Headlights (amber/yellow at front) -->
            <circle cx="9" cy="4" r="0.9" fill="#fef08a" />
            <circle cx="15" cy="4" r="0.9" fill="#fef08a" />
            <!-- Taillights (red at rear) -->
            <rect x="8" y="20.2" width="2" height="0.8" rx="0.4" fill="#ef4444" />
            <rect x="14" y="20.2" width="2" height="0.8" rx="0.4" fill="#ef4444" />
          </svg>
        </div>
      </div>
    `,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22],
  });
}

function isValidCoord(lat: unknown, lon: unknown): lat is number {
  return typeof lat === "number" && typeof lon === "number" && !isNaN(lat) && !isNaN(lon) && isFinite(lat) && isFinite(lon);
}

// MovingVehicleMarker animates coordinate glide smoothly and updates rotation on the inner element
function MovingVehicleMarker({ liveLocation }: { liveLocation: LiveLocationData }) {
  const markerRef = useRef<L.Marker | null>(null);
  const currentPosRef = useRef<[number, number]>([
    isValidCoord(liveLocation.lat, liveLocation.lon) ? liveLocation.lat : 0,
    isValidCoord(liveLocation.lat, liveLocation.lon) ? liveLocation.lon : 0
  ]);
  const currentHeadingRef = useRef<number>(
    typeof liveLocation.heading === "number" && !isNaN(liveLocation.heading) ? liveLocation.heading : 0
  );
  const rafIdRef = useRef<number | null>(null);
  const iconRef = useRef<L.DivIcon | null>(null);

  if (!iconRef.current && isValidCoord(liveLocation.lat, liveLocation.lon)) {
    iconRef.current = createVehicleIcon(liveLocation.heading);
  }

  // Shortest angle rotation prevents 360° reverse spinning when crossing 0°/360°
  const getContinuousAngle = (from: number, to: number) => {
    let diff = (to - from) % 360;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return from + diff;
  };

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker || !isValidCoord(liveLocation.lat, liveLocation.lon)) return;

    // Smooth heading rotation applied to the inner rotating element
    if (typeof liveLocation.heading === "number" && !isNaN(liveLocation.heading)) {
      const nextAngle = getContinuousAngle(currentHeadingRef.current, liveLocation.heading);
      currentHeadingRef.current = nextAngle;
      const el = marker.getElement()?.querySelector(".vehicle-puck-rotator") as HTMLElement | null;
      if (el) {
        el.style.transform = `rotate(${Math.round(nextAngle)}deg)`;
      }
    }

    // Smooth coordinate interpolation directly using marker.setLatLng()
    const targetLat = liveLocation.lat;
    const targetLon = liveLocation.lon;
    const [startLat, startLon] = currentPosRef.current;

    const dLat = targetLat - startLat;
    const dLon = targetLon - startLon;

    // If movement is negligible, snap directly
    if (Math.abs(dLat) < 0.000005 && Math.abs(dLon) < 0.000005) {
      currentPosRef.current = [targetLat, targetLon];
      marker.setLatLng([targetLat, targetLon]);
      return;
    }

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    const duration = 900; // ms glide window
    const startTime = performance.now();

    const step = (time: number) => {
      const elapsed = time - startTime;
      const progress = Math.min(1, elapsed / duration);
      // Ease-out cubic for realistic vehicle deceleration into position
      const ease = 1 - Math.pow(1 - progress, 3);

      const nextLat = startLat + dLat * ease;
      const nextLon = startLon + dLon * ease;
      currentPosRef.current = [nextLat, nextLon];
      marker.setLatLng([nextLat, nextLon]);

      if (progress < 1) {
        rafIdRef.current = requestAnimationFrame(step);
      } else {
        rafIdRef.current = null;
      }
    };

    rafIdRef.current = requestAnimationFrame(step);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [liveLocation.lat, liveLocation.lon, liveLocation.heading]);

  if (!isValidCoord(liveLocation.lat, liveLocation.lon)) {
    return null;
  }

  return (
    <Marker
      ref={markerRef}
      position={[liveLocation.lat, liveLocation.lon]}
      icon={iconRef.current || undefined}
      zIndexOffset={1000}
    >
      <Popup>
        <div className="text-xs p-1 space-y-1">
          <p className="font-bold flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <span>🚗</span>
            <span>Driver Vehicle (Live)</span>
          </p>
          {liveLocation.updatedAt ? (
            <p className="text-[11px] text-muted-foreground">
              Last update: {liveLocation.updatedAt}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">Live GPS active</p>
          )}
          {liveLocation.heading != null && !isNaN(liveLocation.heading) && (
            <p className="text-[10px] text-muted-foreground">
              Heading: {Math.round(liveLocation.heading)}°
            </p>
          )}
        </div>
      </Popup>
    </Marker>
  );
}

// User-friendly map follower that avoids fighting manual panning
function DriverFollower({ liveLocation }: { liveLocation?: LiveLocationData | null }) {
  const map = useMap();
  const [isFollowing, setIsFollowing] = useState(false);
  const hasFocusedOnceRef = useRef(false);

  // Soft one-time focus when first coordinates arrive
  useEffect(() => {
    if (!hasFocusedOnceRef.current && liveLocation && !isNaN(liveLocation.lat) && !isNaN(liveLocation.lon)) {
      hasFocusedOnceRef.current = true;
      map.panTo([liveLocation.lat, liveLocation.lon], { animate: true, duration: 0.8 });
    }
  }, [liveLocation, map]);

  // When follow mode is active, smoothly pan with vehicle movement
  useEffect(() => {
    if (isFollowing && liveLocation && !isNaN(liveLocation.lat) && !isNaN(liveLocation.lon)) {
      map.panTo([liveLocation.lat, liveLocation.lon], { animate: true, duration: 0.6 });
    }
  }, [liveLocation, isFollowing, map]);

  // If the user drags the map manually, disable follow mode immediately
  useEffect(() => {
    const handleDrag = () => setIsFollowing(false);
    map.on("dragstart", handleDrag);
    return () => {
      map.off("dragstart", handleDrag);
    };
  }, [map]);

  if (!liveLocation || isNaN(liveLocation.lat) || isNaN(liveLocation.lon)) {
    return null;
  }

  return (
    <div className="leaflet-top leaflet-right !top-3 !right-3 z-[400] pointer-events-auto">
      <button
        type="button"
        onClick={() => {
          const nextState = !isFollowing;
          setIsFollowing(nextState);
          map.panTo([liveLocation.lat, liveLocation.lon], { animate: true, duration: 0.8 });
        }}
        title={isFollowing ? "Following driver (Click to unlock map)" : "Center on driver vehicle"}
        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold shadow-md flex items-center gap-1.5 border backdrop-blur-md transition-all cursor-pointer ${
          isFollowing
            ? "bg-emerald-600 text-white border-emerald-700 shadow-emerald-500/20"
            : "bg-background/95 text-foreground hover:bg-background border-border hover:border-foreground/30"
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${isFollowing ? "bg-white animate-pulse" : "bg-emerald-500"}`}></span>
        <span>{isFollowing ? "Following Driver" : "Center Driver"}</span>
      </button>
    </div>
  );
}

// Helper component to auto-fit map bounds initially
function FitBounds({ start, end, routePositions }: { start: Location; end: Location; routePositions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    map.invalidateSize();
    if (routePositions.length > 0) {
      map.fitBounds(routePositions, { padding: [50, 50] });
    } else {
      const bounds = L.latLngBounds([[start.lat, start.lon], [end.lat, end.lon]]);
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [map, start, end, routePositions]);
  return null;
}

// Polyline decoder for Valhalla (Precision 6)
function decodePolyline6(str: string): [number, number][] {
  let index = 0, lat = 0, lng = 0;
  const coordinates: [number, number][] = [];
  const factor = 1e6;
  while (index < str.length) {
    let byte, shift = 0, result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    const latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    shift = result = 0;
    do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    const longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += latitude_change; lng += longitude_change;
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

interface LeafletContainerElement extends HTMLDivElement {
  _leaflet_id?: number;
  _leaflet_map?: LeafletMap;
}

type LeafletContextType = ReturnType<typeof createLeafletContext>;

interface SafeMapContainerProps extends MapOptions {
  center: [number, number];
  zoom: number;
  scrollWheelZoom?: boolean;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
}

/**
 * SafeMapContainer provides strict single-ownership of the Leaflet Map instance.
 * Completely eliminates the React 18 / React-Leaflet "Map container is already initialized"
 * bug by tracking the map instance with a synchronous ref and ensuring proper DOM cleanup on unmount.
 */
function SafeMapContainer({
  center,
  zoom,
  style,
  className,
  children,
  ...options
}: SafeMapContainerProps) {
  const containerRef = useRef<LeafletContainerElement | null>(null);
  const mapInstanceRef = useRef<LeafletMap | null>(null);
  const [context, setContext] = useState<LeafletContextType | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // React 18 Strict Mode and remount safety:
    // If a Leaflet instance or ID is already present on this DOM element, clean it up first
    if (container._leaflet_id) {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch {
          // Ignore potential removal error
        }
        mapInstanceRef.current = null;
      }
      delete container._leaflet_id;
      container.innerHTML = "";
    }

    // Initialize the Leaflet map exactly once on the container
    const map = new LeafletMap(container, {
      ...options,
      center,
      zoom,
    });
    mapInstanceRef.current = map;
    container._leaflet_map = map;

    // Create Leaflet context for child layers (TileLayer, Marker, Polyline, useMap)
    const leafletContext = createLeafletContext(map);
    setContext(leafletContext);

    // Guaranteed unmount cleanup
    return () => {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch {
          // Ignore potential removal error
        }
        mapInstanceRef.current = null;
      }
      if (container) {
        delete container._leaflet_id;
        delete container._leaflet_map;
        container.innerHTML = "";
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} style={style} className={className}>
      {context ? (
        <LeafletProvider value={context}>{children}</LeafletProvider>
      ) : null}
    </div>
  );
}

export default function RouteMapClient({ 
  origin, 
  destination, 
  passengerOrigin,
  passengerDestination,
  liveLocation,
  routeGeometry,
  stops,
  onRouteCalculated 
}: RouteMapClientProps) {
  const [startLoc, setStartLoc] = useState<Location | null>(() => {
    if (origin && typeof origin === "object" && typeof origin.lat === "number" && typeof origin.lon === "number" && isValidCoord(origin.lat, origin.lon)) {
      return { name: origin.name || "Origin", lat: origin.lat, lon: origin.lon };
    }
    return null;
  });
  const [endLoc, setEndLoc] = useState<Location | null>(() => {
    if (destination && typeof destination === "object" && typeof destination.lat === "number" && typeof destination.lon === "number" && isValidCoord(destination.lat, destination.lon)) {
      return { name: destination.name || "Destination", lat: destination.lat, lon: destination.lon };
    }
    return null;
  });
  const [passStartLoc, setPassStartLoc] = useState<Location | null>(() => {
    if (passengerOrigin && typeof passengerOrigin === "object" && typeof passengerOrigin.lat === "number" && typeof passengerOrigin.lon === "number" && isValidCoord(passengerOrigin.lat, passengerOrigin.lon)) {
      return { name: passengerOrigin.name || "Pickup", lat: passengerOrigin.lat, lon: passengerOrigin.lon };
    }
    return null;
  });
  const [passEndLoc, setPassEndLoc] = useState<Location | null>(() => {
    if (passengerDestination && typeof passengerDestination === "object" && typeof passengerDestination.lat === "number" && typeof passengerDestination.lon === "number" && isValidCoord(passengerDestination.lat, passengerDestination.lon)) {
      return { name: passengerDestination.name || "Drop-off", lat: passengerDestination.lat, lon: passengerDestination.lon };
    }
    return null;
  });
  const [routePositions, setRoutePositions] = useState<[number, number][]>(routeGeometry || []);
  const [isLoading, setIsLoading] = useState(() => {
    const hasOrigin = origin && typeof origin === "object" && isValidCoord(origin.lat, origin.lon);
    const hasDest = destination && typeof destination === "object" && isValidCoord(destination.lat, destination.lon);
    return !(hasOrigin && hasDest);
  });
  const [error, setError] = useState(false);

  // Synchronize route positions immediately whenever routeGeometry changes
  useEffect(() => {
    if (routeGeometry && routeGeometry.length > 0) {
      setRoutePositions(routeGeometry);
    }
  }, [routeGeometry]);

  useEffect(() => {
    let isMounted = true;
    
    const resolveLocation = async (locInput: string | MapLocation | undefined | null): Promise<Location | null> => {
      if (!locInput) return null;

      if (typeof locInput === "object") {
        const lat = typeof locInput.lat === "number" ? locInput.lat : (locInput.lat != null ? parseFloat(String(locInput.lat)) : NaN);
        const lon = typeof locInput.lon === "number" ? locInput.lon : (locInput.lon != null ? parseFloat(String(locInput.lon)) : NaN);
        if (isValidCoord(lat, lon)) {
          return { name: locInput.name || "Location", lat, lon };
        }
      }
      
      const query = typeof locInput === "string" ? locInput : locInput?.name;
      if (!query || typeof query !== "string" || query.trim().length < 3) return null;

      try {
        const local = await resolveLocationText(query);
        if (local && isValidCoord(local.lat, local.lon)) {
          return { name: local.name, lat: local.lat, lon: local.lon };
        }
      } catch {}
      
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query.trim())}&limit=1&email=contact@tpool.com`);
        if (!res.ok) return null;
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const lat = parseFloat(data[0].lat);
          const lon = parseFloat(data[0].lon);
          if (isValidCoord(lat, lon)) {
            return { lat, lon, name: query };
          }
        }
        return null;
      } catch { return null; }
    };

    const fetchRoute = async (s: Location, e: Location) => {
      try {
        const routeLocations = shouldRouteViaTalegaonStation(s, e, s.name, e.name)
          ? [
              { lat: s.lat, lon: s.lon },
              { lat: TALEGAON_STATION_COORDS.lat, lon: TALEGAON_STATION_COORDS.lon },
              { lat: e.lat, lon: e.lon },
            ]
          : [{ lat: s.lat, lon: s.lon }, { lat: e.lat, lon: e.lon }];

        const payloadFastest = {
          locations: routeLocations,
          costing: "auto",
          costing_options: { auto: { shortest: false } }
        };
        const payloadShortest = {
          locations: routeLocations,
          costing: "auto",
          costing_options: { auto: { shortest: true } }
        };

        const [resFastest, resShortest] = await Promise.all([
          fetch("https://valhalla1.openstreetmap.de/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payloadFastest) }),
          fetch("https://valhalla1.openstreetmap.de/route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payloadShortest) })
        ]);

        const dataFastest = await resFastest.json();
        const dataShortest = await resShortest.json();

        // Helper to concatenate all leg shapes into a continuous polyline
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const decodeLegs = (trip: any): [number, number][] => {
          if (!trip || !trip.legs || trip.legs.length === 0) return [];
          const combined: [number, number][] = [];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          trip.legs.forEach((leg: any, idx: number) => {
            const pts = decodePolyline6(leg.shape);
            if (idx === 0) {
              combined.push(...pts);
            } else {
              combined.push(...pts.slice(1));
            }
          });
          return combined;
        };

        if (dataFastest.trip && dataShortest.trip) {
          const positionsFastest = decodeLegs(dataFastest.trip);
          const positionsShortest = decodeLegs(dataShortest.trip);

          const routeFastest = {
            name: "Route 0 (Fastest Profile)",
            distance: dataFastest.trip.summary.length * 1000, 
            duration: dataFastest.trip.summary.time,
            positions: positionsFastest
          };
          
          const routeShortest = {
            name: "Route 1 (Shortest Profile)",
            distance: dataShortest.trip.summary.length * 1000,
            duration: dataShortest.trip.summary.time,
            positions: positionsShortest
          };

          const validRoutes = [routeFastest, routeShortest];
          
          console.log("\n==================================================");
          console.log("ROUTING DEBUG\n");
          console.log("Start:");
          console.log(`${s.name} => ${s.lat}, ${s.lon}\n`);
          console.log("Destination:");
          console.log(`${e.name} => ${e.lat}, ${e.lon}\n`);
          console.log("Routing Provider: Valhalla (valhalla1.openstreetmap.de)\n");
          console.log("Routes returned:");
          validRoutes.forEach((r, idx) => {
            console.log(`Route ${idx}: ${(r.distance / 1000).toFixed(2)} km -> ${(r.duration / 60).toFixed(1)} min`);
          });

          const sortedRoutes = validRoutes.sort((a, b) => a.distance - b.distance);
          const selectedRoute = sortedRoutes[0];

          console.log("\nSelected route:");
          console.log(selectedRoute.name);
          console.log("Selected distance:");
          console.log(`${(selectedRoute.distance / 1000).toFixed(2)} km`);
          console.log("Selected duration:");
          console.log(`${(selectedRoute.duration / 60).toFixed(1)} min`);
          console.log("==================================================\n");

          if (isMounted) {
            setRoutePositions(selectedRoute.positions);
            if (onRouteCalculated) {
              onRouteCalculated({ 
                distance: selectedRoute.distance, 
                duration: selectedRoute.duration 
              });
            }
          }
        } else {
          if (isMounted && onRouteCalculated) onRouteCalculated(null);
        }
      } catch {
        if (isMounted && onRouteCalculated) onRouteCalculated(null);
      }
    };

    const fetchData = async () => {
      if (!origin || !destination) {
        setIsLoading(false);
        setError(true);
        if (onRouteCalculated) onRouteCalculated(null);
        return;
      }

      setIsLoading(true);
      setError(false);
      setRoutePositions([]);

      try {
        const [s, e, ps, pe] = await Promise.all([
          resolveLocation(origin), 
          resolveLocation(destination),
          passengerOrigin ? resolveLocation(passengerOrigin) : Promise.resolve(null),
          passengerDestination ? resolveLocation(passengerDestination) : Promise.resolve(null)
        ]);
        if (!isMounted) return;
        
          if (s && e) {
          setStartLoc(s);
          setEndLoc(e);
          if (ps) setPassStartLoc(ps);
          if (pe) setPassEndLoc(pe);
          if (routeGeometry && routeGeometry.length > 0) {
            setRoutePositions(routeGeometry);
          } else {
            await fetchRoute(s, e);
          }
        } else {
          setError(true);
          if (onRouteCalculated) onRouteCalculated(null);
        }
      } catch {
        if (isMounted) {
          setError(true);
          if (onRouteCalculated) onRouteCalculated(null);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    const timeoutId = setTimeout(fetchData, 800);

    return () => { 
      isMounted = false; 
      clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination, passengerOrigin, passengerDestination, routeGeometry]);

  if (isLoading) {
    return <div className="h-full min-h-[256px] w-full bg-muted flex items-center justify-center text-sm text-muted-foreground rounded-lg border">Loading map & route data...</div>;
  }

  const originName = typeof origin === "string" ? origin : origin?.name;
  const destName = typeof destination === "string" ? destination : destination?.name;

  if (
    error || 
    !startLoc || 
    !endLoc || 
    !isValidCoord(startLoc.lat, startLoc.lon) || 
    !isValidCoord(endLoc.lat, endLoc.lon)
  ) {
    return <div className="h-full min-h-[256px] w-full bg-muted flex flex-col items-center justify-center text-sm text-muted-foreground rounded-lg border">
      <p>Map view unavailable for this route.</p>
      {originName && destName && (
        <p className="text-xs opacity-70">Could not find exact coordinates for &quot;{originName}&quot; or &quot;{destName}&quot;.</p>
      )}
    </div>;
  }

  return (
    <div className="h-full w-full rounded-lg overflow-hidden border relative z-0 isolate">
      <SafeMapContainer 
        center={[(startLoc.lat + endLoc.lat) / 2, (startLoc.lon + endLoc.lon) / 2]} 
        zoom={13} 
        scrollWheelZoom={false} 
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {routePositions.length > 0 && (
          <Polyline positions={routePositions} pathOptions={{ color: '#3b82f6', weight: 4, opacity: 0.8 }} />
        )}

        {isValidCoord(startLoc.lat, startLoc.lon) && (
          <Marker position={[startLoc.lat, startLoc.lon]}>
            <Popup>Driver Start: {startLoc.name}</Popup>
          </Marker>
        )}
        
        {isValidCoord(endLoc.lat, endLoc.lon) && (
          <Marker position={[endLoc.lat, endLoc.lon]}>
            <Popup>Driver End: {endLoc.name}</Popup>
          </Marker>
        )}
        
        {stops && stops.length > 0 ? (
          stops
            .filter((stop) => isValidCoord(stop.lat, stop.lon))
            .map((stop) => (
              <Marker
                key={stop.id}
                position={[stop.lat, stop.lon]}
                icon={stop.type === "PICKUP" ? greenIcon : redIcon}
              >
                <Popup>
                  <div className="text-xs space-y-0.5">
                    <p className="font-semibold text-foreground">
                      {stop.type === "PICKUP" ? "🟢 Passenger Pickup" : "🔴 Passenger Drop-off"}
                      {stop.passengerName ? `: ${stop.passengerName}` : ""}
                    </p>
                    <p className="text-muted-foreground">{stop.locationName}</p>
                  </div>
                </Popup>
              </Marker>
            ))
        ) : (
          <>
            {passStartLoc && isValidCoord(passStartLoc.lat, passStartLoc.lon) && (
              <Marker position={[passStartLoc.lat, passStartLoc.lon]} icon={greenIcon}>
                <Popup>Your Pickup: {passStartLoc.name}</Popup>
              </Marker>
            )}
            
            {passEndLoc && isValidCoord(passEndLoc.lat, passEndLoc.lon) && (
              <Marker position={[passEndLoc.lat, passEndLoc.lon]} icon={redIcon}>
                <Popup>Your Destination: {passEndLoc.name}</Popup>
              </Marker>
            )}
          </>
        )}

        {liveLocation && isValidCoord(liveLocation.lat, liveLocation.lon) && (
          <MovingVehicleMarker liveLocation={liveLocation} />
        )}

        <DriverFollower liveLocation={liveLocation} />

        <FitBounds start={startLoc} end={endLoc} routePositions={routePositions} />
      </SafeMapContainer>
    </div>
  );
}

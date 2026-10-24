"use client";

import { useState, useEffect, useMemo, useCallback, use } from "react";
import RouteMap, { MapLocation, LiveLocationData } from "@/components/RouteMap";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface TrackingData {
  token: string;
  senderName: string;
  driverName: string;
  vehicleName: string;
  rideType: string;
  rideStatus: string;
  origin: string;
  originLat: number | null;
  originLon: number | null;
  destination: string;
  destLat: number | null;
  destLon: number | null;
  routeGeometry: string | null;
  departure: string;
  currentLat: number | null;
  currentLon: number | null;
  locationUpdatedAt: string | null;
  isLiveSharing: boolean;
  isStale: boolean;
  driverOffline: boolean;
  isFinished?: boolean;
  passengerPickup?: { location: string; lat: number | null; lon: number | null } | null;
  passengerDrop?: { location: string; lat: number | null; lon: number | null } | null;
}

export default function PublicTrackPage({
  params,
}: {
  params: Promise<{ token: string }> | { token: string };
}) {
  const unwrappedParams = use(Promise.resolve(params));
  const token = unwrappedParams.token;

  const [data, setData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRevoked, setIsRevoked] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<Date>(new Date());

  const fetchTracking = useCallback(async () => {
    try {
      const res = await fetch(`/api/track/${token}`);
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 410) {
          if (json.isRevoked) {
            setIsRevoked(true);
          } else if (json.isExpired) {
            setIsExpired(true);
          } else if (json.isFinished) {
            setIsFinished(true);
            setData(json);
          }
        }
        setError(json.message || "Failed to load tracking data");
        return;
      }

      setError(null);
      setData(json);
      setLastCheckTime(new Date());
    } catch {
      setError("Network connection error. Reconnecting...");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchTracking();

    // Poll every 5 seconds while tracking is active and not revoked/expired/finished
    const interval = setInterval(() => {
      if (!isRevoked && !isExpired && !isFinished) {
        fetchTracking();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchTracking, isRevoked, isExpired, isFinished]);

  // Parse route geometry if present (memoized to keep stable reference across polling)
  const parsedRouteGeometry = useMemo(() => {
    if (!data?.routeGeometry) return undefined;
    try {
      return JSON.parse(data.routeGeometry) as [number, number][];
    } catch {
      return undefined;
    }
  }, [data?.routeGeometry]);

  // Live location object (memoized to avoid re-renders unless coordinates or timestamp change)
  const liveLocation: LiveLocationData | null = useMemo(() => {
    if (data?.currentLat && data?.currentLon) {
      return {
        lat: data.currentLat,
        lon: data.currentLon,
        updatedAt: data.locationUpdatedAt,
      };
    }
    return null;
  }, [data?.currentLat, data?.currentLon, data?.locationUpdatedAt]);

  const originName = data?.origin;
  const originLat = data?.originLat;
  const originLon = data?.originLon;
  const originLocation: string | MapLocation = useMemo(() => {
    if (typeof originLat === "number" && typeof originLon === "number" && originName) {
      return { name: originName, lat: originLat, lon: originLon };
    }
    return originName || "Origin";
  }, [originName, originLat, originLon]);

  const destName = data?.destination;
  const destLat = data?.destLat;
  const destLon = data?.destLon;
  const destinationLocation: string | MapLocation = useMemo(() => {
    if (typeof destLat === "number" && typeof destLon === "number" && destName) {
      return { name: destName, lat: destLat, lon: destLon };
    }
    return destName || "Destination";
  }, [destName, destLat, destLon]);

  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-xl shadow-xs">
              🛡️
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">TPool SafeTrack</h1>
              <p className="text-xs text-muted-foreground">
                Live Trusted Trip Sharing &amp; Safety Tracker
              </p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[11px] text-muted-foreground" suppressHydrationWarning>
              Last checked: {lastCheckTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="p-12 text-center border rounded-2xl bg-card space-y-3">
            <div className="text-3xl animate-pulse">🚗</div>
            <p className="text-sm font-medium">Connecting to secure trip stream...</p>
          </div>
        )}

        {/* Revoked State */}
        {isRevoked && (
          <div className="p-6 border-2 border-amber-500/30 rounded-2xl bg-amber-500/10 space-y-2 text-center">
            <div className="text-3xl">🚫</div>
            <h2 className="text-lg font-bold text-amber-700 dark:text-amber-300">Sharing Revoked</h2>
            <p className="text-sm text-muted-foreground">
              This trip tracking link has been revoked by the sender. Access to live location data is no longer permitted.
            </p>
          </div>
        )}

        {/* Expired State */}
        {isExpired && (
          <div className="p-6 border-2 border-red-500/30 rounded-2xl bg-red-500/10 space-y-2 text-center">
            <div className="text-3xl">⌛</div>
            <h2 className="text-lg font-bold text-red-700 dark:text-red-300">Tracking Link Expired</h2>
            <p className="text-sm text-muted-foreground">
              This trip sharing link has reached its expiration time.
            </p>
          </div>
        )}

        {/* Error / Invalid Token State (not revoked/expired) */}
        {!loading && error && !isRevoked && !isExpired && !isFinished && (
          <div className="p-6 border rounded-2xl bg-card text-center space-y-2">
            <div className="text-3xl">⚠️</div>
            <h2 className="text-base font-bold">Unable to Load Trip</h2>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        )}

        {/* Finished / Completed Trip Banner */}
        {isFinished && (
          <div className="p-4 border-2 border-emerald-500/30 rounded-xl bg-emerald-500/10 space-y-1">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold text-sm">
              <span>✓</span> Trip Completed or Ended
            </div>
            <p className="text-xs text-muted-foreground">
              The ride has concluded. Live GPS location is automatically discontinued for safety and privacy.
            </p>
          </div>
        )}

        {/* Main Tracking Content */}
        {data && (
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <CardTitle className="text-lg sm:text-xl font-bold">
                        {data.origin} → {data.destination}
                      </CardTitle>
                      <Badge
                        variant={data.rideStatus === "ACTIVE" ? "default" : "outline"}
                        className={
                          data.rideStatus === "ACTIVE"
                            ? "bg-emerald-600 text-white animate-pulse"
                            : ""
                        }
                      >
                        {data.rideStatus}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs mt-1">
                      Shared by <strong className="text-foreground">{data.senderName}</strong> for your safety
                    </CardDescription>
                  </div>

                  {/* GPS Telemetry Pill */}
                  <div className="self-start sm:self-auto">
                    {data.isLiveSharing && !data.isStale ? (
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                        <span>Live GPS Active</span>
                      </div>
                    ) : data.isStale ? (
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-semibold">
                        <span>⚠️ Signal Stale</span>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted border text-muted-foreground text-xs font-medium">
                        <span>⚪ Driver GPS Offline</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-6">
                {/* Trip Info Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-muted/30 border text-xs">
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Driver</span>
                    <span className="font-semibold text-foreground text-sm">{data.driverName}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Vehicle</span>
                    <span className="font-semibold text-foreground text-sm">{data.vehicleName}</span>
                    <span className="text-[10px] text-muted-foreground block">{data.rideType}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Departure Time</span>
                    <span className="font-semibold text-foreground">
                      {new Date(data.departure).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block text-[11px]">Last GPS Fix</span>
                    <span className="font-semibold text-foreground" suppressHydrationWarning>
                      {data.locationUpdatedAt
                        ? new Date(data.locationUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        : "No fix yet"}
                    </span>
                  </div>
                </div>

                {/* Live Leaflet Route Map */}
                <div key={token} className="h-[400px] w-full rounded-xl overflow-hidden border shadow-xs">
                  <RouteMap
                    origin={originLocation}
                    destination={destinationLocation}
                    passengerOrigin={data.passengerPickup?.location}
                    passengerDestination={data.passengerDrop?.location}
                    liveLocation={liveLocation}
                    routeGeometry={parsedRouteGeometry}
                  />
                </div>

                {/* Privacy Safeguard Notice */}
                <div className="p-3 rounded-lg border bg-muted/10 text-[11px] text-muted-foreground flex items-center gap-2">
                  <span>🔒</span>
                  <span>
                    <strong>TPool Privacy Guard:</strong> This tracking page only displays essential trip safety and route telemetry. Other passengers&apos; identities, contact numbers, and payment details are strictly withheld.
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

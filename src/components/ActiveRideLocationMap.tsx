"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import RouteMap, { MapLocation, LiveLocationData, RouteStopPoint } from "@/components/RouteMap";
import LiveLocationControl from "@/components/LiveLocationControl";
import LiveLocationSubscriber from "@/components/LiveLocationSubscriber";

interface ActiveRideLocationMapProps {
  rideId: string;
  origin: string | MapLocation;
  destination: string | MapLocation;
  passengerOrigin?: string | MapLocation;
  passengerDestination?: string | MapLocation;
  isActive: boolean;
  canShareLiveLocation: boolean;
  routeGeometry?: [number, number][];
  stops?: RouteStopPoint[];
}

export default function ActiveRideLocationMap({
  rideId,
  origin,
  destination,
  passengerOrigin,
  passengerDestination,
  isActive,
  canShareLiveLocation,
  routeGeometry,
  stops,
}: ActiveRideLocationMapProps) {
  const [liveLocation, setLiveLocation] = useState<LiveLocationData | null>(null);
  const [isDriverBroadcasting, setIsDriverBroadcasting] = useState(false);
  const [currentRouteGeometry, setCurrentRouteGeometry] = useState<[number, number][] | undefined>(routeGeometry);
  const [currentStops, setCurrentStops] = useState<RouteStopPoint[] | undefined>(stops);
  const lastRouteVersionRef = useRef<number | null>(null);

  // Sync route props when parent updates
  useEffect(() => {
    if (routeGeometry) setCurrentRouteGeometry(routeGeometry);
  }, [routeGeometry]);

  useEffect(() => {
    if (stops) setCurrentStops(stops);
  }, [stops]);

  // Background poller ensures route changes and new stops update live without page reload
  useEffect(() => {
    let isMounted = true;

    const syncRouteData = async () => {
      try {
        const res = await fetch(`/api/rides/${rideId}/status`);
        if (res.ok && isMounted) {
          const data = await res.json();
          if (data.routeVersion !== undefined && data.routeVersion !== lastRouteVersionRef.current) {
            lastRouteVersionRef.current = data.routeVersion;
            if (data.routeGeometry) {
              try {
                const parsed = JSON.parse(data.routeGeometry);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  setCurrentRouteGeometry(parsed);
                }
              } catch {}
            }
            if (Array.isArray(data.stops)) {
              setCurrentStops(data.stops);
            }
          }
        }
      } catch {
        // Silently ignore background polling errors
      }
    };

    const intervalId = setInterval(syncRouteData, 3500);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [rideId]);

  const handleDriverLocationUpdate = useCallback((loc: LiveLocationData | null) => {
    setIsDriverBroadcasting(loc !== null);
    setLiveLocation(loc);
  }, []);

  const handleSubscriberLocationUpdate = useCallback((loc: LiveLocationData | null) => {
    // If user is driver and actively broadcasting from device GPS, do not overwrite with polled data
    if (!isDriverBroadcasting) {
      setLiveLocation(loc);
    }
  }, [isDriverBroadcasting]);

  return (
    <div className="space-y-4">
      {isActive && (!canShareLiveLocation || !isDriverBroadcasting) && (
        <LiveLocationSubscriber
          rideId={rideId}
          isActive={isActive}
          onLocationReceived={handleSubscriberLocationUpdate}
        />
      )}

      {isActive && canShareLiveLocation && (
        <div className="bg-card border rounded-xl p-4 shadow-xs">
          <LiveLocationControl
            rideId={rideId}
            onLocationUpdate={handleDriverLocationUpdate}
          />
        </div>
      )}

      <div className="rounded-lg overflow-hidden border">
        <div className="p-3 border-b bg-card flex justify-between items-center">
          <h3 className="font-semibold text-sm">Route &amp; Live Location Map</h3>
          {isActive && (
            liveLocation ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                🚗 Vehicle Moving (Live)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                Waiting for Driver GPS...
              </span>
            )
          )}
        </div>
        <div className="p-3 bg-muted/30 h-64 sm:h-72">
          <RouteMap
            origin={origin}
            destination={destination}
            passengerOrigin={passengerOrigin}
            passengerDestination={passengerDestination}
            liveLocation={liveLocation}
            routeGeometry={currentRouteGeometry}
            stops={currentStops}
          />
        </div>
      </div>
    </div>
  );
}

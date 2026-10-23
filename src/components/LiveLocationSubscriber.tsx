"use client";

import { useEffect, useRef } from "react";
import type { LiveLocationData } from "./RouteMap";

interface LiveLocationSubscriberProps {
  rideId: string;
  isActive: boolean;
  onLocationReceived: (location: LiveLocationData | null) => void;
}

// Calculate compass bearing between two coordinates
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const phi1 = lat1 * (Math.PI / 180);
  const phi2 = lat2 * (Math.PI / 180);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

export default function LiveLocationSubscriber({
  rideId,
  isActive,
  onLocationReceived,
}: LiveLocationSubscriberProps) {
  const onLocationReceivedRef = useRef(onLocationReceived);
  onLocationReceivedRef.current = onLocationReceived;

  const prevLocationRef = useRef<{ lat: number; lon: number; heading: number | null } | null>(null);

  useEffect(() => {
    if (!isActive) {
      prevLocationRef.current = null;
      onLocationReceivedRef.current(null);
      return;
    }

    let isMounted = true;

    const fetchLiveLocation = async () => {
      try {
        const res = await fetch(`/api/rides/${rideId}/location`);
        if (res.ok && isMounted) {
          const data = await res.json();
          if (
            data.isLiveSharing &&
            data.currentLat !== null &&
            data.currentLon !== null &&
            !isNaN(data.currentLat) &&
            !isNaN(data.currentLon)
          ) {
            const currentLat = Number(data.currentLat);
            const currentLon = Number(data.currentLon);

            // Authoritative heading selection:
            // 1. Server-provided heading (from driver GPS device compass or server calculation)
            // 2. Local bearing calculation between consecutive coordinates if moved >= 3m
            // 3. Retain last known heading when stationary to prevent orientation jumping
            let heading: number | null = null;
            if (typeof data.heading === "number" && !isNaN(data.heading)) {
              heading = data.heading;
              prevLocationRef.current = { lat: currentLat, lon: currentLon, heading };
            } else if (prevLocationRef.current) {
              const prev = prevLocationRef.current;
              const dLat = Math.abs(currentLat - prev.lat);
              const dLon = Math.abs(currentLon - prev.lon);
              // Movement threshold ~3 meters (approx 0.00003 deg)
              if (dLat > 0.00003 || dLon > 0.00003) {
                heading = calculateBearing(prev.lat, prev.lon, currentLat, currentLon);
                prevLocationRef.current = { lat: currentLat, lon: currentLon, heading };
              } else {
                heading = prev.heading;
              }
            } else {
              prevLocationRef.current = { lat: currentLat, lon: currentLon, heading: null };
            }

            const formattedTime = data.locationUpdatedAt
              ? new Date(data.locationUpdatedAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : null;

            onLocationReceivedRef.current({
              lat: currentLat,
              lon: currentLon,
              heading,
              updatedAt: formattedTime,
            });
          } else {
            prevLocationRef.current = null;
            onLocationReceivedRef.current(null);
          }
        }
      } catch {
        // Silently ignore background polling errors
      }
    };

    // Immediate initial fetch
    fetchLiveLocation();

    // Poll every 2.5 seconds for responsive recipient map updates
    const intervalId = setInterval(fetchLiveLocation, 2500);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [rideId, isActive]);

  return null;
}


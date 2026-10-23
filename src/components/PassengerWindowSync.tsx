"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface PassengerWindowSyncProps {
  rideId: string;
  currentStatus: string;
}

export default function PassengerWindowSync({ rideId, currentStatus }: PassengerWindowSyncProps) {
  const router = useRouter();
  const lastStatusRef = useRef(currentStatus);
  const lastRouteVersionRef = useRef<number | null>(null);
  const lastUserFareRef = useRef<number | null>(null);
  const lastConfirmedCountRef = useRef<number | null>(null);

  useEffect(() => {
    // Only poll while ride status is SCHEDULED or ACTIVE
    if (currentStatus === "COMPLETED" || currentStatus === "CANCELLED") {
      return;
    }

    const checkUpdates = async () => {
      try {
        const res = await fetch(`/api/rides/${rideId}/status`);
        if (res.ok) {
          const data = await res.json();
          let shouldRefresh = false;

          if (data.status && data.status !== lastStatusRef.current) {
            lastStatusRef.current = data.status;
            shouldRefresh = true;
          }

          if (data.routeVersion !== undefined && lastRouteVersionRef.current !== null && data.routeVersion !== lastRouteVersionRef.current) {
            shouldRefresh = true;
          }
          lastRouteVersionRef.current = data.routeVersion ?? 0;

          if (data.userFare !== undefined && lastUserFareRef.current !== null && data.userFare !== lastUserFareRef.current) {
            shouldRefresh = true;
          }
          lastUserFareRef.current = data.userFare ?? null;

          if (data.confirmedCount !== undefined && lastConfirmedCountRef.current !== null && data.confirmedCount !== lastConfirmedCountRef.current) {
            shouldRefresh = true;
          }
          lastConfirmedCountRef.current = data.confirmedCount ?? 0;

          if (shouldRefresh) {
            router.refresh();
          }
        }
      } catch {
        // Silently ignore background network errors during polling
      }
    };

    const intervalId = setInterval(checkUpdates, 3500);

    return () => clearInterval(intervalId);
  }, [rideId, currentStatus, router]);

  return null;
}

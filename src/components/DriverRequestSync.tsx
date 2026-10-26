"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface DashboardSyncState {
  count: number;
  latestBookingTime: number;
  totalConfirmedFares: number;
  latestRouteTime: number;
  passengerHash: string;
}

export default function DriverRequestSync() {
  const router = useRouter();
  const lastStateRef = useRef<DashboardSyncState | null>(null);
  const isFetchingRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    const checkNewRequests = async () => {
      if (isFetchingRef.current || !isMounted) return;
      isFetchingRef.current = true;

      try {
        const res = await fetch("/api/bookings", { cache: "no-store" });
        if (res.ok && isMounted) {
          const data = await res.json();
          if (lastStateRef.current !== null) {
            const hasDriverChanges =
              data.count !== lastStateRef.current.count ||
              data.latestBookingTime !== lastStateRef.current.latestBookingTime ||
              data.totalConfirmedFares !== lastStateRef.current.totalConfirmedFares ||
              data.latestRouteTime !== lastStateRef.current.latestRouteTime;

            const hasPassengerChanges =
              data.passengerHash !== undefined &&
              data.passengerHash !== lastStateRef.current.passengerHash;

            if (hasDriverChanges || hasPassengerChanges) {
              router.refresh();
            }
          }
          lastStateRef.current = {
            count: data.count ?? 0,
            latestBookingTime: data.latestBookingTime ?? 0,
            totalConfirmedFares: data.totalConfirmedFares ?? 0,
            latestRouteTime: data.latestRouteTime ?? 0,
            passengerHash: data.passengerHash ?? "",
          };
        }
      } catch {
        // Silently catch network errors during polling
      } finally {
        isFetchingRef.current = false;
      }
    };

    // Initial check
    checkNewRequests();

    // Poll every 3.5 seconds for live ride and fare updates
    const intervalId = setInterval(checkNewRequests, 3500);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [router]);

  return null;
}

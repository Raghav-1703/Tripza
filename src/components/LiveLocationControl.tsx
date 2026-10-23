"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { MapPin, Square, RefreshCw } from "lucide-react";
import type { LiveLocationData } from "./RouteMap";

interface LiveLocationControlProps {
  rideId: string;
  onLocationUpdate?: (location: LiveLocationData | null) => void;
}

export default function LiveLocationControl({ rideId, onLocationUpdate }: LiveLocationControlProps) {
  const [isSharing, setIsSharing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{
    type: "info" | "success" | "warning" | "error";
    text: string;
  } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const throttleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingUpdateRef = useRef<{ lat: number; lon: number; heading?: number | null; speed?: number | null } | null>(null);
  const lastSentTimeRef = useRef<number>(0);
  const isTransmittingRef = useRef<boolean>(false);

  const stopSharing = useCallback(async () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (throttleTimerRef.current !== null) {
      clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = null;
    }
    pendingUpdateRef.current = null;
    isTransmittingRef.current = false;

    setIsSharing(false);
    setStatusMessage({ type: "info", text: "Live driver location broadcasting paused." });

    try {
      await fetch(`/api/rides/${rideId}/location`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isSharing: false }),
      });
    } catch {
      // Ignore background network errors on stop
    }

    if (onLocationUpdate) {
      onLocationUpdate(null);
    }
  }, [rideId, onLocationUpdate]);

  const performTransmit = useCallback(
    async (lat: number, lon: number, heading?: number | null, speed?: number | null) => {
      if (isTransmittingRef.current) {
        pendingUpdateRef.current = { lat, lon, heading, speed };
        return;
      }

      isTransmittingRef.current = true;
      lastSentTimeRef.current = Date.now();

      try {
        const res = await fetch(`/api/rides/${rideId}/location`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latitude: lat,
            longitude: lon,
            isSharing: true,
            heading: typeof heading === "number" && !isNaN(heading) ? heading : null,
            speed: typeof speed === "number" && !isNaN(speed) ? speed : null,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const formattedTime = new Date().toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
          setLastUpdated(formattedTime);
          setStatusMessage({
            type: "success",
            text: `📍 Broadcasting driver GPS live (Updated ${formattedTime})`,
          });
          if (onLocationUpdate) {
            onLocationUpdate({
              lat,
              lon,
              heading: typeof data.heading === "number" && !isNaN(data.heading) 
                ? data.heading 
                : (typeof heading === "number" && !isNaN(heading) ? heading : null),
              updatedAt: formattedTime,
            });
          }
        } else {
          const data = await res.json().catch(() => ({}));
          setStatusMessage({ type: "warning", text: data.message || "Failed to transmit live location." });
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setStatusMessage({ type: "error", text: `Network error: ${err.message}` });
        }
      } finally {
        isTransmittingRef.current = false;
        // If a new update arrived during transit, trigger trailing dispatch
        if (pendingUpdateRef.current) {
          const next = pendingUpdateRef.current;
          pendingUpdateRef.current = null;
          const now = Date.now();
          const elapsed = now - lastSentTimeRef.current;
          if (elapsed >= 2500) {
            performTransmit(next.lat, next.lon, next.heading, next.speed);
          } else {
            throttleTimerRef.current = setTimeout(() => {
              throttleTimerRef.current = null;
              performTransmit(next.lat, next.lon, next.heading, next.speed);
            }, 2500 - elapsed);
          }
        }
      }
    },
    [rideId, onLocationUpdate]
  );

  const queueLocationUpdate = useCallback(
    (lat: number, lon: number, heading?: number | null, speed?: number | null) => {
      // Validate coordinates strictly
      if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        setStatusMessage({ type: "error", text: "Received invalid GPS coordinates." });
        return;
      }

      pendingUpdateRef.current = { lat, lon, heading, speed };
      const now = Date.now();
      const timeSinceLast = now - lastSentTimeRef.current;
      const MIN_INTERVAL = 2500; // 2.5s cadence ensures continuous live updates

      if (timeSinceLast >= MIN_INTERVAL && !isTransmittingRef.current) {
        if (throttleTimerRef.current) {
          clearTimeout(throttleTimerRef.current);
          throttleTimerRef.current = null;
        }
        const update = pendingUpdateRef.current;
        pendingUpdateRef.current = null;
        if (update) {
          performTransmit(update.lat, update.lon, update.heading, update.speed);
        }
      } else if (!throttleTimerRef.current) {
        // Trailing-edge timer guarantees the latest position is never dropped
        const delay = Math.max(100, MIN_INTERVAL - timeSinceLast);
        throttleTimerRef.current = setTimeout(() => {
          throttleTimerRef.current = null;
          if (pendingUpdateRef.current && !isTransmittingRef.current) {
            const update = pendingUpdateRef.current;
            pendingUpdateRef.current = null;
            performTransmit(update.lat, update.lon, update.heading, update.speed);
          }
        }, delay);
      }
    },
    [performTransmit]
  );

  const startSharing = useCallback(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setStatusMessage({ type: "error", text: "Geolocation is not supported by your browser." });
      return;
    }

    // Clean up any existing watchers/intervals
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    setStatusMessage({ type: "info", text: "Acquiring GPS satellite signal..." });

    const handlePosition = (position: GeolocationPosition) => {
      setIsSharing(true);
      const { latitude, longitude, heading, speed } = position.coords;
      queueLocationUpdate(latitude, longitude, heading, speed);
    };

    const handleError = async (error: GeolocationPositionError) => {
      if (error.code === error.PERMISSION_DENIED) {
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
        if (pollIntervalRef.current !== null) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        setIsSharing(false);
        setStatusMessage({
          type: "error",
          text: "⚠️ Location permission denied. Please allow location access in your browser settings to share your live vehicle pointer.",
        });
        return;
      }

      if (error.code === error.POSITION_UNAVAILABLE) {
        setStatusMessage({
          type: "warning",
          text: "⚠️ Location unavailable from device GPS. Retrying in background...",
        });
        // IP location fallback if physical GPS hardware is unavailable in local environment
        try {
          const res = await fetch("https://ipapi.co/json/");
          if (res.ok) {
            const data = await res.json();
            if (typeof data.latitude === "number" && typeof data.longitude === "number") {
              setIsSharing(true);
              queueLocationUpdate(data.latitude, data.longitude, null, null);
            }
          }
        } catch {
          // Ignore IP fallback errors
        }
        return;
      }

      if (error.code === error.TIMEOUT) {
        setStatusMessage({
          type: "warning",
          text: "⚠️ GPS request timed out. Waiting for signal recovery...",
        });
        return;
      }

      setStatusMessage({
        type: "error",
        text: "⚠️ Unable to acquire current GPS fix.",
      });
    };

    try {
      // Primary continuous GPS watcher
      const watchId = navigator.geolocation.watchPosition(
        handlePosition,
        handleError,
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 2000,
        }
      );
      watchIdRef.current = watchId;

      // Periodic backup polling ensures updates continue even if watchPosition stalls
      pollIntervalRef.current = setInterval(() => {
        navigator.geolocation.getCurrentPosition(handlePosition, () => {}, {
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 2000,
        });
      }, 4000);
    } catch {
      setStatusMessage({ type: "error", text: "Failed to initialize live GPS tracking." });
    }
  }, [queueLocationUpdate]);

  // Clean up watcher, intervals, and reset server state when component unmounts
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (throttleTimerRef.current !== null) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      fetch(`/api/rides/${rideId}/location`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isSharing: false }),
      }).catch(() => {});
    };
  }, [rideId]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Driver Live Location Broadcast
          </h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Broadcast your vehicle&apos;s real-time position to confirmed passengers along the route.
          </p>
        </div>
      </div>

      {statusMessage && (
        <div
          className={`p-2.5 rounded-lg text-xs font-medium border flex items-center justify-between gap-2 ${
            statusMessage.type === "success"
              ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200"
              : statusMessage.type === "warning"
              ? "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200"
              : statusMessage.type === "info"
              ? "bg-blue-50 dark:bg-blue-950/40 border-blue-300 dark:border-blue-800 text-blue-800 dark:text-blue-200"
              : "bg-destructive/10 border-destructive/20 text-destructive"
          }`}
        >
          <span>{statusMessage.text}</span>
          {statusMessage.type === "error" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={startSharing}
              className="h-6 px-2 text-[11px] gap-1 shrink-0"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </Button>
          )}
        </div>
      )}

      {isSharing ? (
        <Button
          type="button"
          variant="outline"
          size="default"
          className="w-full border-rose-500 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950 font-semibold gap-2 transition-colors cursor-pointer"
          onClick={stopSharing}
        >
          <Square className="h-4 w-4 fill-rose-600" />
          <span>Stop Live GPS Sharing</span>
        </Button>
      ) : (
        <Button
          type="button"
          variant="default"
          size="default"
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-2 shadow-xs transition-colors cursor-pointer"
          onClick={startSharing}
        >
          <MapPin className="h-4 w-4 animate-bounce" />
          <span>📍 Start Live GPS Sharing</span>
        </Button>
      )}

      {isSharing && lastUpdated && (
        <p className="text-[11px] text-muted-foreground text-center">
          Real-time GPS updates active • Last transmitted at {lastUpdated}
        </p>
      )}
    </div>
  );
}


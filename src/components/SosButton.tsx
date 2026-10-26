"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, MapPin, RefreshCw, XCircle } from "lucide-react";

interface SosButtonProps {
  rideId: string;
}

interface GpsFix {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

export default function SosButton({ rideId }: SosButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "warning" | "error"; text: string } | null>(null);

  // GPS Acquisition State
  const [gpsStatus, setGpsStatus] = useState<"IDLE" | "ACQUIRING" | "ACQUIRED" | "ERROR">("IDLE");
  const [gpsFix, setGpsFix] = useState<GpsFix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Acquire fresh, real-time GPS coordinates using HTML5 Geolocation API with high accuracy
  const acquireGps = useCallback(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setGpsStatus("ERROR");
      setGpsError("Geolocation is not supported by your browser.");
      return;
    }

    setGpsStatus("ACQUIRING");
    setGpsError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lon = position.coords.longitude;
        const accuracy = position.coords.accuracy;
        const timestamp = position.timestamp || Date.now();

        // Validate coordinate bounds
        if (typeof lat === "number" && !isNaN(lat) && lat >= -90 && lat <= 90 &&
            typeof lon === "number" && !isNaN(lon) && lon >= -180 && lon <= 180) {
          setGpsFix({
            latitude: lat,
            longitude: lon,
            accuracy,
            timestamp,
          });
          setGpsStatus("ACQUIRED");
          setGpsError(null);
        } else {
          setGpsStatus("ERROR");
          setGpsError("Received invalid GPS coordinate values from device.");
        }
      },
      (err) => {
        let msg = "Failed to acquire GPS location.";
        if (err.code === 1) {
          msg = "Location permission denied. Please allow location access in your browser settings to share your live emergency position.";
        } else if (err.code === 2) {
          msg = "GPS position unavailable. Please check that device location services are enabled.";
        } else if (err.code === 3) {
          msg = "GPS location request timed out. Please try again.";
        }
        setGpsStatus("ERROR");
        setGpsError(msg);
        setGpsFix(null);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0, // Zero tolerance for stale cached locations; must be live
      }
    );
  }, []);

  // When SOS modal opens, immediately begin acquiring fresh live GPS
  useEffect(() => {
    if (isOpen) {
      acquireGps();
    } else {
      setGpsStatus("IDLE");
      setGpsFix(null);
      setGpsError(null);
    }
  }, [isOpen, acquireGps]);

  const handleSendSos = async (skipLocation = false) => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setStatusMessage(null);

    const lat = (!skipLocation && gpsFix) ? gpsFix.latitude : null;
    const lon = (!skipLocation && gpsFix) ? gpsFix.longitude : null;
    const accuracy = (!skipLocation && gpsFix) ? gpsFix.accuracy : null;

    try {
      const res = await fetch("/api/emergency/sos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rideId,
          latitude: lat,
          longitude: lon,
          accuracy,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to activate emergency SOS");
      }

      if (data.alertCreated && data.contactNotified) {
        let text = "🚨 Emergency SOS Activated! Your emergency contact has been notified.";
        if (lat !== null && lon !== null) {
          text += ` (Live GPS attached: ${lat.toFixed(4)}, ${lon.toFixed(4)})`;
        } else {
          text += " (Sent without GPS location)";
        }
        setStatusMessage({
          type: "success",
          text,
        });
      } else if (data.alertCreated && !data.contactNotified) {
        const errorDetail = data.notificationError ? `: ${data.notificationError}` : "";
        setStatusMessage({
          type: "warning",
          text: `🚨 SOS alert logged, but could not deliver notification to emergency contact${errorDetail}. Please contact emergency services or your contact directly.`,
        });
      } else {
        setStatusMessage({
          type: "success",
          text: "🚨 Emergency SOS Alert Created.",
        });
      }
      setIsOpen(false);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setStatusMessage({ type: "error", text: err.message });
      } else {
        setStatusMessage({ type: "error", text: "Failed to trigger SOS" });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      {statusMessage && (
        <div
          className={`p-4 rounded-lg font-medium text-sm border flex items-start gap-2 ${
            statusMessage.type === "success"
              ? "bg-red-50 dark:bg-red-950/60 border-red-300 dark:border-red-800 text-red-800 dark:text-red-200"
              : statusMessage.type === "warning"
              ? "bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200"
              : "bg-destructive/15 text-destructive border-destructive/30"
          }`}
        >
          {statusMessage.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      <Button
        variant="destructive"
        size="lg"
        className="w-full bg-red-600 hover:bg-red-700 text-white font-bold text-base shadow-md flex items-center justify-center gap-2"
        onClick={() => setIsOpen(true)}
      >
        🚨 SOS / Emergency
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-background rounded-lg border shadow-xl max-w-md w-full p-6 space-y-5">
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-destructive flex items-center gap-2">
                <span>🚨 Emergency Assistance</span>
              </h2>
              <p className="text-sm text-foreground leading-relaxed">
                Are you sure you want to send an emergency SOS?
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your emergency contact and platform safety team will receive your active trip details and current GPS coordinates immediately.
              </p>
            </div>

            {/* Live GPS Acquisition Card */}
            <div className="rounded-lg border p-3 bg-muted/40 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold flex items-center gap-1.5 text-foreground">
                  <MapPin className="w-4 h-4 text-primary" /> Live GPS Status:
                </span>
                {gpsStatus === "ACQUIRING" && (
                  <span className="text-sky-600 dark:text-sky-400 font-medium flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Acquiring GPS...
                  </span>
                )}
                {gpsStatus === "ACQUIRED" && gpsFix && (
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> GPS Locked (±{Math.round(gpsFix.accuracy)}m)
                  </span>
                )}
                {gpsStatus === "ERROR" && (
                  <span className="text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5" /> GPS Failed
                  </span>
                )}
              </div>

              {gpsStatus === "ACQUIRED" && gpsFix && (
                <div className="space-y-1 pt-1 border-t text-[11px] text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Coordinates:</span>
                    <span className="font-mono text-foreground font-medium">
                      {gpsFix.latitude.toFixed(5)}, {gpsFix.longitude.toFixed(5)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Map Link:</span>
                    <a
                      href={`https://maps.google.com/?q=${gpsFix.latitude},${gpsFix.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline font-medium"
                    >
                      View on Google Maps →
                    </a>
                  </div>
                </div>
              )}

              {gpsStatus === "ERROR" && (
                <div className="space-y-2 pt-1 border-t">
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 leading-tight">
                    {gpsError || "Unable to acquire accurate GPS position."}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full text-xs h-7 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    onClick={acquireGps}
                  >
                    <RefreshCw className="w-3 h-3 mr-1.5" /> Retry GPS Acquisition
                  </Button>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex items-center justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="bg-red-600 hover:bg-red-700 text-white font-bold"
                  onClick={() => handleSendSos(false)}
                  disabled={isSubmitting || gpsStatus === "ACQUIRING"}
                >
                  {isSubmitting ? "Sending SOS..." : gpsStatus === "ACQUIRED" ? "SEND SOS WITH GPS" : "SEND SOS"}
                </Button>
              </div>

              {gpsStatus === "ERROR" && (
                <button
                  type="button"
                  onClick={() => handleSendSos(true)}
                  disabled={isSubmitting}
                  className="text-[11px] text-muted-foreground hover:text-foreground text-center underline pt-1"
                >
                  Or proceed to send SOS without GPS location
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import RouteMap, { RouteInfo } from "@/components/RouteMap";
import { LocationInput, LocationSuggestion } from "@/components/LocationInput";
import { calculateFare } from "@/lib/fareCalculator";
import BackButton from "@/components/BackButton";

import Link from "next/link";

const SEAT_OPTIONS = [1, 4, 6];

export default function CreateRide() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [driverPhone, setDriverPhone] = useState<string | null>(null);

  // Protect route: redirect non-drivers to dashboard and load driver profile phone
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    } else if (status === "authenticated") {
      const userType = session?.user?.userType;
      if (userType !== "DRIVER" && userType !== "BOTH") {
        router.push("/dashboard");
      }
      fetch("/api/user/profile")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.phoneNumber) {
            setDriverPhone(data.phoneNumber);
          }
        })
        .catch(() => {});
    }
  }, [status, session, router]);

  const [formData, setFormData] = useState({
    origin: "",
    destination: "",
    departure: "",
    seats: 4,
    vehicleName: "",
  });

  // Store resolved coordinates from LocationInput selections
  const [originLoc, setOriginLoc] = useState<LocationSuggestion | null>(null);
  const [destLoc, setDestLoc] = useState<LocationSuggestion | null>(null);

  useEffect(() => {
    if (!(formData.origin.length > 2 && formData.destination.length > 2)) {
      setRouteInfo(null);
    }
  }, [formData.origin, formData.destination]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target;
    setFormData((prev) => ({ ...prev, [id]: value }));
  };

  const handleOriginChange = (value: string) => {
    setFormData((prev) => ({ ...prev, origin: value }));
    setOriginLoc(null);
  };

  const handleDestChange = (value: string) => {
    setFormData((prev) => ({ ...prev, destination: value }));
    setDestLoc(null);
  };

  const handleOriginSelect = (loc: LocationSuggestion) => {
    setFormData((prev) => ({ ...prev, origin: loc.name }));
    setOriginLoc(loc);
  };

  const handleDestSelect = (loc: LocationSuggestion) => {
    setFormData((prev) => ({ ...prev, destination: loc.name }));
    setDestLoc(loc);
  };

  const handleRouteCalculated = (info: RouteInfo | null) => {
    setRouteInfo(info);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      // Calculate total ride fare based on route distance
      const calculatedPrice = routeInfo?.distance
        ? calculateFare({ rideType: "Personal Cab", routeDistanceMeters: routeInfo.distance }).passengerTotal
        : 0;

      const res = await fetch("/api/rides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          price: calculatedPrice,
          distance: routeInfo?.distance,
          duration: routeInfo?.duration,
          originLat: originLoc?.lat,
          originLon: originLoc?.lon,
          destLat: destLoc?.lat,
          destLon: destLoc?.lon,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to create ride");
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <BackButton fallbackHref="/dashboard" label="Back to Dashboard" />
      <Card className="shadow-xs border">
        <CardHeader className="pb-4 border-b">
          <CardTitle className="text-2xl font-bold tracking-tight">Publish a Ride</CardTitle>
          <CardDescription>
            Offer a seat to other students travelling your route.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="text-xs sm:text-sm text-destructive font-medium bg-destructive/10 border border-destructive/20 p-2.5 rounded-lg">
                {error}
              </div>
            )}

            <div className="p-3 rounded-lg border bg-muted/30 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-foreground block">
                  Driver Coordination Phone
                </span>
                <span className="text-muted-foreground text-[11px]">
                  {driverPhone 
                    ? `📞 ${driverPhone} — Visible strictly to confirmed passengers.`
                    : "No personal phone saved in your profile yet (optional)."}
                </span>
              </div>
              <Link
                href="/profile"
                className="text-primary hover:underline font-medium text-xs whitespace-nowrap self-start sm:self-auto"
              >
                {driverPhone ? "Edit in Profile" : "+ Add in Profile"}
              </Link>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="origin">Origin (Starting Location)</Label>
                <LocationInput
                  id="origin"
                  placeholder="e.g. IIIT Pune, Talegaon"
                  required
                  value={formData.origin}
                  onChange={handleOriginChange}
                  onSelect={handleOriginSelect}
                />
              </div>
              
              <div className="space-y-1.5">
                <Label htmlFor="destination">Destination</Label>
                <LocationInput
                  id="destination"
                  placeholder="e.g. Talegaon Station"
                  required
                  value={formData.destination}
                  onChange={handleDestChange}
                  onSelect={handleDestSelect}
                />
              </div>
            </div>

            <div className="rounded-xl overflow-hidden border bg-muted/30">
              <div className="p-3 px-4 border-b bg-card flex justify-between items-center">
                <h3 className="font-semibold text-sm">Route Preview</h3>
                {routeInfo && (
                  <div className="text-xs text-muted-foreground font-medium flex gap-4">
                    <span>{(routeInfo.distance / 1000).toFixed(1)} km</span>
                    <span>{Math.round(routeInfo.duration / 60)} mins</span>
                  </div>
                )}
              </div>
              <div className="p-3 h-56 sm:h-64">
                {(formData.origin.length > 2 && formData.destination.length > 2) ? (
                  <RouteMap 
                    origin={originLoc ?? formData.origin} 
                    destination={destLoc ?? formData.destination} 
                    onRouteCalculated={handleRouteCalculated} 
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-muted-foreground text-xs sm:text-sm border rounded-lg bg-muted/50">
                    Enter an origin and destination to preview the route
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="departure">Departure Date &amp; Time</Label>
              <Input 
                id="departure" 
                type="datetime-local" 
                required 
                value={formData.departure}
                onChange={handleChange}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="vehicleName">Car Name</Label>
                <Input
                  id="vehicleName"
                  placeholder="e.g. Swift"
                  required
                  value={formData.vehicleName}
                  onChange={handleChange}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Available Seats</Label>
                <div className="flex gap-3">
                  {SEAT_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setFormData((prev) => ({ ...prev, seats: n }))}
                      className={`flex-1 h-10 rounded-lg border text-sm font-semibold transition-colors ${
                        formData.seats === n
                          ? "bg-primary text-primary-foreground border-primary shadow-xs"
                          : "bg-background text-foreground border-input hover:bg-muted"
                      }`}
                    >
                      {n} {n === 1 ? "seat" : "seats"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Button type="submit" size="lg" className="w-full mt-4 font-semibold" disabled={isLoading}>
              {isLoading ? "Publishing..." : "Publish Ride"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

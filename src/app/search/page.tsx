import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { geocode, decodePolyline6, pointToRouteDistance, getRouteSegmentDistance } from "@/lib/geo";
import { calculateFare } from "@/lib/fareCalculator";
import { fetchRoadDistance, calculateRoadDetourDistance } from "@/lib/dynamicRouting";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getBidirectionalBlockedUserIds } from "@/lib/block";
import BackButton from "@/components/BackButton";

// Allow Next.js to dynamically render this page on every request
export const dynamic = "force-dynamic";

export default async function SearchResults({
  searchParams,
}: {
  searchParams: { origin?: string; destination?: string; originLat?: string; originLon?: string; destLat?: string; destLon?: string };
}) {
  const session = await getServerSession(authOptions);
  const currentUserId = session?.user?.id;
  const blockedUserIds = currentUserId ? await getBidirectionalBlockedUserIds(currentUserId) : [];

  const origin = searchParams.origin || "";
  const destination = searchParams.destination || "";
  const reqOriginLat = searchParams.originLat ? parseFloat(searchParams.originLat) : null;
  const reqOriginLon = searchParams.originLon ? parseFloat(searchParams.originLon) : null;
  const reqDestLat = searchParams.destLat ? parseFloat(searchParams.destLat) : null;
  const reqDestLon = searchParams.destLon ? parseFloat(searchParams.destLon) : null;

  // 1. Geocode passenger locations (using passed search parameters first if available)
  const passStart = (reqOriginLat !== null && reqOriginLon !== null && !isNaN(reqOriginLat) && !isNaN(reqOriginLon))
    ? { lat: reqOriginLat, lon: reqOriginLon }
    : (origin ? await geocode(origin) : null);

  const passEnd = (reqDestLat !== null && reqDestLon !== null && !isNaN(reqDestLat) && !isNaN(reqDestLon))
    ? { lat: reqDestLat, lon: reqDestLon }
    : (destination ? await geocode(destination) : null);

  // 2. Fetch all available future rides (SCHEDULED status only, within 15 mins grace period)
  // Exclude rides where the driver or an active co-passenger has a bidirectional block with current user
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  const allRides = await prisma.ride.findMany({
    where: {
      status: "SCHEDULED",
      seats: { gt: 0 },
      departure: { gte: fifteenMinutesAgo },
      ...(blockedUserIds.length > 0 ? {
        driverId: { notIn: blockedUserIds },
        bookings: {
          none: {
            userId: { in: blockedUserIds },
            status: { in: ["PENDING", "CONFIRMED"] }
          }
        }
      } : {})
    },
    include: {
      driver: { select: { name: true, studentVerificationStatus: true, driverVerificationStatus: true } },
      bookings: {
        where: { status: { in: ["PENDING", "CONFIRMED"] } },
        select: { preferredPassengerGender: true, userId: true },
      },
    },
    orderBy: { departure: "asc" },
  });

  const matchedRides = [];

  for (const ride of allRides) {
    const hasFemaleCoPassengerPref = ride.bookings.some(b => b.preferredPassengerGender === "FEMALE");

    if (!passStart && !passEnd) {
      // Default fallback if no search params are provided
      const fallbackFare = ride.price > 0 
        ? ride.price 
        : (ride.distance ? calculateFare({ rideType: ride.rideType || "Personal Cab", routeDistanceMeters: ride.distance }).passengerTotal : 0);
      matchedRides.push({ ...ride, dynamicPrice: fallbackFare, hasFemaleCoPassengerPref });
      continue;
    }

    // 3. Geocode driver locations if missing
    const driverStart = (ride.originLat !== null && ride.originLat !== undefined && ride.originLon !== null && ride.originLon !== undefined) 
      ? { lat: ride.originLat, lon: ride.originLon } 
      : await geocode(ride.origin);
    const driverEnd = (ride.destLat !== null && ride.destLat !== undefined && ride.destLon !== null && ride.destLon !== undefined) 
      ? { lat: ride.destLat, lon: ride.destLon } 
      : await geocode(ride.destination);

    if (driverStart && driverEnd) {
      let points: [number, number][] = [[driverStart.lat, driverStart.lon], [driverEnd.lat, driverEnd.lon]];

      // Prefer baseline A -> B route geometry from database if present
      if (ride.baseRouteGeometry) {
        try {
          const parsed = JSON.parse(ride.baseRouteGeometry);
          if (Array.isArray(parsed) && parsed.length > 1) {
            points = parsed;
          }
        } catch {}
      } else if (ride.routeGeometry) {
        try {
          const parsed = JSON.parse(ride.routeGeometry);
          if (Array.isArray(parsed) && parsed.length > 2) {
            points = parsed;
          }
        } catch {}
      }

      // If points still empty or 2 points, fetch original route geometry from Valhalla
      if (points.length <= 2) {
        try {
          const payloadFastest = {
            locations: [{ lat: driverStart.lat, lon: driverStart.lon }, { lat: driverEnd.lat, lon: driverEnd.lon }],
            costing: "auto",
            costing_options: { auto: { shortest: false } }
          };
          const res = await fetch("https://valhalla1.openstreetmap.de/route", { 
            method: "POST", 
            headers: { "Content-Type": "application/json" }, 
            body: JSON.stringify(payloadFastest) 
          });
          if (res.ok) {
            const data = await res.json();
            if (data.trip && data.trip.legs && data.trip.legs.length > 0) {
              const shape = data.trip.legs[0].shape;
              points = decodePolyline6(shape);
            }
          }
        } catch (e) {
          console.error("Valhalla routing error, falling back to straight-line:", e);
        }
      }

      let matched = false;
      let pickupInfo: ReturnType<typeof pointToRouteDistance> | null = null;
      let dropInfo: ReturnType<typeof pointToRouteDistance> | null = null;

      // Allowable limit: 2.0 km (testing buffer)
      const maxDist = 2.0;

      // 5. Calculate proximity to route
      if (passStart && passEnd) {
        pickupInfo = pointToRouteDistance(passStart.lat, passStart.lon, points);
        dropInfo = pointToRouteDistance(passEnd.lat, passEnd.lon, points);
        
        const isDirectionValid = pickupInfo.minIndex < dropInfo.minIndex || 
          (pickupInfo.minIndex === dropInfo.minIndex && pickupInfo.minProj.t <= dropInfo.minProj.t);

        // 6. Check tolerance and valid direction
        if (pickupInfo.minDist <= maxDist && dropInfo.minDist <= maxDist && isDirectionValid) {
          matched = true;
        }
      } else if (passStart) {
        pickupInfo = pointToRouteDistance(passStart.lat, passStart.lon, points);
        if (pickupInfo.minDist <= maxDist) matched = true;
      } else if (passEnd) {
        dropInfo = pointToRouteDistance(passEnd.lat, passEnd.lon, points);
        if (dropInfo.minDist <= maxDist) matched = true;
      }

      if (matched) {
        let segmentDistanceMeters = ride.distance || 0;
        const isDirectionValid = passStart && passEnd && pickupInfo && dropInfo && 
          (pickupInfo.minIndex < dropInfo.minIndex || 
          (pickupInfo.minIndex === dropInfo.minIndex && pickupInfo.minProj.t <= dropInfo.minProj.t));

        let pickupDetourMeters = 0;
        let dropDetourMeters = 0;

        if (passStart) {
          const pDetour = await calculateRoadDetourDistance(passStart, points);
          pickupDetourMeters = pDetour.detourMeters;
        }

        if (passEnd) {
          const dDetour = await calculateRoadDetourDistance(passEnd, points);
          dropDetourMeters = dDetour.detourMeters;
        }

        if (isDirectionValid && pickupInfo && dropInfo && passStart && passEnd) {
          if (pickupDetourMeters === 0 && dropDetourMeters === 0) {
            const actualRoadDist = await fetchRoadDistance(passStart, passEnd);
            if (typeof actualRoadDist === "number" && actualRoadDist > 0) {
              segmentDistanceMeters = actualRoadDist;
            } else {
              const distKm = getRouteSegmentDistance(
                points, 
                pickupInfo.minIndex, 
                pickupInfo.minProj, 
                dropInfo.minIndex, 
                dropInfo.minProj
              );
              segmentDistanceMeters = distKm * 1000;
            }
          } else {
            const distKm = getRouteSegmentDistance(
              points, 
              pickupInfo.minIndex, 
              pickupInfo.minProj, 
              dropInfo.minIndex, 
              dropInfo.minProj
            );
            segmentDistanceMeters = distKm * 1000;
          }
        }

        const fare = calculateFare({
          rideType: ride.rideType,
          routeDistanceMeters: segmentDistanceMeters,
          pickupDetourMeters,
          dropDetourMeters,
        });

        matchedRides.push({
          ...ride,
          dynamicPrice: fare.passengerTotal,
          hasFemaleCoPassengerPref
        });
      }
    }
  }

  const rides = matchedRides;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <BackButton fallbackHref="/" label="Back to Search" />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Search Results</h1>
        <p className="text-muted-foreground mt-2">
          Found {rides.length} {rides.length === 1 ? "ride" : "rides"} from &quot;{origin}&quot; to &quot;{destination}&quot;.
        </p>
      </div>

      {rides.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center flex flex-col items-center justify-center space-y-4">
            <h2 className="text-xl font-semibold text-foreground">No rides found</h2>
            <p className="text-muted-foreground max-w-sm">
              We couldn&apos;t find any available rides matching your route. Check back later or adjust your search.
            </p>
            <Link href="/" className={cn(buttonVariants({ variant: "outline" }))}>
              Go back
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {rides.map((ride) => (
            <Link 
              key={ride.id} 
              href={`/rides/${ride.id}?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&fare=${ride.dynamicPrice}`} 
              className="block group"
            >
              <Card className="flex flex-col h-full transition-shadow hover:shadow-md group-hover:border-primary/50 cursor-pointer">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-base leading-snug group-hover:text-primary transition-colors">
                        {ride.origin} → {ride.destination}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {new Date(ride.departure).toLocaleString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-foreground">Driver:</span> {ride.driver.name}
                      {ride.driver.driverVerificationStatus === "APPROVED" && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-600 text-white">✓ Driver</span>
                      )}
                      {ride.driver.studentVerificationStatus === "APPROVED" && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-600 text-white">✓ Student</span>
                      )}
                    </p>
                    <p><span className="font-medium text-foreground">{ride.seats} seats available</span></p>
                    <p className="font-semibold text-foreground">Ride Fare: ₹{ride.dynamicPrice.toFixed(2)}</p>
                    {ride.hasFemaleCoPassengerPref && (
                      <div className="pt-1">
                        <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded bg-pink-100 dark:bg-pink-950 text-pink-700 dark:text-pink-300 border border-pink-200 dark:border-pink-900">
                          🛡️ Female Co-Passenger Preference
                        </span>
                      </div>
                    )}
                  </div>
                </CardContent>
                <div className="p-6 pt-0 mt-auto">
                  <span className={cn(buttonVariants({ variant: "default" }), "w-full pointer-events-none text-center")}>
                    View Details →
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

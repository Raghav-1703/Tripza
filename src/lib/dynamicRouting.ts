import { prisma } from "@/lib/prisma";
import { geocode, decodePolyline6, pointToRouteDistance, getRouteSegmentDistance, haversineDistance } from "@/lib/geo";
import { calculateFare } from "@/lib/fareCalculator";

export interface RouteStop {
  id: string;
  type: "PICKUP" | "DROP";
  bookingId: string;
  passengerName: string;
  locationName: string;
  lat: number;
  lon: number;
}

// Helper to fetch base direct route between driver origin and destination
export async function fetchDirectRoute(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number }
): Promise<[number, number][]> {
  try {
    const payload = {
      locations: [{ lat: start.lat, lon: start.lon }, { lat: end.lat, lon: end.lon }],
      costing: "auto",
      costing_options: { auto: { shortest: false } },
    };
    const res = await fetch("https://valhalla1.openstreetmap.de/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.trip?.legs?.[0]?.shape) {
        return decodePolyline6(data.trip.legs[0].shape);
      }
    }
  } catch (err) {
    console.error("Failed to fetch direct route from Valhalla:", err);
  }
  return [[start.lat, start.lon], [end.lat, end.lon]];
}

const roadDistanceCache = new Map<string, number>();

// Helper to fetch true road distance in meters between any two points
export async function fetchRoadDistance(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number }
): Promise<number | null> {
  const cacheKey = `${start.lat.toFixed(4)},${start.lon.toFixed(4)}->${end.lat.toFixed(4)},${end.lon.toFixed(4)}`;
  if (roadDistanceCache.has(cacheKey)) {
    return roadDistanceCache.get(cacheKey)!;
  }

  try {
    const payload = {
      locations: [{ lat: start.lat, lon: start.lon }, { lat: end.lat, lon: end.lon }],
      costing: "auto",
      costing_options: { auto: { shortest: false } },
    };
    const res = await fetch("https://valhalla1.openstreetmap.de/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      if (typeof data.trip?.summary?.length === "number") {
        const distMeters = data.trip.summary.length * 1000;
        roadDistanceCache.set(cacheKey, distMeters);
        return distMeters;
      }
    }
  } catch (err) {
    console.warn("fetchRoadDistance failed, falling back to polyline projection:", err);
  }
  return null;
}

// Calculates actual road detour distance from a point to the nearest baseline route point
export async function calculateRoadDetourDistance(
  point: { lat: number; lon: number },
  baselinePolyline: [number, number][]
): Promise<{
  detourMeters: number;
  proj: { lat: number; lon: number; minDist: number; minIndex: number; t: number };
}> {
  const pProj = pointToRouteDistance(point.lat, point.lon, baselinePolyline);
  // If within 50m (0.05 km) of baseline route, point is directly on-route
  if (pProj.minDist <= 0.05) {
    return {
      detourMeters: 0,
      proj: {
        lat: pProj.minProj.lat,
        lon: pProj.minProj.lon,
        minDist: pProj.minDist,
        minIndex: pProj.minIndex,
        t: pProj.minProj.t,
      },
    };
  }

  // Calculate actual road distance from nearest baseline road point to detour point
  const nearestBaselinePoint = { lat: pProj.minProj.lat, lon: pProj.minProj.lon };
  const roadMeters = await fetchRoadDistance(nearestBaselinePoint, point);
  const detourMeters = (roadMeters !== null && roadMeters > 0)
    ? roadMeters
    : pProj.minDist * 1000;

  return {
    detourMeters,
    proj: {
      lat: pProj.minProj.lat,
      lon: pProj.minProj.lon,
      minDist: pProj.minDist,
      minIndex: pProj.minIndex,
      t: pProj.minProj.t,
    },
  };
}

// Evaluates passenger eligibility against a ride's corridor using existing pickup-radius and direction rules
export async function checkPassengerEligibility({
  rideId,
  passengerOrigin,
  passengerDestination,
  passengerOriginCoords,
  passengerDestinationCoords,
  driverOriginCoords,
  driverDestCoords,
  rideType,
  existingRouteGeometry,
}: {
  rideId?: string;
  passengerOrigin: string;
  passengerDestination: string;
  passengerOriginCoords?: { lat: number; lon: number } | null;
  passengerDestinationCoords?: { lat: number; lon: number } | null;
  driverOriginCoords?: { lat: number; lon: number } | null;
  driverDestCoords?: { lat: number; lon: number } | null;
  rideType?: string;
  existingRouteGeometry?: [number, number][];
}) {
  let driverStart = driverOriginCoords || null;
  let driverEnd = driverDestCoords || null;
  let effectiveRideType = rideType || "Personal Cab";
  let storedRouteGeometry = existingRouteGeometry || null;

  if (rideId) {
    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      select: {
        id: true,
        origin: true,
        originLat: true,
        originLon: true,
        destination: true,
        destLat: true,
        destLon: true,
        rideType: true,
        distance: true,
        baseDistance: true,
        baseRouteGeometry: true,
        routeGeometry: true,
      },
    });

    if (!ride) {
      return { eligible: false, reason: "Ride not found" };
    }

    if (!driverStart) {
      driverStart = (ride.originLat !== null && ride.originLon !== null)
        ? { lat: ride.originLat, lon: ride.originLon }
        : await geocode(ride.origin);
    }

    if (!driverEnd) {
      driverEnd = (ride.destLat !== null && ride.destLon !== null)
        ? { lat: ride.destLat, lon: ride.destLon }
        : await geocode(ride.destination);
    }

    effectiveRideType = ride.rideType || effectiveRideType;
    if (ride.baseRouteGeometry) {
      try {
        storedRouteGeometry = JSON.parse(ride.baseRouteGeometry);
      } catch {}
    } else if (!storedRouteGeometry && ride.routeGeometry) {
      try {
        storedRouteGeometry = JSON.parse(ride.routeGeometry);
      } catch {}
    }
  }

  if (!driverStart || !driverEnd) {
    return { eligible: false, reason: "Could not resolve driver route coordinates" };
  }

  // 2. Resolve passenger coordinates
  const passStart = passengerOriginCoords || await geocode(passengerOrigin);
  const passEnd = passengerDestinationCoords || await geocode(passengerDestination);

  if (!passStart || !passEnd) {
    return { eligible: false, reason: "Could not geocode passenger pickup or destination location" };
  }

  // 3. Resolve route geometry (prioritize baseline A -> B route)
  let routePoints: [number, number][];
  if (storedRouteGeometry && storedRouteGeometry.length > 0) {
    routePoints = storedRouteGeometry;
  } else {
    routePoints = await fetchDirectRoute(driverStart, driverEnd);
  }

  // 4. Calculate proximity to baseline route
  const pickupInfo = pointToRouteDistance(passStart.lat, passStart.lon, routePoints);
  const dropInfo = pointToRouteDistance(passEnd.lat, passEnd.lon, routePoints);

  // Allowable limit: 2.0 km (testing buffer)
  const maxDist = 2.0;

  // Direction validation: pickup must occur before or at the same segment with t <= dropInfo.t
  const isDirectionValid =
    pickupInfo.minIndex < dropInfo.minIndex ||
    (pickupInfo.minIndex === dropInfo.minIndex && pickupInfo.minProj.t <= dropInfo.minProj.t);

  if (pickupInfo.minDist > maxDist) {
    return {
      eligible: false,
      reason: `Pickup point is ${(pickupInfo.minDist).toFixed(2)} km away from route (allowable limit is ${maxDist} km)`,
      passStart,
      passEnd,
    };
  }

  if (dropInfo.minDist > maxDist) {
    return {
      eligible: false,
      reason: `Drop-off point is ${(dropInfo.minDist).toFixed(2)} km away from route (allowable limit is ${maxDist} km)`,
      passStart,
      passEnd,
    };
  }

  if (!isDirectionValid) {
    return {
      eligible: false,
      reason: "Passenger travel direction does not match the driver's route direction",
      passStart,
      passEnd,
    };
  }

  // Calculate actual road detour for pickup and drop-off
  const pickupDetourInfo = await calculateRoadDetourDistance(passStart, routePoints);
  const dropDetourInfo = await calculateRoadDetourDistance(passEnd, routePoints);

  const pickupDetourMeters = pickupDetourInfo.detourMeters;
  const dropDetourMeters = dropDetourInfo.detourMeters;

  // Calculate normal journey segment distance (along the corridor between entry and exit points)
  let segmentDistanceMeters = 0;
  if (pickupDetourMeters === 0 && dropDetourMeters === 0) {
    // Both stops on-route: use actual road distance
    const actualRoadDist = await fetchRoadDistance(passStart, passEnd);
    segmentDistanceMeters = (typeof actualRoadDist === "number" && actualRoadDist > 0)
      ? actualRoadDist
      : getRouteSegmentDistance(
          routePoints,
          pickupInfo.minIndex,
          pickupInfo.minProj,
          dropInfo.minIndex,
          dropInfo.minProj
        ) * 1000;
  } else {
    // Has detour: normal segment along baseline corridor
    segmentDistanceMeters = getRouteSegmentDistance(
      routePoints,
      pickupInfo.minIndex,
      pickupInfo.minProj,
      dropInfo.minIndex,
      dropInfo.minProj
    ) * 1000;
  }

  const fareResult = calculateFare({
    rideType: effectiveRideType,
    routeDistanceMeters: segmentDistanceMeters,
    pickupDetourMeters,
    dropDetourMeters,
  });

  return {
    eligible: true,
    passStart,
    passEnd,
    segmentDistanceMeters,
    pickupDetourMeters,
    dropDetourMeters,
    mainFare: fareResult.mainRouteFare,
    detourFare: fareResult.pickupDetourFare + fareResult.dropDetourFare,
    detourDistance: pickupDetourMeters + dropDetourMeters,
    fare: fareResult.passengerTotal,
    fareBreakdown: fareResult,
  };
}

// Recalculates the driving route with Valhalla including all confirmed passenger pickup/drop-off detours,
// and updates the fares of all affected confirmed passengers.
export async function recalculateRideRouteAndFares(rideId: string) {
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    include: {
      bookings: {
        where: { status: "CONFIRMED" },
        include: { user: { select: { name: true } } },
      },
    },
  });

  if (!ride) {
    return { success: false, reason: `Ride ${rideId} not found`, routeGeometry: null };
  }

  const driverStart = (ride.originLat !== null && ride.originLon !== null)
    ? { lat: ride.originLat, lon: ride.originLon }
    : await geocode(ride.origin);

  const driverEnd = (ride.destLat !== null && ride.destLon !== null)
    ? { lat: ride.destLat, lon: ride.destLon }
    : await geocode(ride.destination);

  if (!driverStart || !driverEnd) {
    console.warn("Could not determine driver origin or destination coordinates; skipping reroute.");
    return { success: false, reason: "Missing driver coordinates" };
  }

  // 1. Identify and permanently preserve the driver's baseline original A -> B route
  let basePolyline: [number, number][];
  let baseDistance = ride.baseDistance;

  if (ride.baseRouteGeometry) {
    try {
      basePolyline = JSON.parse(ride.baseRouteGeometry);
    } catch {
      basePolyline = await fetchDirectRoute(driverStart, driverEnd);
    }
  } else {
    basePolyline = await fetchDirectRoute(driverStart, driverEnd);
    if (!baseDistance) {
      let bDist = 0;
      for (let i = 0; i < basePolyline.length - 1; i++) {
        bDist += haversineDistance(
          basePolyline[i][0],
          basePolyline[i][1],
          basePolyline[i + 1][0],
          basePolyline[i + 1][1]
        ) * 1000;
      }
      baseDistance = bDist;
    }
    // Store permanently on ride so baseline A -> B route remains identifiable
    await prisma.ride.update({
      where: { id: rideId },
      data: {
        baseRouteGeometry: JSON.stringify(basePolyline),
        baseDistance,
      },
    });
  }

  // Filter confirmed bookings that have valid pickup and drop coordinates
  const confirmedWithStops = ride.bookings.filter(
    (b) =>
      b.pickupLat !== null &&
      b.pickupLon !== null &&
      b.dropLat !== null &&
      b.dropLon !== null &&
      !isNaN(b.pickupLat) &&
      !isNaN(b.pickupLon) &&
      !isNaN(b.dropLat) &&
      !isNaN(b.dropLon)
  );

  // If no confirmed passengers with custom stops, revert to direct baseline route
  if (confirmedWithStops.length === 0) {
    await prisma.ride.update({
      where: { id: rideId },
      data: {
        distance: baseDistance,
        routeGeometry: JSON.stringify(basePolyline),
        routeUpdatedAt: new Date(),
      },
    });
    return { success: true, distance: baseDistance, stopsCount: 0 };
  }

  // 2. Compute individual detour distances and route projections against baseline route
  interface PassengerDetourMeta {
    bookingId: string;
    pickupLat: number;
    pickupLon: number;
    dropLat: number;
    dropLon: number;
    pDetourMeters: number;
    dDetourMeters: number;
    pProj: { lat: number; lon: number; minDist: number; minIndex: number; t: number };
    dProj: { lat: number; lon: number; minDist: number; minIndex: number; t: number };
    allocatedPickupDetour: number;
    allocatedDropDetour: number;
    sharedPickupPassengersCount: number;
    sharedDropPassengersCount: number;
  }

  const passMetas: PassengerDetourMeta[] = [];

  for (const b of confirmedWithStops) {
    const pDetourInfo = await calculateRoadDetourDistance(
      { lat: b.pickupLat!, lon: b.pickupLon! },
      basePolyline
    );
    const dDetourInfo = await calculateRoadDetourDistance(
      { lat: b.dropLat!, lon: b.dropLon! },
      basePolyline
    );

    passMetas.push({
      bookingId: b.id,
      pickupLat: b.pickupLat!,
      pickupLon: b.pickupLon!,
      dropLat: b.dropLat!,
      dropLon: b.dropLon!,
      pDetourMeters: pDetourInfo.detourMeters,
      dDetourMeters: dDetourInfo.detourMeters,
      pProj: pDetourInfo.proj,
      dProj: dDetourInfo.proj,
      allocatedPickupDetour: pDetourInfo.detourMeters,
      allocatedDropDetour: dDetourInfo.detourMeters,
      sharedPickupPassengersCount: 1,
      sharedDropPassengersCount: 1,
    });
  }

  // 3. Shared Detour Allocation:
  // If multiple passengers share the same off-route detour (stops within 300m / 0.3km of each other),
  // divide the extra detour distance equally among them to avoid double-charging.
  
  // Group off-route pickups
  const offRoutePickups = passMetas.filter((p) => p.pDetourMeters > 0);
  const visitedPickups = new Set<string>();

  for (const p of offRoutePickups) {
    if (visitedPickups.has(p.bookingId)) continue;
    const cluster = offRoutePickups.filter(
      (other) =>
        haversineDistance(p.pickupLat, p.pickupLon, other.pickupLat, other.pickupLon) <= 0.3
    );

    cluster.forEach((member) => visitedPickups.add(member.bookingId));

    const maxDetour = Math.max(...cluster.map((c) => c.pDetourMeters));
    const allocated = maxDetour / cluster.length;

    cluster.forEach((member) => {
      member.allocatedPickupDetour = allocated;
      member.sharedPickupPassengersCount = cluster.length;
    });
  }

  // Group off-route drops
  const offRouteDrops = passMetas.filter((p) => p.dDetourMeters > 0);
  const visitedDrops = new Set<string>();

  for (const d of offRouteDrops) {
    if (visitedDrops.has(d.bookingId)) continue;
    const cluster = offRouteDrops.filter(
      (other) =>
        haversineDistance(d.dropLat, d.dropLon, other.dropLat, other.dropLon) <= 0.3
    );

    cluster.forEach((member) => visitedDrops.add(member.bookingId));

    const maxDetour = Math.max(...cluster.map((c) => c.dDetourMeters));
    const allocated = maxDetour / cluster.length;

    cluster.forEach((member) => {
      member.allocatedDropDetour = allocated;
      member.sharedDropPassengersCount = cluster.length;
    });
  }

  // 4. Calculate passenger normal fares strictly for their own journey segment,
  // charge detours only to passengers whose stops cause them, and persist breakdown.
  for (const meta of passMetas) {
    let segmentMeters = 0;
    if (meta.pDetourMeters === 0 && meta.dDetourMeters === 0) {
      // Both stops on-route: road distance between pickup and drop
      const roadDist = await fetchRoadDistance(
        { lat: meta.pickupLat, lon: meta.pickupLon },
        { lat: meta.dropLat, lon: meta.dropLon }
      );
      segmentMeters = (roadDist !== null && roadDist > 0)
        ? roadDist
        : getRouteSegmentDistance(
            basePolyline,
            meta.pProj.minIndex,
            meta.pProj,
            meta.dProj.minIndex,
            meta.dProj
          ) * 1000;
    } else {
      // Off-route detour: normal segment along the baseline corridor between entry & exit
      segmentMeters = getRouteSegmentDistance(
        basePolyline,
        meta.pProj.minIndex,
        meta.pProj,
        meta.dProj.minIndex,
        meta.dProj
      ) * 1000;
    }

    const fareBreakdown = calculateFare({
      rideType: ride.rideType,
      routeDistanceMeters: segmentMeters,
      pickupDetourMeters: meta.allocatedPickupDetour,
      dropDetourMeters: meta.allocatedDropDetour,
    });

    await prisma.booking.update({
      where: { id: meta.bookingId },
      data: {
        fare: fareBreakdown.passengerTotal,
        mainFare: fareBreakdown.mainRouteFare,
        detourFare: fareBreakdown.pickupDetourFare + fareBreakdown.dropDetourFare,
        detourDistance: meta.allocatedPickupDetour + meta.allocatedDropDetour,
        fareBreakdown: JSON.stringify({
          ...fareBreakdown,
          sharedPickupCount: meta.sharedPickupPassengersCount,
          sharedDropCount: meta.sharedDropPassengersCount,
          allocatedPickupDetourMeters: meta.allocatedPickupDetour,
          allocatedDropDetourMeters: meta.allocatedDropDetour,
        }),
      },
    });
  }

  // 5. Build ordered stop points for Valhalla multi-stop route
  interface StopItem {
    id: string;
    bookingId: string;
    type: "PICKUP" | "DROP";
    lat: number;
    lon: number;
    name: string;
    locationName: string;
    progress: number;
  }

  const stops: StopItem[] = [];

  for (const b of confirmedWithStops) {
    const meta = passMetas.find((m) => m.bookingId === b.id)!;
    const pProgress = meta.pProj.minIndex + meta.pProj.t;
    const dProgress = Math.max(pProgress + 0.0001, meta.dProj.minIndex + meta.dProj.t);

    stops.push({
      id: `${b.id}-pickup`,
      bookingId: b.id,
      type: "PICKUP",
      lat: b.pickupLat!,
      lon: b.pickupLon!,
      name: b.user.name,
      locationName: b.pickupLocation || "Pickup",
      progress: pProgress,
    });

    stops.push({
      id: `${b.id}-drop`,
      bookingId: b.id,
      type: "DROP",
      lat: b.dropLat!,
      lon: b.dropLon!,
      name: b.user.name,
      locationName: b.dropLocation || "Drop-off",
      progress: dProgress,
    });
  }

  // Sort stops by progress along baseline route
  stops.sort((a, b) => {
    if (a.progress !== b.progress) return a.progress - b.progress;
    if (a.type === "PICKUP" && b.type === "DROP") return -1;
    if (a.type === "DROP" && b.type === "PICKUP") return 1;
    return 0;
  });

  // Construct complete ordered location waypoints for Valhalla
  const rawWaypoints = [
    { lat: driverStart.lat, lon: driverStart.lon },
    ...stops.map((s) => ({ lat: s.lat, lon: s.lon })),
    { lat: driverEnd.lat, lon: driverEnd.lon },
  ];

  // Deduplicate consecutive waypoints within 15 meters for clean Valhalla routing
  const dedupedLocations: { lat: number; lon: number }[] = [];
  for (const pt of rawWaypoints) {
    if (dedupedLocations.length === 0) {
      dedupedLocations.push(pt);
    } else {
      const prev = dedupedLocations[dedupedLocations.length - 1];
      const dist = haversineDistance(pt.lat, pt.lon, prev.lat, prev.lon);
      if (dist > 0.015) {
        dedupedLocations.push(pt);
      }
    }
  }

  try {
    const payload = {
      locations: dedupedLocations,
      costing: "auto",
      costing_options: { auto: { shortest: false } },
    };

    const res = await fetch("https://valhalla1.openstreetmap.de/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.warn(`Valhalla routing returned HTTP ${res.status}; preserving existing route & fares.`);
      return { success: false, preserved: true };
    }

    const data = await res.json();
    if (!data.trip || !data.trip.legs || data.trip.legs.length === 0) {
      console.warn("Valhalla returned no trip legs; preserving existing route & fares.");
      return { success: false, preserved: true };
    }

    const totalDistanceMeters = data.trip.summary.length * 1000;
    const totalDurationSeconds = Math.round(data.trip.summary.time);

    // Concatenate polyline shapes across all legs
    const combinedPolyline: [number, number][] = [];
    data.trip.legs.forEach((leg: { shape: string }, idx: number) => {
      const legPoints = decodePolyline6(leg.shape);
      if (idx === 0) {
        combinedPolyline.push(...legPoints);
      } else {
        // Skip first point of subsequent legs to avoid duplicate vertices
        combinedPolyline.push(...legPoints.slice(1));
      }
    });

    // Persist updated route geometry and road distance on Ride
    await prisma.ride.update({
      where: { id: rideId },
      data: {
        distance: totalDistanceMeters,
        duration: totalDurationSeconds,
        routeGeometry: JSON.stringify(combinedPolyline),
        routeUpdatedAt: new Date(),
      },
    });

    return {
      success: true,
      distance: totalDistanceMeters,
      duration: totalDurationSeconds,
      stopsCount: stops.length,
      polylinePointsCount: combinedPolyline.length,
    };
  } catch (error) {
    console.error("Valhalla rerouting encountered an exception; preserving existing route and fares:", error);
    return { success: false, preserved: true, error };
  }
}

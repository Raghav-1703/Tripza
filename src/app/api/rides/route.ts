import { checkPassengerEligibility } from "@/lib/dynamicRouting";
import { getBidirectionalBlockedUserIds } from "@/lib/block";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { calculateFare } from "@/lib/fareCalculator";
import { geocode } from "@/lib/geo";
import { fetchDirectRoute } from "@/lib/dynamicRouting";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const userType = session.user.userType;
    if (userType !== "DRIVER" && userType !== "BOTH") {
      return NextResponse.json({ message: "Forbidden: Only drivers can publish rides" }, { status: 403 });
    }

    // Check if driver already has an ACTIVE / in-progress ride
    const activeRide = await prisma.ride.findFirst({
      where: {
        driverId: session.user.id,
        status: "ACTIVE",
      },
    });

    if (activeRide) {
      return NextResponse.json(
        { message: "You already have an active ride. Complete or cancel it before publishing another ride." },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { origin, destination, departure, seats, price, vehicleName, distance, duration, originLat, originLon, destLat, destLon } = body;

    // Validation
    if (!origin || !destination || !departure || !seats) {
      return NextResponse.json({ message: "Missing required fields" }, { status: 400 });
    }

    const departureDate = new Date(departure);
    if (departureDate < new Date()) {
      return NextResponse.json({ message: "Departure date must be in the future" }, { status: 400 });
    }

    const parsedSeats = parseInt(seats);
    if (isNaN(parsedSeats) || parsedSeats < 1) {
      return NextResponse.json({ message: "Invalid number of seats" }, { status: 400 });
    }

    const parsedDistance = distance ? parseFloat(distance) : null;
    let parsedPrice = price ? parseFloat(price) : 0;

    // If price is 0 but route distance is available, calculate total fare using standard fare calculator
    if (parsedPrice <= 0 && parsedDistance && parsedDistance > 0) {
      const computed = calculateFare({
        rideType: "Personal Cab",
        routeDistanceMeters: parsedDistance,
      });
      parsedPrice = computed.passengerTotal;
    }

    let finalOriginLat = originLat !== undefined && originLat !== null ? parseFloat(originLat) : null;
    let finalOriginLon = originLon !== undefined && originLon !== null ? parseFloat(originLon) : null;
    let finalDestLat = destLat !== undefined && destLat !== null ? parseFloat(destLat) : null;
    let finalDestLon = destLon !== undefined && destLon !== null ? parseFloat(destLon) : null;

    if (finalOriginLat === null || finalOriginLon === null || isNaN(finalOriginLat) || isNaN(finalOriginLon)) {
      const g = await geocode(origin);
      if (g) {
        finalOriginLat = g.lat;
        finalOriginLon = g.lon;
      }
    }

    if (finalDestLat === null || finalDestLon === null || isNaN(finalDestLat) || isNaN(finalDestLon)) {
      const g = await geocode(destination);
      if (g) {
        finalDestLat = g.lat;
        finalDestLon = g.lon;
      }
    }

    let baseRouteGeometry: string | null = null;
    const baseDistance: number | null = parsedDistance;

    if (
      finalOriginLat !== null &&
      finalOriginLon !== null &&
      finalDestLat !== null &&
      finalDestLon !== null
    ) {
      try {
        const directPolyline = await fetchDirectRoute(
          { lat: finalOriginLat, lon: finalOriginLon },
          { lat: finalDestLat, lon: finalDestLon }
        );
        if (directPolyline && directPolyline.length > 0) {
          baseRouteGeometry = JSON.stringify(directPolyline);
        }
      } catch (err) {
        console.warn("Could not pre-fetch direct route geometry:", err);
      }
    }

    const ride = await prisma.ride.create({
      data: {
        driverId: session.user.id,
        origin,
        originLat: finalOriginLat,
        originLon: finalOriginLon,
        destination,
        destLat: finalDestLat,
        destLon: finalDestLon,
        departure: departureDate,
        seats: parsedSeats,
        price: parsedPrice,
        vehicleName: vehicleName || "",
        distance: distance ? parseFloat(distance) : null,
        duration: duration ? parseInt(duration) : null,
        baseRouteGeometry,
        baseDistance,
        routeGeometry: baseRouteGeometry,
      },
    });

    return NextResponse.json(ride, { status: 201 });
  } catch (error) {
    console.error("Failed to create ride:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}


export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const origin = searchParams.get("origin")?.trim() || "";
    const destination = searchParams.get("destination")?.trim() || "";
    const reqOriginLat = searchParams.get("originLat") ? parseFloat(searchParams.get("originLat")!) : null;
    const reqOriginLon = searchParams.get("originLon") ? parseFloat(searchParams.get("originLon")!) : null;
    const reqDestLat = searchParams.get("destLat") ? parseFloat(searchParams.get("destLat")!) : null;
    const reqDestLon = searchParams.get("destLon") ? parseFloat(searchParams.get("destLon")!) : null;
    const statusParam = searchParams.get("status");
    const maxDetourParam = searchParams.get("maxDetourKm") ? parseFloat(searchParams.get("maxDetourKm")!) : undefined;

    const allowedStatuses: ("SCHEDULED" | "ACTIVE")[] = statusParam
      ? (statusParam
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter((s) => s === "SCHEDULED" || s === "ACTIVE") as ("SCHEDULED" | "ACTIVE")[])
      : ["SCHEDULED", "ACTIVE"];

    const session = await getServerSession(authOptions);
    const currentUserId = session?.user?.id;
    const blockedUserIds = currentUserId ? await getBidirectionalBlockedUserIds(currentUserId) : [];

    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

    const rides = await prisma.ride.findMany({
      where: {
        status: { in: allowedStatuses },
        seats: { gt: 0 },
        OR: [
          { status: "ACTIVE" },
          { status: "SCHEDULED", departure: { gte: fifteenMinutesAgo } },
        ],
        ...(blockedUserIds.length > 0 ? {
          driverId: { notIn: blockedUserIds },
          bookings: {
            none: {
              userId: { in: blockedUserIds },
              status: { in: ["PENDING", "CONFIRMED"] },
            },
          },
        } : {}),
      },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            studentVerificationStatus: true,
            driverVerificationStatus: true,
          },
        },
        bookings: {
          where: { status: { in: ["PENDING", "CONFIRMED"] } },
          select: { preferredPassengerGender: true, userId: true },
        },
      },
      orderBy: [{ status: "asc" }, { departure: "asc" }],
    });

    const passStart = (reqOriginLat !== null && reqOriginLon !== null && !isNaN(reqOriginLat) && !isNaN(reqOriginLon))
      ? { lat: reqOriginLat, lon: reqOriginLon }
      : (origin ? await geocode(origin) : null);

    const passEnd = (reqDestLat !== null && reqDestLon !== null && !isNaN(reqDestLat) && !isNaN(reqDestLon))
      ? { lat: reqDestLat, lon: reqDestLon }
      : (destination ? await geocode(destination) : null);

    const results = [];

    for (const ride of rides) {
      const hasFemaleCoPassengerPref = ride.bookings.some((b) => b.preferredPassengerGender === "FEMALE");

      if (!passStart && !passEnd) {
        // Browse mode: return ride with default price
        const fallbackFare = ride.price > 0
          ? ride.price
          : (ride.distance ? calculateFare({ rideType: ride.rideType, routeDistanceMeters: ride.distance }).passengerTotal : 0);

        results.push({
          ...ride,
          dynamicPrice: fallbackFare,
          isEligible: true,
          hasFemaleCoPassengerPref,
        });
        continue;
      }

      // Check eligibility for partial, intermediate, or full journey
      const eligibility = await checkPassengerEligibility({
        rideId: ride.id,
        passengerOrigin: origin || ride.origin,
        passengerDestination: destination || ride.destination,
        passengerOriginCoords: passStart,
        passengerDestinationCoords: passEnd,
        maxDetourKm: maxDetourParam,
      });

      if (eligibility.eligible) {
        results.push({
          ...ride,
          dynamicPrice: eligibility.fare ?? ride.price,
          isEligible: true,
          segmentDistanceMeters: eligibility.segmentDistanceMeters,
          pickupDetourMeters: eligibility.pickupDetourMeters,
          dropDetourMeters: eligibility.dropDetourMeters,
          fareBreakdown: eligibility.fareBreakdown,
          hasFemaleCoPassengerPref,
        });
      }
    }

    return NextResponse.json({
      success: true,
      count: results.length,
      rides: results,
    });
  } catch (error) {
    console.error("Ride search API failed:", error);
    return NextResponse.json({ success: false, message: "Internal server error" }, { status: 500 });
  }
}

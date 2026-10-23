import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface RideTelemetry {
  heading: number | null;
  speed: number | null;
  lastLat: number;
  lastLon: number;
  updatedAt: Date;
}

// In-memory cache for fast transient telemetry (heading, speed) without schema changes
const liveTelemetryMap = new Map<string, RideTelemetry>();

// Calculate forward compass bearing (0° = North, 90° = East, 180° = South, 270° = West)
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const phi1 = lat1 * (Math.PI / 180);
  const phi2 = lat2 * (Math.PI / 180);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const ride = await prisma.ride.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        driverId: true,
        status: true,
        currentLat: true,
        currentLon: true,
        isLiveSharing: true,
        locationUpdatedAt: true,
        bookings: {
          select: { userId: true, status: true },
        },
      },
    });

    if (!ride) {
      return NextResponse.json({ message: "Ride not found" }, { status: 404 });
    }

    const isDriver = session.user.id === ride.driverId;
    const isPassenger = ride.bookings.some(
      (b) => b.userId === session.user.id && (b.status === "PENDING" || b.status === "CONFIRMED")
    );
    const isAdmin = session.user.role === "ADMIN";

    // Strictly authorize: driver, confirmed/pending passenger, or platform admin
    if (!isDriver && !isPassenger && !isAdmin) {
      return NextResponse.json({ message: "Forbidden: You are not authorized to view this ride's live location" }, { status: 403 });
    }

    // Only return live coordinates if the ride is currently ACTIVE and sharing is enabled
    const isSharingActive = Boolean(ride.isLiveSharing && ride.status === "ACTIVE");
    const telemetry = isSharingActive ? liveTelemetryMap.get(params.id) : null;

    return NextResponse.json({
      rideId: ride.id,
      rideStatus: ride.status,
      isLiveSharing: isSharingActive,
      currentLat: isSharingActive ? ride.currentLat : null,
      currentLon: isSharingActive ? ride.currentLon : null,
      locationUpdatedAt: isSharingActive ? ride.locationUpdatedAt : null,
      heading: isSharingActive ? (telemetry?.heading ?? null) : null,
      speed: isSharingActive ? (telemetry?.speed ?? null) : null,
    });
  } catch (error) {
    console.error("Failed to fetch live location:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const ride = await prisma.ride.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        driverId: true,
        status: true,
        currentLat: true,
        currentLon: true,
      },
    });

    if (!ride) {
      return NextResponse.json({ message: "Ride not found" }, { status: 404 });
    }

    // Security Guard: ONLY the authenticated driver who owns this ride can publish location
    if (ride.driverId !== session.user.id) {
      return NextResponse.json(
        { message: "Forbidden: Only the driver of this ride can publish its live location" },
        { status: 403 }
      );
    }

    // Lifecycle Guard: Only ACTIVE rides can publish live location
    if (ride.status !== "ACTIVE") {
      return NextResponse.json(
        { message: "Live location sharing is only permitted during ACTIVE rides" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { latitude, longitude, isSharing, heading, speed } = body;

    if (isSharing === false) {
      liveTelemetryMap.delete(params.id);
      const updated = await prisma.ride.update({
        where: { id: params.id },
        data: {
          isLiveSharing: false,
          currentLat: null,
          currentLon: null,
          locationUpdatedAt: null,
        },
      });
      return NextResponse.json({ success: true, isLiveSharing: updated.isLiveSharing });
    }

    // Strict coordinate validation
    const latNum = typeof latitude === "number" ? latitude : parseFloat(latitude);
    const lonNum = typeof longitude === "number" ? longitude : parseFloat(longitude);

    if (isNaN(latNum) || isNaN(lonNum) || latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
      return NextResponse.json({ message: "Invalid latitude or longitude coordinates" }, { status: 400 });
    }

    // Determine authoritative heading:
    // 1. Device compass / GPS heading (if valid 0-360)
    // 2. Computed bearing from previous coordinate if movement is >= 3 meters
    // 3. Retain previous valid heading if vehicle is stationary (prevents erratic spinning)
    let derivedHeading: number | null = null;
    const parsedHeading = typeof heading === "number" ? heading : parseFloat(heading);
    if (!isNaN(parsedHeading) && parsedHeading >= 0 && parsedHeading <= 360) {
      derivedHeading = parsedHeading;
    } else {
      const prevTelemetry = liveTelemetryMap.get(params.id);
      const baseLat = prevTelemetry?.lastLat ?? ride.currentLat;
      const baseLon = prevTelemetry?.lastLon ?? ride.currentLon;

      if (baseLat != null && baseLon != null) {
        const dLat = Math.abs(latNum - baseLat);
        const dLon = Math.abs(lonNum - baseLon);
        // Approx ~3 meters threshold
        if (dLat > 0.00003 || dLon > 0.00003) {
          derivedHeading = calculateBearing(baseLat, baseLon, latNum, lonNum);
        } else {
          derivedHeading = prevTelemetry?.heading ?? null;
        }
      }
    }

    const now = new Date();
    liveTelemetryMap.set(params.id, {
      heading: derivedHeading,
      speed: typeof speed === "number" && !isNaN(speed) ? speed : null,
      lastLat: latNum,
      lastLon: lonNum,
      updatedAt: now,
    });

    const updated = await prisma.ride.update({
      where: { id: params.id },
      data: {
        currentLat: latNum,
        currentLon: lonNum,
        isLiveSharing: true,
        locationUpdatedAt: now,
      },
    });

    return NextResponse.json({
      success: true,
      isLiveSharing: updated.isLiveSharing,
      currentLat: updated.currentLat,
      currentLon: updated.currentLon,
      locationUpdatedAt: updated.locationUpdatedAt,
      heading: derivedHeading,
    });
  } catch (error) {
    console.error("Failed to update live location:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}



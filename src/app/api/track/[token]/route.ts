import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/track/[token]
 * Public endpoint to fetch live sanitized tracking data for an active trip share.
 * Strictly verifies token validity, revocation status, expiration, and trip lifecycle.
 * Protects passenger privacy by never exposing other riders or sensitive PII.
 */
export async function GET(
  req: Request,
  { params }: { params: { token: string } | Promise<{ token: string }> }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const token = resolvedParams.token?.trim();

    if (!token || typeof token !== "string" || !/^[a-zA-Z0-9_-]{20,80}$/.test(token)) {
      return NextResponse.json({ message: "Invalid tracking token format" }, { status: 400 });
    }

    const shareRecord = await prisma.tripShareToken.findUnique({
      where: { token },
      include: {
        ride: {
          include: {
            driver: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        booking: {
          select: {
            id: true,
            pickupLocation: true,
            pickupLat: true,
            pickupLon: true,
            dropLocation: true,
            dropLat: true,
            dropLon: true,
            status: true,
          },
        },
      },
    });

    if (!shareRecord) {
      return NextResponse.json({ message: "Tracking link not found or expired" }, { status: 404 });
    }

    // Check revocation
    if (shareRecord.isRevoked) {
      return NextResponse.json(
        {
          message: "This trip sharing link has been revoked by the sender.",
          isRevoked: true,
        },
        { status: 410 }
      );
    }

    // Check time expiration
    if (new Date() > shareRecord.expiresAt) {
      return NextResponse.json(
        {
          message: "This tracking link has expired.",
          isExpired: true,
        },
        { status: 410 }
      );
    }

    const ride = shareRecord.ride;

    // Check ride completion or cancellation: automatically terminates live location retrieval
    if (ride.status === "COMPLETED" || ride.status === "CANCELLED") {
      return NextResponse.json(
        {
          message: `This trip has ${ride.status.toLowerCase()}. Live tracking is no longer active.`,
          isFinished: true,
          rideStatus: ride.status,
          senderName: shareRecord.user.name,
          driverName: ride.driver.name,
          vehicleName: ride.vehicleName,
          rideType: ride.rideType,
          origin: ride.origin,
          destination: ride.destination,
        },
        { status: 410 }
      );
    }

    // Staleness & driver offline calculation
    const isLive = Boolean(ride.isLiveSharing && ride.status === "ACTIVE" && ride.currentLat && ride.currentLon);
    const now = Date.now();
    const updateTime = ride.locationUpdatedAt ? new Date(ride.locationUpdatedAt).getTime() : 0;
    const isStale = isLive && (now - updateTime > 90 * 1000); // > 90 seconds without GPS ping

    // Build sanitized, minimum necessary safety payload
    const payload = {
      token: shareRecord.token,
      senderName: shareRecord.user.name,
      driverName: ride.driver.name,
      vehicleName: ride.vehicleName || "Vehicle",
      rideType: ride.rideType,
      rideStatus: ride.status,
      origin: ride.origin,
      originLat: ride.originLat,
      originLon: ride.originLon,
      destination: ride.destination,
      destLat: ride.destLat,
      destLon: ride.destLon,
      routeGeometry: ride.routeGeometry,
      departure: ride.departure,
      currentLat: isLive ? ride.currentLat : null,
      currentLon: isLive ? ride.currentLon : null,
      locationUpdatedAt: isLive ? ride.locationUpdatedAt : null,
      isLiveSharing: isLive,
      isStale,
      driverOffline: !isLive,
      passengerPickup: shareRecord.booking?.pickupLocation
        ? {
            location: shareRecord.booking.pickupLocation,
            lat: shareRecord.booking.pickupLat,
            lon: shareRecord.booking.pickupLon,
          }
        : null,
      passengerDrop: shareRecord.booking?.dropLocation
        ? {
            location: shareRecord.booking.dropLocation,
            lat: shareRecord.booking.dropLat,
            lon: shareRecord.booking.dropLon,
          }
        : null,
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Failed to retrieve tracking data:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

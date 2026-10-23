import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
        status: true,
        distance: true,
        price: true,
        routeGeometry: true,
        routeUpdatedAt: true,
        bookings: {
          where: { status: "CONFIRMED" },
          select: {
            id: true,
            userId: true,
            fare: true,
            pickupLocation: true,
            pickupLat: true,
            pickupLon: true,
            dropLocation: true,
            dropLat: true,
            dropLon: true,
            mainFare: true,
            detourFare: true,
            detourDistance: true,
            fareBreakdown: true,
            user: { select: { name: true } },
          },
        },
      },
    });

    if (!ride) {
      return NextResponse.json({ message: "Ride not found" }, { status: 404 });
    }

    const userBooking = ride.bookings.find((b) => b.userId === session.user.id);
    const confirmedStops = ride.bookings.flatMap((b) => {
      const s = [];
      if (
        typeof b.pickupLat === "number" &&
        typeof b.pickupLon === "number" &&
        !isNaN(b.pickupLat) &&
        !isNaN(b.pickupLon)
      ) {
        s.push({
          id: `${b.id}-pickup`,
          type: "PICKUP" as const,
          bookingId: b.id,
          passengerName: b.user.name,
          locationName: b.pickupLocation || "Pickup",
          lat: b.pickupLat,
          lon: b.pickupLon,
        });
      }
      if (
        typeof b.dropLat === "number" &&
        typeof b.dropLon === "number" &&
        !isNaN(b.dropLat) &&
        !isNaN(b.dropLon)
      ) {
        s.push({
          id: `${b.id}-drop`,
          type: "DROP" as const,
          bookingId: b.id,
          passengerName: b.user.name,
          locationName: b.dropLocation || "Drop-off",
          lat: b.dropLat,
          lon: b.dropLon,
        });
      }
      return s;
    });

    let parsedBreakdown = null;
    if (userBooking?.fareBreakdown) {
      try {
        parsedBreakdown = JSON.parse(userBooking.fareBreakdown);
      } catch {}
    }

    return NextResponse.json(
      {
        status: ride.status,
        routeVersion: ride.routeUpdatedAt ? new Date(ride.routeUpdatedAt).getTime() : 0,
        distance: ride.distance,
        price: ride.price,
        userFare: userBooking?.fare ?? null,
        userMainFare: userBooking?.mainFare ?? null,
        userDetourFare: userBooking?.detourFare ?? null,
        userDetourDistance: userBooking?.detourDistance ?? null,
        userFareBreakdown: parsedBreakdown,
        confirmedCount: ride.bookings.length,
        routeGeometry: ride.routeGeometry,
        stops: confirmedStops,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Failed to fetch ride status:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user;

    if (!user?.id) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (user.userType !== "DRIVER" && user.userType !== "BOTH") {
      return NextResponse.json(
        { message: "Forbidden: Only drivers can update ride status" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { status } = body;

    if (!["ACTIVE", "COMPLETED", "CANCELLED"].includes(status)) {
      return NextResponse.json({ message: "Invalid ride status" }, { status: 400 });
    }

    const ride = await prisma.ride.findUnique({
      where: { id: params.id },
    });

    if (!ride) {
      return NextResponse.json({ message: "Ride not found" }, { status: 404 });
    }

    if (ride.driverId !== user.id) {
      return NextResponse.json(
        { message: "Forbidden: You are not the driver of this ride" },
        { status: 403 }
      );
    }

    const updatedRide = await prisma.ride.update({
      where: { id: params.id },
      data: { status },
    });

    return NextResponse.json(updatedRide, { status: 200 });
  } catch (error) {
    console.error("Failed to update ride status:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

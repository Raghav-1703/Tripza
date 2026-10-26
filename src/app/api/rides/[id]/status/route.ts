import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeBookingPaymentSummary } from "@/lib/payment";

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
        distance: true,
        price: true,
        rideType: true,
        routeGeometry: true,
        routeUpdatedAt: true,
        bookings: {
          where: { status: "CONFIRMED" },
          select: {
            id: true,
            userId: true,
            fare: true,
            previousFare: true,
            fareVersion: true,
            fareUpdatedAt: true,
            fareChangeReason: true,
            status: true,
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
            user: { select: { name: true, phoneNumber: true } },
            payment: {
              select: {
                id: true,
                status: true,
                amount: true,
                amountPaid: true,
                finalFare: true,
                outstandingBalance: true,
                refundAmount: true,
                paymentMethod: true,
                providerOrderId: true,
              },
            },
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

    // Build driver view of all passenger payment statuses
    const passengerPayments = ride.bookings.map((b) => {
      const summary = computeBookingPaymentSummary({
        id: b.id,
        fare: b.fare,
        status: b.status,
        payment: b.payment,
        ride: { status: ride.status, distance: ride.distance, rideType: ride.rideType },
      });
      return {
        bookingId: b.id,
        userId: b.userId,
        passengerName: b.user.name,
        fare: b.fare,
        previousFare: b.previousFare,
        fareVersion: b.fareVersion,
        fareUpdatedAt: b.fareUpdatedAt,
        fareChangeReason: b.fareChangeReason,
        amountPaid: summary.amountPaid,
        outstandingBalance: summary.outstandingBalance,
        refundDue: summary.refundDue,
        refundAmount: b.payment?.refundAmount ?? 0,
        status: summary.status,
        statusLabel: summary.statusLabel,
        paymentMethod: summary.paymentMethod,
        isFullyPaid: summary.isFullyPaid,
      };
    });

    const userPayment = userBooking
      ? computeBookingPaymentSummary({
          id: userBooking.id,
          fare: userBooking.fare,
          status: userBooking.status,
          payment: userBooking.payment,
          ride: { status: ride.status, distance: ride.distance, rideType: ride.rideType },
        })
      : null;

    const totalConfirmedFares = ride.bookings.reduce((sum, b) => sum + (b.fare || 0), 0);

    return NextResponse.json(
      {
        status: ride.status,
        routeVersion: ride.routeUpdatedAt ? new Date(ride.routeUpdatedAt).getTime() : 0,
        distance: ride.distance,
        price: totalConfirmedFares > 0 ? totalConfirmedFares : ride.price,
        totalConfirmedFares,
        userFare: userBooking?.fare ?? null,
        userPreviousFare: userBooking?.previousFare ?? null,
        userFareVersion: userBooking?.fareVersion ?? 1,
        userFareUpdatedAt: userBooking?.fareUpdatedAt ?? null,
        userFareChangeReason: userBooking?.fareChangeReason ?? null,
        userMainFare: userBooking?.mainFare ?? null,
        userDetourFare: userBooking?.detourFare ?? null,
        userDetourDistance: userBooking?.detourDistance ?? null,
        userFareBreakdown: parsedBreakdown,
        userPayment,
        passengerPayments,
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

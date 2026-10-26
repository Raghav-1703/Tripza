import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recalculateRideRouteAndFares } from "@/lib/dynamicRouting";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user;

    if (!user?.id) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { action } = body; // "CONFIRM", "REJECT", "CANCEL"

    if (!["CONFIRM", "REJECT", "CANCEL"].includes(action)) {
      return NextResponse.json({ message: "Invalid action" }, { status: 400 });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: params.id },
      include: { ride: true }
    });

    if (!booking) {
      return NextResponse.json({ message: "Booking not found" }, { status: 404 });
    }

    if (booking.status === "CANCELLED" || booking.status === "REJECTED") {
      return NextResponse.json({ message: "Booking already cancelled/rejected" }, { status: 400 });
    }

    const isDriver = booking.ride.driverId === user.id && (user.userType === "DRIVER" || user.userType === "BOTH");
    const isPassenger = booking.userId === user.id && (user.userType === "PASSENGER" || user.userType === "BOTH");

    if (action === "CONFIRM" || action === "REJECT") {
      if (!isDriver) {
        return NextResponse.json({ message: "Only the authorized driver can confirm or reject" }, { status: 403 });
      }

      if (action === "CONFIRM") {
        const updated = await prisma.booking.update({
          where: { id: booking.id },
          data: { status: "CONFIRMED" }
        });

        // Trigger dynamic rerouting and fare recalculation for all confirmed passengers
        try {
          await recalculateRideRouteAndFares(booking.rideId);
        } catch (rerouteErr) {
          console.error("Rerouting failed on confirmation, preserved existing route/fares:", rerouteErr);
        }

        return NextResponse.json(updated);
      }

      if (action === "REJECT") {
        const wasConfirmed = booking.status === "CONFIRMED";
        const updated = await prisma.$transaction(async (tx) => {
          const b = await tx.booking.update({
            where: { id: booking.id },
            data: { status: "REJECTED" }
          });
          await tx.ride.update({
            where: { id: booking.rideId },
            data: { seats: { increment: 1 } }
          });

          // Concurrency & Refund safety: If booking was paid, transition payment to REFUND_PENDING
          const existingPayment = await tx.payment.findUnique({
            where: { bookingId: booking.id }
          });
          if (existingPayment && existingPayment.status === "SUCCEEDED") {
            await tx.payment.update({
              where: { id: existingPayment.id },
              data: {
                status: "REFUND_PENDING",
                failureReason: "Driver rejected booking after payment"
              }
            });
          }

          return b;
        });

        if (wasConfirmed) {
          try {
            await recalculateRideRouteAndFares(booking.rideId);
          } catch (rerouteErr) {
            console.error("Rerouting failed on rejection, preserved existing route/fares:", rerouteErr);
          }
        }

        return NextResponse.json(updated);
      }
    }

    if (action === "CANCEL") {
      if (!isPassenger) {
        return NextResponse.json({ message: "Only the passenger can cancel" }, { status: 403 });
      }

      const wasConfirmed = booking.status === "CONFIRMED";
      const updated = await prisma.$transaction(async (tx) => {
        const b = await tx.booking.update({
          where: { id: booking.id },
          data: { status: "CANCELLED" }
        });
        await tx.ride.update({
          where: { id: booking.rideId },
          data: { seats: { increment: 1 } }
        });

        // Concurrency & Refund safety: If booking was paid, transition payment to REFUND_PENDING
        const existingPayment = await tx.payment.findUnique({
          where: { bookingId: booking.id }
        });
        if (existingPayment && existingPayment.status === "SUCCEEDED") {
          await tx.payment.update({
            where: { id: existingPayment.id },
            data: {
              status: "REFUND_PENDING",
              failureReason: "Passenger cancelled booking after payment"
            }
          });
        }

        return b;
      });

      if (wasConfirmed) {
        try {
          await recalculateRideRouteAndFares(booking.rideId);
        } catch (rerouteErr) {
          console.error("Rerouting failed on cancellation, preserved existing route/fares:", rerouteErr);
        }
      }

      return NextResponse.json(updated);
    }

    return NextResponse.json({ message: "Bad request" }, { status: 400 });

  } catch (error) {
    console.error("Failed to update booking:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

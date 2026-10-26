import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { processRefund } from "@/lib/payment";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { bookingId, refundAmount, reason } = body;

    if (!bookingId) {
      return NextResponse.json({ message: "Booking ID is required" }, { status: 400 });
    }

    // Verify booking ownership or driver/admin role
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { ride: true, user: true },
    });

    if (!booking) {
      return NextResponse.json({ message: "Booking not found" }, { status: 404 });
    }

    const isPassenger = booking.userId === userId;
    const isDriver = booking.ride.driverId === userId;
    const isAdmin = session.user.role === "ADMIN";

    if (!isPassenger && !isDriver && !isAdmin) {
      return NextResponse.json({ message: "Forbidden: You are not authorized to refund this booking" }, { status: 403 });
    }

    const result = await processRefund({
      bookingId,
      initiatorUserId: userId,
      refundAmount: typeof refundAmount === "number" ? refundAmount : undefined,
      reason: reason || `Refund initiated by ${isAdmin ? "ADMIN" : isDriver ? "DRIVER" : "PASSENGER"}`,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Refund processing failed:", err);
    return NextResponse.json({ message: err.message || "Failed to process refund" }, { status: 400 });
  }
}

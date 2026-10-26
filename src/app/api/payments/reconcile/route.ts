import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { reconcilePaymentStatus } from "@/lib/payment";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { bookingId } = body;

    if (!bookingId) {
      return NextResponse.json({ message: "Booking ID is required" }, { status: 400 });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { ride: true },
    });

    if (!booking) {
      return NextResponse.json({ message: "Booking not found" }, { status: 404 });
    }

    const isPassenger = booking.userId === userId;
    const isDriver = booking.ride.driverId === userId;
    const isAdmin = session.user.role === "ADMIN";

    if (!isPassenger && !isDriver && !isAdmin) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const result = await reconcilePaymentStatus(bookingId);
    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Reconciliation endpoint error:", err);
    return NextResponse.json({ message: err.message || "Failed to reconcile payment" }, { status: 500 });
  }
}

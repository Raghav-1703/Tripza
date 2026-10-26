import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createOrGetPaymentOrder } from "@/lib/payment";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { bookingId, idempotencyKey, paymentMethod } = body;

    if (!bookingId) {
      return NextResponse.json({ message: "Booking ID is required" }, { status: 400 });
    }

    // Generate fallback idempotency key if not provided by client
    const key = idempotencyKey || `idem_${bookingId}_${Date.now()}`;

    const order = await createOrGetPaymentOrder({
      bookingId,
      userId,
      idempotencyKey: key,
      paymentMethod,
    });

    return NextResponse.json({
      success: true,
      order,
      keyId: process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "rzp_test_simulated",
    }, { status: 200 });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Payment order creation failed:", err);
    const msg = err.message || "";
    const isDev = process.env.NODE_ENV !== "production";
    const statusCode = msg.includes("Forbidden")
      ? 403
      : msg.includes("not found")
      ? 404
      : msg.includes("already been paid")
      ? 409
      : 400;

    const safeMessage = isDev
      ? msg || "Payment order creation failed"
      : msg.includes("Forbidden") || msg.includes("not found") || msg.includes("already been paid")
      ? msg
      : "Payment gateway order creation failed. Please try again later.";

    return NextResponse.json({ success: false, message: safeMessage }, { status: statusCode });
  }
}

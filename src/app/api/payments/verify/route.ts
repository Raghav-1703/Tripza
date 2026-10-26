import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { verifyAndConfirmPayment } from "@/lib/payment";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

    if (!bookingId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json(
        { message: "All payment verification fields (bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature) are required" },
        { status: 400 }
      );
    }

    const result = await verifyAndConfirmPayment({
      bookingId,
      userId,
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      razorpaySignature: razorpay_signature,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Payment verification failed:", err);
    const msg = err.message || "";
    const statusCode = msg.includes("Forbidden")
      ? 403
      : msg.includes("not found")
      ? 404
      : msg.includes("Invalid payment signature")
      ? 400
      : 500;

    return NextResponse.json({ success: false, message: msg || "Payment verification failed" }, { status: statusCode });
  }
}

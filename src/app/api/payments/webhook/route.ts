import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { PaymentStatus } from "@prisma/client";

export async function POST(req: Request) {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.warn("RAZORPAY_WEBHOOK_SECRET not configured, ignoring webhook");
      return NextResponse.json({ message: "Webhook secret unconfigured" }, { status: 400 });
    }

    const signature = req.headers.get("x-razorpay-signature");
    if (!signature) {
      return NextResponse.json({ message: "Missing x-razorpay-signature header" }, { status: 400 });
    }

    // 1. Read exact raw request body for cryptographic signature verification
    const rawBody = await req.text();
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");

    if (expectedSignature.length !== signature.length) {
      return NextResponse.json({ message: "Invalid webhook signature" }, { status: 400 });
    }

    const isMatch = crypto.timingSafeEqual(
      Buffer.from(expectedSignature, "utf8"),
      Buffer.from(signature, "utf8")
    );

    if (!isMatch) {
      return NextResponse.json({ message: "Invalid webhook signature" }, { status: 400 });
    }

    // 2. Parse payload safely
    const payload = JSON.parse(rawBody);
    const eventId = req.headers.get("x-razorpay-event-id") || payload.id || `evt_${Date.now()}`;
    const eventType = payload.event;

    // 3. Idempotent webhook deduplication
    const existingEvent = await prisma.webhookEvent.findUnique({
      where: { eventId },
    });

    if (existingEvent) {
      return NextResponse.json({ status: "already_processed" }, { status: 200 });
    }

    // Log the incoming event
    await prisma.webhookEvent.create({
      data: {
        eventId,
        provider: "RAZORPAY",
        eventType,
        payload: rawBody,
        processed: false,
      },
    });

    // 4. Handle event types idempotently
    if (eventType === "payment.captured" || eventType === "order.paid") {
      const paymentEntity = payload.payload?.payment?.entity;
      const orderId = paymentEntity?.order_id || payload.payload?.order?.entity?.id;
      const paymentId = paymentEntity?.id;

      if (orderId) {
        const payment = await prisma.payment.findUnique({
          where: { providerOrderId: orderId },
          include: { booking: true },
        });

        if (payment && payment.status !== PaymentStatus.SUCCEEDED && payment.status !== PaymentStatus.REFUNDED) {
          // Check for concurrent cancellation
          if (payment.booking.status === "CANCELLED" || payment.booking.status === "REJECTED") {
            await prisma.$transaction([
              prisma.payment.update({
                where: { id: payment.id },
                data: {
                  status: PaymentStatus.REFUND_PENDING,
                  providerPaymentId: paymentId || payment.providerPaymentId,
                  failureReason: `Booking was ${payment.booking.status} concurrently (caught by webhook)`,
                },
              }),
              prisma.paymentAudit.create({
                data: {
                  paymentId: payment.id,
                  bookingId: payment.bookingId,
                  action: "WEBHOOK_CONCURRENT_CANCEL_REFUND_QUEUED",
                  fromStatus: payment.status,
                  toStatus: PaymentStatus.REFUND_PENDING,
                  amount: payment.amount,
                  source: "WEBHOOK",
                  metadata: JSON.stringify({ eventId, eventType, paymentId }),
                },
              }),
              prisma.webhookEvent.update({
                where: { eventId },
                data: { processed: true, processedAt: new Date() },
              }),
            ]);
          } else {
            // Normal capture
            await prisma.$transaction([
              prisma.payment.update({
                where: { id: payment.id },
                data: {
                  status: PaymentStatus.SUCCEEDED,
                  providerPaymentId: paymentId || payment.providerPaymentId,
                },
              }),
              prisma.booking.update({
                where: { id: payment.bookingId },
                data: { status: "CONFIRMED" },
              }),
              prisma.paymentAudit.create({
                data: {
                  paymentId: payment.id,
                  bookingId: payment.bookingId,
                  action: "WEBHOOK_PAYMENT_CAPTURED",
                  fromStatus: payment.status,
                  toStatus: PaymentStatus.SUCCEEDED,
                  amount: payment.amount,
                  source: "WEBHOOK",
                  metadata: JSON.stringify({ eventId, eventType, paymentId }),
                },
              }),
              prisma.webhookEvent.update({
                where: { eventId },
                data: { processed: true, processedAt: new Date() },
              }),
            ]);
          }
        }
      }
    } else if (eventType === "refund.processed") {
      const refundEntity = payload.payload?.refund?.entity;
      const paymentId = refundEntity?.payment_id;
      const refundId = refundEntity?.id;
      const refundAmount = refundEntity?.amount ? refundEntity.amount / 100 : undefined;

      if (paymentId) {
        const payment = await prisma.payment.findUnique({
          where: { providerPaymentId: paymentId },
        });

        if (payment && payment.status !== PaymentStatus.REFUNDED) {
          await prisma.$transaction([
            prisma.payment.update({
              where: { id: payment.id },
              data: {
                status: PaymentStatus.REFUNDED,
                refundId: refundId || payment.refundId,
                refundAmount: refundAmount || payment.refundAmount || payment.amount,
              },
            }),
            prisma.paymentAudit.create({
              data: {
                paymentId: payment.id,
                bookingId: payment.bookingId,
                action: "WEBHOOK_REFUND_PROCESSED",
                fromStatus: payment.status,
                toStatus: PaymentStatus.REFUNDED,
                amount: refundAmount || payment.amount,
                source: "WEBHOOK",
                metadata: JSON.stringify({ eventId, refundId }),
              },
            }),
            prisma.webhookEvent.update({
              where: { eventId },
              data: { processed: true, processedAt: new Date() },
            }),
          ]);
        }
      }
    } else if (eventType === "payment.failed") {
      const paymentEntity = payload.payload?.payment?.entity;
      const orderId = paymentEntity?.order_id;
      const errorDesc = paymentEntity?.error_description || "Payment failed at gateway";

      if (orderId) {
        const payment = await prisma.payment.findUnique({
          where: { providerOrderId: orderId },
        });

        if (payment && payment.status === PaymentStatus.PENDING) {
          await prisma.$transaction([
            prisma.payment.update({
              where: { id: payment.id },
              data: {
                status: PaymentStatus.FAILED,
                failureReason: errorDesc,
              },
            }),
            prisma.paymentAudit.create({
              data: {
                paymentId: payment.id,
                bookingId: payment.bookingId,
                action: "WEBHOOK_PAYMENT_FAILED",
                fromStatus: payment.status,
                toStatus: PaymentStatus.FAILED,
                source: "WEBHOOK",
                reason: errorDesc,
                metadata: JSON.stringify({ eventId }),
              },
            }),
            prisma.webhookEvent.update({
              where: { eventId },
              data: { processed: true, processedAt: new Date() },
            }),
          ]);
        }
      }
    }

    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (error) {
    console.error("Webhook processing failed:", error);
    return NextResponse.json({ message: "Webhook handler error" }, { status: 500 });
  }
}

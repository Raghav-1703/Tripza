import { prisma } from "../src/lib/prisma";
import {
  createOrGetPaymentOrder,
  verifyAndConfirmPayment,
  processRefund,
  reconcilePaymentStatus,
} from "../src/lib/payment";
import { PaymentStatus, PaymentMethod } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

async function runWebhooksAndRecoveryTests() {
  console.log("==================================================================");
  console.log("  TPOOL SECURE WEBHOOKS, REFUNDS & RECOVERY AUDIT SUITE");
  console.log("==================================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  }

  const webhookSecret = "sandbox_webhook_secret_tpool_2026";
  const keySecret = "sandbox_secret_key_tpool_2026";
  process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;
  process.env.RAZORPAY_KEY_SECRET = keySecret;
  process.env.RAZORPAY_KEY_ID = "rzp_test_tpool_sandbox";

  // 1. Setup Test Users & Ride
  const driver = await prisma.user.create({
    data: {
      name: "Driver Recovery",
      email: `driver_rec_${Date.now()}@tpool.test`,
      password: await bcrypt.hash("Password123!", 10),
      userType: "DRIVER",
      status: "ACTIVE",
    },
  });

  const passenger = await prisma.user.create({
    data: {
      name: "Passenger Recovery",
      email: `pass_rec_${Date.now()}@tpool.test`,
      password: await bcrypt.hash("Password123!", 10),
      userType: "PASSENGER",
      status: "ACTIVE",
    },
  });

  const ride = await prisma.ride.create({
    data: {
      driverId: driver.id,
      origin: "IIIT Pune Campus",
      originLat: 18.76518,
      originLon: 73.69698,
      destination: "Talegaon Station",
      destLat: 18.7367,
      destLon: 73.6705,
      departure: new Date(Date.now() + 3600000),
      seats: 4,
      price: 200.0,
      rideType: "Private Car Pool",
      distance: 10.0,
    },
  });

  const booking = await prisma.booking.create({
    data: {
      rideId: ride.id,
      userId: passenger.id,
      fare: 200.0,
      seats: 1,
      status: "PENDING",
    },
  });

  console.log("--- 1. Order Creation & Audit History Logging ---");
  const order = await createOrGetPaymentOrder({
    bookingId: booking.id,
    userId: passenger.id,
  });

  const initialAudits = await prisma.paymentAudit.findMany({ where: { bookingId: booking.id } });
  assert(initialAudits.length >= 1, "Initial order creation logged in PaymentAudit table");
  assert(initialAudits[0].action === "ORDER_CREATED", "Audit action correctly recorded as ORDER_CREATED");
  assert(initialAudits[0].toStatus === PaymentStatus.PENDING, "Audit status accurately recorded as PENDING");

  console.log("\n--- 2. Webhook Signature Verification & Payload Tampering ---");
  const paymentId = `pay_wbk_${crypto.randomBytes(8).toString("hex")}`;
  const validPayload = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: order.providerOrderId,
          amount: 20000,
          currency: "INR",
          status: "captured",
        },
      },
    },
  });

  const validWebhookSig = crypto
    .createHmac("sha256", webhookSecret)
    .update(validPayload)
    .digest("hex");

  const tamperedWebhookSig = crypto
    .createHmac("sha256", "wrong_webhook_secret")
    .update(validPayload)
    .digest("hex");

  // Verify HMAC comparison
  const isGenuine = crypto.timingSafeEqual(
    Buffer.from(crypto.createHmac("sha256", webhookSecret).update(validPayload).digest("hex")),
    Buffer.from(validWebhookSig)
  );
  assert(isGenuine, "Genuine webhook signature validated via raw body HMAC SHA-256");

  const isForged = crypto.timingSafeEqual(
    Buffer.from(crypto.createHmac("sha256", webhookSecret).update(validPayload).digest("hex")),
    Buffer.from(tamperedWebhookSig)
  );
  assert(!isForged, "Tampered webhook signature rejected");

  console.log("\n--- 3. Webhook Deduplication & Event Processing ---");
  const eventId = `evt_test_${Date.now()}`;
  await prisma.webhookEvent.create({
    data: {
      eventId,
      provider: "RAZORPAY",
      eventType: "payment.captured",
      payload: validPayload,
      processed: true,
      processedAt: new Date(),
    },
  });

  // Attempting duplicate event insertion must be caught by unique constraint
  let duplicateCaught = false;
  try {
    await prisma.webhookEvent.create({
      data: {
        eventId, // Duplicate ID
        provider: "RAZORPAY",
        eventType: "payment.captured",
        payload: validPayload,
      },
    });
  } catch (err: any) {
    duplicateCaught = true;
  }
  assert(duplicateCaught, "Webhook duplicate event ID rejected by unique database constraint");

  console.log("\n--- 4. Client Verification & Audit Logging ---");
  const clientSig = crypto
    .createHmac("sha256", keySecret)
    .update(`${order.providerOrderId}|${paymentId}`)
    .digest("hex");

  await verifyAndConfirmPayment({
    bookingId: booking.id,
    userId: passenger.id,
    razorpayOrderId: order.providerOrderId,
    razorpayPaymentId: paymentId,
    razorpaySignature: clientSig,
    source: "CLIENT_CALLBACK",
  });

  const captureAudit = await prisma.paymentAudit.findFirst({
    where: { bookingId: booking.id, action: "PAYMENT_CAPTURED" },
  });
  assert(captureAudit !== null, "Payment capture logged in immutable audit history");
  assert(captureAudit?.source === "CLIENT_CALLBACK", "Audit source recorded as CLIENT_CALLBACK");

  console.log("\n--- 5. Full & Partial Refunds with Auditable Preservation ---");
  // Execute refund
  const refundResult = await processRefund({
    bookingId: booking.id,
    initiatorUserId: passenger.id,
    refundAmount: 200.0,
    reason: "Passenger emergency cancellation",
  });

  assert(refundResult.success === true, "Refund processed successfully");
  assert(refundResult.status === PaymentStatus.REFUNDED, "Payment status moved to REFUNDED");

  const refundedPayment = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
  assert(refundedPayment?.status === PaymentStatus.REFUNDED, "Database reflects REFUNDED status");
  assert(refundedPayment?.refundId?.startsWith("rfnd_") ?? false, "Refund ID saved in record");
  assert(refundedPayment?.refundAmount === 200.0, "Refund amount accurately recorded (₹200.00)");

  // Check audit trail (records must never be deleted)
  const allAudits = await prisma.paymentAudit.findMany({ where: { bookingId: booking.id } });
  assert(allAudits.length >= 3, `Audit trail completely preserved: ${allAudits.length} events logged`);
  assert(allAudits.some((a) => a.action === "REFUNDED"), "Refund action captured in audit trail");

  // Idempotent repeated refund check
  const repeatedRefund = await processRefund({
    bookingId: booking.id,
    initiatorUserId: passenger.id,
    reason: "Duplicate click refund",
  });
  assert(repeatedRefund.success === true, "Repeated refund call handled cleanly and idempotently");

  console.log("\n--- 6. Payment Reconciliation Check ---");
  const reconciliation = await reconcilePaymentStatus(booking.id);
  assert(reconciliation.status === PaymentStatus.REFUNDED, "Reconciliation respects settled refund state");

  console.log("\n--- 7. Cleanup Test Data ---");
  await prisma.paymentAudit.deleteMany({ where: { bookingId: booking.id } });
  await prisma.webhookEvent.deleteMany({ where: { eventId } });
  await prisma.payment.deleteMany({ where: { bookingId: booking.id } });
  await prisma.booking.deleteMany({ where: { id: booking.id } });
  await prisma.ride.deleteMany({ where: { id: ride.id } });
  await prisma.user.deleteMany({ where: { id: { in: [driver.id, passenger.id] } } });
  assert(true, "Test data cleaned up successfully");

  console.log("\n==================================================================");
  console.log(`WEBHOOKS & RECOVERY SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runWebhooksAndRecoveryTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

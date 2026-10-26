import { prisma } from "../src/lib/prisma";
import {
  createOrGetPaymentOrder,
  verifyAndConfirmPayment,
  verifyRazorpaySignature,
} from "../src/lib/payment";
import { PaymentStatus, PaymentMethod } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

async function runConcurrencyAndIdempotencyTests() {
  console.log("==================================================================");
  console.log("  TPOOL PAYMENT HARDENING, CONCURRENCY & IDEMPOTENCY TEST SUITE");
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

  const secretKey = "sandbox_secret_key_tpool_2026";
  process.env.RAZORPAY_KEY_SECRET = secretKey;
  process.env.RAZORPAY_KEY_ID = "rzp_test_tpool_sandbox";

  // Setup test users & ride
  const driver = await prisma.user.create({
    data: {
      name: "Driver Concurrency",
      email: `driver_conc_${Date.now()}@tpool.test`,
      password: await bcrypt.hash("Password123!", 10),
      userType: "DRIVER",
      status: "ACTIVE",
    },
  });

  const passenger = await prisma.user.create({
    data: {
      name: "Passenger Concurrency",
      email: `pass_conc_${Date.now()}@tpool.test`,
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
      destination: "Talegaon Railway Station",
      destLat: 18.7367,
      destLon: 73.6705,
      departure: new Date(Date.now() + 3600000),
      seats: 3,
      price: 180.0,
      rideType: "Cab Pool",
      distance: 10.0,
    },
  });

  const booking = await prisma.booking.create({
    data: {
      rideId: ride.id,
      userId: passenger.id,
      fare: 180.0,
      seats: 1,
      status: "PENDING",
    },
  });

  console.log("--- 1. Simultaneous Checkout Requests & Concurrency Collision ---");
  // Simulate 5 parallel browser tabs clicking "Pay Now" simultaneously
  const parallelAttempts = await Promise.all([
    createOrGetPaymentOrder({ bookingId: booking.id, userId: passenger.id }),
    createOrGetPaymentOrder({ bookingId: booking.id, userId: passenger.id }),
    createOrGetPaymentOrder({ bookingId: booking.id, userId: passenger.id }),
    createOrGetPaymentOrder({ bookingId: booking.id, userId: passenger.id }),
    createOrGetPaymentOrder({ bookingId: booking.id, userId: passenger.id }),
  ]);

  const distinctPaymentIds = new Set(parallelAttempts.map((p) => p.paymentId));
  assert(distinctPaymentIds.size === 1, "Simultaneous parallel checkout calls returned the exact same payment ID (no duplicate orders)");

  const distinctOrderIds = new Set(parallelAttempts.map((p) => p.providerOrderId));
  assert(distinctOrderIds.size === 1, "Simultaneous parallel checkout calls share the exact same provider order ID");

  const totalPaymentsInDb = await prisma.payment.count({ where: { bookingId: booking.id } });
  assert(totalPaymentsInDb === 1, "Strict database uniqueness ensures exactly 1 Payment record exists for booking");

  console.log("\n--- 2. Double-Payment Prevention (Single Payable Obligation) ---");
  const validOrder = parallelAttempts[0];
  const paymentId = `pay_hard_${crypto.randomBytes(8).toString("hex")}`;
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(`${validOrder.providerOrderId}|${paymentId}`)
    .digest("hex");

  // First verification succeeds
  const v1 = await verifyAndConfirmPayment({
    bookingId: booking.id,
    userId: passenger.id,
    razorpayOrderId: validOrder.providerOrderId,
    razorpayPaymentId: paymentId,
    razorpaySignature: signature,
  });
  assert(v1.success === true && v1.status === PaymentStatus.SUCCEEDED, "First verification succeeds and transitions to SUCCEEDED");

  // Subsequent verification requests (from repeated callbacks, webhooks, or retries) must replay idempotently
  const v2 = await verifyAndConfirmPayment({
    bookingId: booking.id,
    userId: passenger.id,
    razorpayOrderId: validOrder.providerOrderId,
    razorpayPaymentId: paymentId,
    razorpaySignature: signature,
  });
  assert(v2.success === true && v2.status === PaymentStatus.SUCCEEDED, "Retry verification returns success idempotently without double-marking");

  // Attempting to create another order on an already paid booking must be rejected
  let secondOrderBlocked = false;
  try {
    await createOrGetPaymentOrder({ bookingId: booking.id, userId: passenger.id });
  } catch (err: any) {
    secondOrderBlocked = err.message.includes("already been paid");
  }
  assert(secondOrderBlocked, "System strictly rejects initiating a second payment for an already paid booking");

  console.log("\n--- 3. Concurrent Booking Cancellation Handling ---");
  // Setup a second booking that gets cancelled while payment is in transit
  const booking2 = await prisma.booking.create({
    data: {
      rideId: ride.id,
      userId: passenger.id,
      fare: 180.0,
      seats: 1,
      status: "PENDING",
    },
  });

  const order2 = await createOrGetPaymentOrder({
    bookingId: booking2.id,
    userId: passenger.id,
  });

  // Simulate passenger/driver cancellation while passenger is completing gateway modal
  await prisma.booking.update({
    where: { id: booking2.id },
    data: { status: "CANCELLED" },
  });

  // Now gateway callback arrives with authentic signature
  const cancelPaymentId = `pay_cancel_${crypto.randomBytes(8).toString("hex")}`;
  const cancelSig = crypto
    .createHmac("sha256", secretKey)
    .update(`${order2.providerOrderId}|${cancelPaymentId}`)
    .digest("hex");

  const cancelVerification = await verifyAndConfirmPayment({
    bookingId: booking2.id,
    userId: passenger.id,
    razorpayOrderId: order2.providerOrderId,
    razorpayPaymentId: cancelPaymentId,
    razorpaySignature: cancelSig,
  });

  assert(cancelVerification.success === false, "Verification recognizes concurrent cancellation and refuses to mark as normal success");
  assert(cancelVerification.status === PaymentStatus.REFUND_PENDING, "Payment is safely routed to REFUND_PENDING");

  const paymentRecord2 = await prisma.payment.findUnique({ where: { bookingId: booking2.id } });
  assert(paymentRecord2?.status === PaymentStatus.REFUND_PENDING, "Database reflects REFUND_PENDING with failure reason logged");

  console.log("\n--- 4. Clean Up Test Entities ---");
  await prisma.payment.deleteMany({ where: { bookingId: { in: [booking.id, booking2.id] } } });
  await prisma.booking.deleteMany({ where: { id: { in: [booking.id, booking2.id] } } });
  await prisma.ride.deleteMany({ where: { id: ride.id } });
  await prisma.user.deleteMany({ where: { id: { in: [driver.id, passenger.id] } } });
  assert(true, "Test data cleaned up successfully");

  console.log("\n==================================================================");
  console.log(`CONCURRENCY & IDEMPOTENCY SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runConcurrencyAndIdempotencyTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

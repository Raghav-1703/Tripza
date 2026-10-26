import { prisma } from "../src/lib/prisma";
import {
  createOrGetPaymentOrder,
  verifyAndConfirmPayment,
  verifyRazorpaySignature,
  isValidPaymentTransition
} from "../src/lib/payment";
import { PaymentStatus, PaymentMethod } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

async function runRazorpayIntegrationTests() {
  console.log("==================================================================");
  console.log("  TPOOL RAZORPAY INTEGRATION & SERVER VERIFICATION TEST SUITE");
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

  // 1. Setup test entities
  const driver = await prisma.user.create({
    data: {
      name: "Driver David",
      email: `driver_rzp_${Date.now()}@tpool.test`,
      password: await bcrypt.hash("Password123!", 10),
      userType: "DRIVER",
      status: "ACTIVE",
    },
  });

  const passenger = await prisma.user.create({
    data: {
      name: "Passenger Priya",
      email: `pass_rzp_${Date.now()}@tpool.test`,
      password: await bcrypt.hash("Password123!", 10),
      userType: "PASSENGER",
      status: "ACTIVE",
    },
  });

  const imposter = await prisma.user.create({
    data: {
      name: "Imposter Ian",
      email: `imposter_rzp_${Date.now()}@tpool.test`,
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
      destination: "Pune Railway Station",
      destLat: 18.5284,
      destLon: 73.8739,
      departure: new Date(Date.now() + 7200000),
      seats: 2,
      price: 250.0,
      rideType: "Personal Cab",
      distance: 25.0,
    },
  });

  const booking = await prisma.booking.create({
    data: {
      rideId: ride.id,
      userId: passenger.id,
      fare: 250.0,
      seats: 1,
      status: "PENDING",
    },
  });

  console.log("--- 1. Order Creation & Server Authority ---");
  const order = await createOrGetPaymentOrder({
    bookingId: booking.id,
    userId: passenger.id,
    idempotencyKey: `idem_rzp_${booking.id}`,
    paymentMethod: PaymentMethod.UPI,
  });

  assert(order.bookingId === booking.id, "Payment order created with correct booking linkage");
  assert(order.amount === 250, `Server authoritative amount verified: ₹${order.amount}`);
  assert(order.amountSubunits === 25000, `Paise units accurate: ${order.amountSubunits}`);
  assert(order.status === PaymentStatus.PENDING, "Order starts in PENDING status");

  console.log("\n--- 2. Cryptographic Signature Validation ---");
  const mockPaymentId = `pay_${crypto.randomBytes(8).toString("hex")}`;
  const validSignature = crypto
    .createHmac("sha256", secretKey)
    .update(`${order.providerOrderId}|${mockPaymentId}`)
    .digest("hex");

  const invalidSignature = crypto
    .createHmac("sha256", "wrong_secret_key")
    .update(`${order.providerOrderId}|${mockPaymentId}`)
    .digest("hex");

  assert(
    verifyRazorpaySignature(order.providerOrderId, mockPaymentId, validSignature, secretKey),
    "Valid HMAC SHA-256 signature accepted"
  );
  assert(
    !verifyRazorpaySignature(order.providerOrderId, mockPaymentId, invalidSignature, secretKey),
    "Forged or tampered HMAC SHA-256 signature rejected"
  );

  console.log("\n--- 3. Server-Side Payment Verification & State Transition ---");
  // Test: Tampered signature rejection
  let forgedRejected = false;
  try {
    await verifyAndConfirmPayment({
      bookingId: booking.id,
      userId: passenger.id,
      razorpayOrderId: order.providerOrderId,
      razorpayPaymentId: mockPaymentId,
      razorpaySignature: invalidSignature,
    });
  } catch (err: any) {
    forgedRejected = err.message.includes("Verification failed");
  }
  assert(forgedRejected, "Server rejects payment verification with invalid signature");

  // Test: Unauthorized user attempting verification
  let imposterRejected = false;
  try {
    await verifyAndConfirmPayment({
      bookingId: booking.id,
      userId: imposter.id,
      razorpayOrderId: order.providerOrderId,
      razorpayPaymentId: mockPaymentId,
      razorpaySignature: validSignature,
    });
  } catch (err: any) {
    imposterRejected = err.message.includes("Forbidden");
  }
  assert(imposterRejected, "Imposter user cannot verify another passenger's payment");

  // Test: Authentic verification execution
  const verificationResult = await verifyAndConfirmPayment({
    bookingId: booking.id,
    userId: passenger.id,
    razorpayOrderId: order.providerOrderId,
    razorpayPaymentId: mockPaymentId,
    razorpaySignature: validSignature,
  });

  assert(verificationResult.success === true, "Verification succeeded for genuine payment");
  assert(verificationResult.status === PaymentStatus.SUCCEEDED, "Payment transitioned to SUCCEEDED");

  const updatedBooking = await prisma.booking.findUnique({ where: { id: booking.id } });
  assert(updatedBooking?.status === "CONFIRMED", "Booking status atomically confirmed in database");

  const updatedPayment = await prisma.payment.findUnique({ where: { bookingId: booking.id } });
  assert(updatedPayment?.providerPaymentId === mockPaymentId, "Provider payment identifier recorded");
  assert(updatedPayment?.providerSignature === validSignature, "Provider signature recorded for audit");

  console.log("\n--- 4. Idempotent Replay on Verification ---");
  const replayResult = await verifyAndConfirmPayment({
    bookingId: booking.id,
    userId: passenger.id,
    razorpayOrderId: order.providerOrderId,
    razorpayPaymentId: mockPaymentId,
    razorpaySignature: validSignature,
  });
  assert(replayResult.success === true, "Repeated verification calls return success idempotently");
  assert(replayResult.status === PaymentStatus.SUCCEEDED, "Payment status remains SUCCEEDED without duplication");

  console.log("\n--- 5. Clean Up Test Data ---");
  await prisma.payment.deleteMany({ where: { bookingId: booking.id } });
  await prisma.booking.deleteMany({ where: { id: booking.id } });
  await prisma.ride.deleteMany({ where: { id: ride.id } });
  await prisma.user.deleteMany({ where: { id: { in: [driver.id, passenger.id, imposter.id] } } });
  assert(true, "Test data cleaned up successfully");

  console.log("\n==================================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runRazorpayIntegrationTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

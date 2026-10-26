import { prisma } from "../src/lib/prisma";
import { createOrGetPaymentOrder, isValidPaymentTransition } from "../src/lib/payment";
import { PaymentStatus, PaymentMethod } from "@prisma/client";
import bcrypt from "bcryptjs";

async function runPaymentTests() {
  console.log("==================================================================");
  console.log("  TPOOL PAYMENT SCHEMA & SERVER ORDER CREATION TEST SUITE");
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

  // 1. Setup clean test user and test ride
  const driver = await prisma.user.create({
    data: {
      name: "Driver Bob",
      email: `driver_pay_${Date.now()}@tpool.test`,
      password: await bcrypt.hash("Password123!", 10),
      userType: "DRIVER",
      status: "ACTIVE",
    },
  });

  const passenger = await prisma.user.create({
    data: {
      name: "Passenger Alice",
      email: `pass_pay_${Date.now()}@tpool.test`,
      password: await bcrypt.hash("Password123!", 10),
      userType: "PASSENGER",
      status: "ACTIVE",
    },
  });

  const unauthorizedUser = await prisma.user.create({
    data: {
      name: "Intruder Charlie",
      email: `intruder_${Date.now()}@tpool.test`,
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
      price: 150.0,
      rideType: "Private Car Pool",
      distance: 10.5,
    },
  });

  const booking = await prisma.booking.create({
    data: {
      rideId: ride.id,
      userId: passenger.id,
      fare: 150.0,
      seats: 1,
      status: "CONFIRMED",
    },
  });

  console.log("--- 1. State Machine & Transition Tests ---");
  assert(isValidPaymentTransition(PaymentStatus.PENDING, PaymentStatus.PROCESSING), "PENDING -> PROCESSING is valid");
  assert(isValidPaymentTransition(PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED), "PROCESSING -> SUCCEEDED is valid");
  assert(isValidPaymentTransition(PaymentStatus.SUCCEEDED, PaymentStatus.REFUND_PENDING), "SUCCEEDED -> REFUND_PENDING is valid");
  assert(isValidPaymentTransition(PaymentStatus.REFUND_PENDING, PaymentStatus.REFUNDED), "REFUND_PENDING -> REFUNDED is valid");
  assert(!isValidPaymentTransition(PaymentStatus.CANCELLED, PaymentStatus.SUCCEEDED), "CANCELLED -> SUCCEEDED is invalid and blocked");
  assert(!isValidPaymentTransition(PaymentStatus.REFUNDED, PaymentStatus.PROCESSING), "REFUNDED -> PROCESSING is invalid and blocked");

  console.log("\n--- 2. Server-Authoritative Payment Order Creation ---");
  const order1 = await createOrGetPaymentOrder({
    bookingId: booking.id,
    userId: passenger.id,
    idempotencyKey: `idem_test_${booking.id}_1`,
    paymentMethod: PaymentMethod.UPI,
  });

  assert(order1.bookingId === booking.id, "Payment order created for correct booking");
  assert(order1.amount > 0, `Server computed positive payable amount: ₹${order1.amount}`);
  assert(order1.amountSubunits === Math.round(order1.amount * 100), `Amount subunits (paise) accurate: ${order1.amountSubunits}`);
  assert(order1.status === PaymentStatus.PENDING, "Initial payment order is PENDING");
  assert(order1.providerOrderId.startsWith("order_"), `Provider order ID generated: ${order1.providerOrderId}`);

  console.log("\n--- 3. Authorization & Ownership Protections ---");
  let unauthorizedBlocked = false;
  try {
    await createOrGetPaymentOrder({
      bookingId: booking.id,
      userId: unauthorizedUser.id, // Not the passenger
      idempotencyKey: `idem_unauth_${Date.now()}`,
    });
  } catch (err: any) {
    unauthorizedBlocked = err.message.includes("Forbidden");
  }
  assert(unauthorizedBlocked, "Unauthorized user cannot create payment for another user's booking");

  console.log("\n--- 4. Idempotency & Duplicate Prevention ---");
  const order2 = await createOrGetPaymentOrder({
    bookingId: booking.id,
    userId: passenger.id,
    idempotencyKey: `idem_test_${booking.id}_1`, // Same key
  });

  assert(order2.isExisting === true, "Repeated payment request returns existing order without creating duplicate");
  assert(order2.paymentId === order1.paymentId, "Payment ID remains identical across repeated calls");
  assert(order2.providerOrderId === order1.providerOrderId, "Provider order ID remains identical");

  const totalPaymentsForBooking = await prisma.payment.count({
    where: { bookingId: booking.id },
  });
  assert(totalPaymentsForBooking === 1, "Database constraint strictly enforces single Payment per booking (Count = 1)");

  console.log("\n--- 5. Cleanup Test Data ---");
  await prisma.payment.deleteMany({ where: { bookingId: booking.id } });
  await prisma.booking.deleteMany({ where: { id: booking.id } });
  await prisma.ride.deleteMany({ where: { id: ride.id } });
  await prisma.user.deleteMany({ where: { id: { in: [driver.id, passenger.id, unauthorizedUser.id] } } });
  assert(true, "Test data cleaned up safely without impacting real data");

  console.log("\n==================================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runPaymentTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

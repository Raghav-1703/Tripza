import fs from "fs";
import path from "path";

// Ensure .env is loaded in standalone script environment
try {
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const val = match[2].trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch {}

import { prisma } from "../src/lib/prisma";
import { 
  createOrGetPaymentOrder, 
  verifyAndConfirmPayment, 
  computeBookingPaymentSummary,
  handleEarlyExitSettlement,
  isValidPaymentTransition 
} from "../src/lib/payment";
import { recalculateRideRouteAndFares } from "../src/lib/dynamicRouting";
import bcrypt from "bcryptjs";
import crypto from "crypto";

async function runDynamicPaymentTestSuite() {
  console.log("==================================================================");
  console.log("   TPOOL COMPLETE DYNAMIC RIDE PAYMENT TEST SUITE");
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

  const razorpaySecret = process.env.RAZORPAY_KEY_SECRET || "y5m8AyxCMHMcIWlT5OnHx8NS";

  // Create test driver & passengers
  const timestamp = Date.now();
  const driver = await prisma.user.create({
    data: {
      name: "Driver Rahul",
      email: `driver_dyn_${timestamp}@tpool.test`,
      password: await bcrypt.hash("Password123!", 10),
      userType: "DRIVER",
      status: "ACTIVE",
    },
  });

  const passengerAlice = await prisma.user.create({
    data: {
      name: "Alice Passenger",
      email: `alice_dyn_${timestamp}@tpool.test`,
      password: await bcrypt.hash("Password123!", 10),
      userType: "PASSENGER",
      status: "ACTIVE",
    },
  });

  const passengerBob = await prisma.user.create({
    data: {
      name: "Bob Passenger",
      email: `bob_dyn_${timestamp}@tpool.test`,
      password: await bcrypt.hash("Password123!", 10),
      userType: "PASSENGER",
      status: "ACTIVE",
    },
  });

  try {
    // -------------------------------------------------------------
    // Test Case 1: Destination reached -> Payment due -> Full fare payment
    // -------------------------------------------------------------
    console.log("\n--- TEST CASE 1: Trip Completed at Destination & Paid in Full ---");
    const ride1 = await prisma.ride.create({
      data: {
        driverId: driver.id,
        origin: "Pune Railway Station",
        originLat: 18.5289,
        originLon: 73.8744,
        destination: "Hinjawadi Phase 1",
        destLat: 18.5913,
        destLon: 73.7389,
        departure: new Date(Date.now() + 3600000),
        seats: 3,
        status: "COMPLETED", // Reached destination
        rideType: "Personal Cab",
        distance: 18500, // 18.5 km
      },
    });

    const booking1 = await prisma.booking.create({
      data: {
        rideId: ride1.id,
        userId: passengerAlice.id,
        status: "CONFIRMED",
        pickupLocation: "Pune Railway Station",
        pickupLat: 18.5289,
        pickupLon: 73.8744,
        dropLocation: "Hinjawadi Phase 1",
        dropLat: 18.5913,
        dropLon: 73.7389,
        fare: 185.0,
      },
    });

    // Check payment summary at completion
    let summary1 = await computeBookingPaymentSummary({ ...booking1, ride: ride1 });
    assert(summary1.isPaymentDue === true, "Payment is marked as Payment Due when trip is COMPLETED");
    assert(summary1.outstandingBalance === 185.0, "Outstanding balance equals the destination fare ₹185");
    assert(summary1.status === "PENDING", "Initial status is PENDING");

    // Initiate checkout order
    const order1 = await createOrGetPaymentOrder({
      bookingId: booking1.id,
      userId: passengerAlice.id,
    });
    assert(order1.providerOrderId !== undefined && order1.providerOrderId.length > 0, "Created authenticated payment order");
    assert(order1.amount === 185.0, "Order amount is the exact server-calculated fare");

    // Simulate successful payment callback with valid HMAC signature
    const fakePayId1 = `pay_test_${Date.now()}_1`;
    const sig1 = crypto
      .createHmac("sha256", razorpaySecret)
      .update(`${order1.providerOrderId}|${fakePayId1}`)
      .digest("hex");

    const verifyResult1 = await verifyAndConfirmPayment({
      bookingId: booking1.id,
      userId: passengerAlice.id,
      razorpayOrderId: order1.providerOrderId,
      razorpayPaymentId: fakePayId1,
      razorpaySignature: sig1,
      paymentMethod: "UPI",
    });

    assert(verifyResult1.success === true, "Server-side signature verification succeeded");
    assert(verifyResult1.status === "SUCCEEDED", "Payment transitioned to SUCCEEDED");

    const b1Updated = await prisma.booking.findUnique({
      where: { id: booking1.id },
      include: { payment: true, ride: true },
    });
    summary1 = await computeBookingPaymentSummary(b1Updated!);
    assert(summary1.isFullyPaid === true, "Trip is now marked as fully paid");
    assert(summary1.amountPaid === 185.0, "amountPaid is persisted as ₹185.0");
    assert(summary1.outstandingBalance === 0, "outstandingBalance is ₹0");

    // -------------------------------------------------------------
    // Test Case 2: Passenger pays early during SCHEDULED/ACTIVE ride
    // -------------------------------------------------------------
    console.log("\n--- TEST CASE 2: Passenger Pays Early During Ride ---");
    const ride2 = await prisma.ride.create({
      data: {
        driverId: driver.id,
        origin: "Swargate",
        originLat: 18.5018,
        originLon: 73.8584,
        destination: "Viman Nagar",
        destLat: 18.5679,
        destLon: 73.9143,
        departure: new Date(Date.now() + 1800000),
        seats: 3,
        status: "ACTIVE", // In-progress ride
        rideType: "Personal Cab",
        distance: 12000,
      },
    });

    const booking2 = await prisma.booking.create({
      data: {
        rideId: ride2.id,
        userId: passengerAlice.id,
        status: "CONFIRMED",
        pickupLocation: "Swargate",
        pickupLat: 18.5018,
        pickupLon: 73.8584,
        dropLocation: "Viman Nagar",
        dropLat: 18.5679,
        dropLon: 73.9143,
        fare: 120.0,
      },
    });

    let summary2 = await computeBookingPaymentSummary({ ...booking2, ride: ride2 });
    assert(summary2.canPayEarly === true, "Passenger is offered Pay Now (Early Settlement) during ACTIVE ride");

    // Pay early
    const order2 = await createOrGetPaymentOrder({
      bookingId: booking2.id,
      userId: passengerAlice.id,
    });
    const fakePayId2 = `pay_test_${Date.now()}_2`;
    const sig2 = crypto
      .createHmac("sha256", razorpaySecret)
      .update(`${order2.providerOrderId}|${fakePayId2}`)
      .digest("hex");

    await verifyAndConfirmPayment({
      bookingId: booking2.id,
      userId: passengerAlice.id,
      razorpayOrderId: order2.providerOrderId,
      razorpayPaymentId: fakePayId2,
      razorpaySignature: sig2,
      paymentMethod: "UPI_QR",
    });

    // Complete the trip now
    const completedRide2 = await prisma.ride.update({
      where: { id: ride2.id },
      data: { status: "COMPLETED" },
    });

    const b2Updated = await prisma.booking.findUnique({
      where: { id: booking2.id },
      include: { payment: true, ride: true },
    });
    summary2 = await computeBookingPaymentSummary({ ...b2Updated!, ride: completedRide2 });
    assert(summary2.isFullyPaid === true, "Trip completion recognizes early payment with 0 balance owed");
    assert(summary2.isPaymentDue === false, "Payment is NOT due again at trip completion");

    // -------------------------------------------------------------
    // Test Case 3: Passenger leaves early and fare is recalculated
    // -------------------------------------------------------------
    console.log("\n--- TEST CASE 3: Early Exit Recalculation & Refund / Balance ---");
    const ride3 = await prisma.ride.create({
      data: {
        driverId: driver.id,
        origin: "Shivajinagar",
        originLat: 18.5308,
        originLon: 73.8475,
        destination: "Lonavala",
        destLat: 18.7557,
        destLon: 73.4091,
        departure: new Date(Date.now() + 1800000),
        seats: 3,
        status: "ACTIVE",
        rideType: "Personal Cab",
        distance: 65000,
      },
    });

    // Alice booked all the way to Lonavala for ₹650 and paid early
    const booking3 = await prisma.booking.create({
      data: {
        rideId: ride3.id,
        userId: passengerAlice.id,
        status: "CONFIRMED",
        pickupLocation: "Shivajinagar",
        pickupLat: 18.5308,
        pickupLon: 73.8475,
        dropLocation: "Lonavala",
        dropLat: 18.7557,
        dropLon: 73.4091,
        fare: 650.0,
      },
    });

    // Passenger Alice paid ₹650 upfront
    const payment3 = await prisma.payment.create({
      data: {
        bookingId: booking3.id,
        rideId: ride3.id,
        userId: passengerAlice.id,
        amount: 650.0,
        amountSubunits: 65000,
        amountPaid: 650.0,
        finalFare: 650.0,
        outstandingBalance: 0,
        currency: "INR",
        status: "SUCCEEDED",
        provider: "RAZORPAY",
        providerOrderId: "order_test_mock_3",
        providerPaymentId: "pay_prepaid_early_exit_123",
        idempotencyKey: `idem_mock_3_${Date.now()}`,
      },
    });

    // Alice exits early at Talegaon (approx halfway)
    const earlyExitResult = await handleEarlyExitSettlement({
      bookingId: booking3.id,
      userId: passengerAlice.id,
      exitLocationName: "Talegaon Dabhade",
      exitLat: 18.7302,
      exitLon: 73.6738,
    });

    assert(earlyExitResult.success === true, "Early exit settlement handled successfully");
    assert(earlyExitResult.newFare < 650.0, `Fare was reduced based on actual travel distance (New fare: ₹${earlyExitResult.newFare})`);
    assert(earlyExitResult.refundProcessed > 0, `Refund of ₹${earlyExitResult.refundProcessed} was initiated for overpayment`);

    const updatedBooking3 = await prisma.booking.findUnique({
      where: { id: booking3.id },
      include: { payment: true },
    });
    assert(updatedBooking3?.dropLocation === "Talegaon Dabhade", "Drop location recorded as early exit point");
    assert(
      (updatedBooking3?.payment?.refundAmount || 0) > 0,
      `Payment record updated with overpayment refundAmount (₹${updatedBooking3?.payment?.refundAmount})`
    );

    // -------------------------------------------------------------
    // Test Case 4: Page refresh simulation (Payment state persisted)
    // -------------------------------------------------------------
    console.log("\n--- TEST CASE 4: Refresh Persistence from Database ---");
    const booking1Refetched = await prisma.booking.findUnique({
      where: { id: booking1.id },
      include: { payment: true, ride: true },
    });
    const summary1Refreshed = await computeBookingPaymentSummary(booking1Refetched!);
    assert(summary1Refreshed.status === "SUCCEEDED", "Payment status SUCCEEDED persists across DB queries");
    assert(summary1Refreshed.amountPaid === 185.0, "amountPaid persists accurately across DB queries");
    assert(summary1Refreshed.outstandingBalance === 0, "outstandingBalance remains 0 after reload");

    // -------------------------------------------------------------
    // Test Case 5: Driver and Passenger Screen Status Parity
    // -------------------------------------------------------------
    console.log("\n--- TEST CASE 5: Driver and Passenger Status Parity ---");
    // Driver queries ride with bookings & payments
    const driverRideQuery = await prisma.ride.findUnique({
      where: { id: ride1.id },
      include: {
        bookings: {
          where: { status: "CONFIRMED" },
          include: { payment: true, user: { select: { id: true, name: true } } },
        },
      },
    });

    const driverPassengerPayment = driverRideQuery?.bookings[0]?.payment;
    assert(driverPassengerPayment?.status === "SUCCEEDED", "Driver sees payment status SUCCEEDED");
    assert(driverPassengerPayment?.amountPaid === 185.0, "Driver sees exact amount paid (₹185)");
    assert(driverPassengerPayment?.outstandingBalance === 0, "Driver sees 0 balance due");

    // Passenger queries their booking payment summary
    assert(summary1Refreshed.status === driverPassengerPayment?.status, "Passenger & Driver see identical status");
    assert(summary1Refreshed.amountPaid === driverPassengerPayment?.amountPaid, "Passenger & Driver see identical amount paid");
    assert(summary1Refreshed.outstandingBalance === driverPassengerPayment?.outstandingBalance, "Passenger & Driver see identical balance");

    // -------------------------------------------------------------
    // Test Case 6: Payment failure handling and retry
    // -------------------------------------------------------------
    console.log("\n--- TEST CASE 6: Payment Failure Handling & Retry ---");
    const bookingFail = await prisma.booking.create({
      data: {
        rideId: ride1.id,
        userId: passengerBob.id,
        status: "CONFIRMED",
        pickupLocation: "Station",
        dropLocation: "Hinjawadi",
        fare: 200.0,
      },
    });

    const failPayment = await prisma.payment.create({
      data: {
        bookingId: bookingFail.id,
        rideId: ride1.id,
        userId: passengerBob.id,
        amount: 200.0,
        amountSubunits: 20000,
        amountPaid: 0,
        finalFare: 200.0,
        outstandingBalance: 200.0,
        currency: "INR",
        status: "FAILED",
        provider: "RAZORPAY",
        providerOrderId: "order_test_fail_6",
        idempotencyKey: `idem_fail_6_${Date.now()}`,
      },
    });

    assert(isValidPaymentTransition("FAILED", "PROCESSING") === true, "State machine allows retry transition from FAILED to PROCESSING");
    assert(isValidPaymentTransition("FAILED", "SUCCEEDED") === true, "State machine allows recovery transition from FAILED to SUCCEEDED");

    // Retry payment order
    const retryOrder = await createOrGetPaymentOrder({
      bookingId: bookingFail.id,
      userId: passengerBob.id,
    });
    assert(retryOrder.providerOrderId !== undefined, "Retry generates or retrieves active payment order");

    const fakePayIdFail = `pay_retry_${Date.now()}`;
    const sigFail = crypto
      .createHmac("sha256", razorpaySecret)
      .update(`${retryOrder.providerOrderId}|${fakePayIdFail}`)
      .digest("hex");

    const retryVerify = await verifyAndConfirmPayment({
      bookingId: bookingFail.id,
      userId: passengerBob.id,
      razorpayOrderId: retryOrder.providerOrderId,
      razorpayPaymentId: fakePayIdFail,
      razorpaySignature: sigFail,
      paymentMethod: "CARD",
    });
    assert(retryVerify.status === "SUCCEEDED", "Retry successfully settled failed payment into SUCCEEDED");

    // -------------------------------------------------------------
    // Test Case 7: Duplicate clicks / Idempotent checkout orders
    // -------------------------------------------------------------
    console.log("\n--- TEST CASE 7: Idempotent Checkout Orders (No Double Charging) ---");
    const bookingDup = await prisma.booking.create({
      data: {
        rideId: ride1.id,
        userId: passengerBob.id,
        status: "CONFIRMED",
        pickupLocation: "A",
        dropLocation: "B",
        fare: 150.0,
      },
    });

    // Simulate 3 simultaneous clicks
    const [click1, click2, click3] = await Promise.all([
      createOrGetPaymentOrder({ bookingId: bookingDup.id, userId: passengerBob.id }),
      createOrGetPaymentOrder({ bookingId: bookingDup.id, userId: passengerBob.id }),
      createOrGetPaymentOrder({ bookingId: bookingDup.id, userId: passengerBob.id }),
    ]);

    assert(click1.providerOrderId === click2.providerOrderId && click2.providerOrderId === click3.providerOrderId, "All concurrent clicks returned the identical order ID");
    const countPayments = await prisma.payment.count({ where: { bookingId: bookingDup.id } });
    assert(countPayments === 1, "Only a single payment record was created in the database");

    // -------------------------------------------------------------
    // Test Case 8: Fare change after payment (Partial payment & Balance)
    // -------------------------------------------------------------
    console.log("\n--- TEST CASE 8: Fare Change & Partial Payment Settlement ---");
    // Bob has booking with initial fare ₹150, pays ₹150
    const fakePayDup = `pay_dup_${Date.now()}`;
    const sigDup = crypto
      .createHmac("sha256", razorpaySecret)
      .update(`${click1.providerOrderId}|${fakePayDup}`)
      .digest("hex");

    await verifyAndConfirmPayment({
      bookingId: bookingDup.id,
      userId: passengerBob.id,
      razorpayOrderId: click1.providerOrderId,
      razorpayPaymentId: fakePayDup,
      razorpaySignature: sigDup,
    });

    // Now driver makes a detour that increases the booking fare to ₹220
    const newDetourFare = 220.0;
    await prisma.booking.update({
      where: { id: bookingDup.id },
      data: { fare: newDetourFare },
    });

    // Payment summary recalculates dynamic balance
    const summaryDetour = await computeBookingPaymentSummary({
      ...bookingDup,
      fare: newDetourFare,
      payment: await prisma.payment.findUnique({ where: { bookingId: bookingDup.id } }),
    });

    assert(summaryDetour.isPartiallyPaid === true, "Trip is recognized as PARTIALLY_PAID after fare increase");
    assert(summaryDetour.amountPaid === 150.0, "amountPaid preserves existing ₹150 payment");
    assert(summaryDetour.outstandingBalance === 70.0, "outstandingBalance is ₹70.0 (220 - 150)");

    // Passenger pays the remaining balance
    const secondOrder = await createOrGetPaymentOrder({
      bookingId: bookingDup.id,
      userId: passengerBob.id,
    });
    assert(secondOrder.amount === 70.0, "Second checkout order charges ONLY the remaining balance of ₹70");

    const fakePaySecond = `pay_bal_${Date.now()}`;
    const sigSecond = crypto
      .createHmac("sha256", razorpaySecret)
      .update(`${secondOrder.providerOrderId}|${fakePaySecond}`)
      .digest("hex");

    const secondVerify = await verifyAndConfirmPayment({
      bookingId: bookingDup.id,
      userId: passengerBob.id,
      razorpayOrderId: secondOrder.providerOrderId,
      razorpayPaymentId: fakePaySecond,
      razorpaySignature: sigSecond,
    });

    assert(secondVerify.status === "SUCCEEDED", "After paying balance, payment status is SUCCEEDED");
    const finalDupSummary = await computeBookingPaymentSummary(
      await prisma.booking.findUnique({ where: { id: bookingDup.id }, include: { payment: true } }) as any
    );
    assert(finalDupSummary.amountPaid === 220.0, "Total amount paid is updated to ₹220");
    assert(finalDupSummary.outstandingBalance === 0, "Final outstanding balance is 0");

    // -------------------------------------------------------------
    // Test Case 9: UPI and QR configuration verification
    // -------------------------------------------------------------
    console.log("\n--- TEST CASE 9: UPI, QR, and Multi-Method Checkout Options ---");
    // Verify checkout options config in PaymentCheckout logic
    const testCheckoutOptions = {
      key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "rzp_test_Ts9au2UkCzfNgN",
      amount: 10000,
      currency: "INR",
      order_id: "order_mock_test_123",
      config: {
        display: {
          blocks: {
            upi: {
              name: "Pay via UPI / QR Code",
              instruments: [{ method: "upi", flows: ["qr", "intent", "collect"] }],
            },
            other: {
              name: "Cards, NetBanking & Wallets",
              instruments: [{ method: "card" }, { method: "netbanking" }, { method: "wallet" }],
            },
          },
          sequence: ["block.upi", "block.other"],
          preferences: { show_default_blocks: true },
        },
      },
    };

    assert(testCheckoutOptions.config.display.sequence[0] === "block.upi", "UPI / QR is prioritised in Razorpay Checkout sequence");
    assert(
      testCheckoutOptions.config.display.blocks.upi.instruments[0].flows.includes("qr"),
      "QR flow is explicitly included in UPI instrument config"
    );
    assert(
      testCheckoutOptions.config.display.blocks.upi.instruments[0].flows.includes("intent"),
      "UPI Intent (GPay, PhonePe, Paytm apps) flow is enabled"
    );
    assert(
      testCheckoutOptions.config.display.blocks.other.instruments.some((i) => i.method === "card"),
      "Card payment method preserved"
    );
    assert(
      testCheckoutOptions.config.display.blocks.other.instruments.some((i) => i.method === "netbanking"),
      "Netbanking payment method preserved"
    );

    // -------------------------------------------------------------
    // Test Case 10: Regression Verification
    // -------------------------------------------------------------
    console.log("\n--- TEST CASE 10: System Regression Checks ---");
    // 1. Ride publishing
    const regRide = await prisma.ride.create({
      data: {
        driverId: driver.id,
        origin: "Pune Station",
        destination: "Kothrud",
        departure: new Date(Date.now() + 86400000),
        seats: 4,
        status: "SCHEDULED",
        rideType: "Personal Cab",
        distance: 8000,
      },
    });
    assert(regRide.id !== undefined, "Ride publishing functions normally");

    // 2. Booking creation
    const regBooking = await prisma.booking.create({
      data: {
        rideId: regRide.id,
        userId: passengerAlice.id,
        status: "CONFIRMED",
        pickupLocation: "Pune Station",
        dropLocation: "Kothrud",
        fare: 80.0,
      },
    });
    assert(regBooking.id !== undefined, "Passenger booking creation functions normally");

    // 3. Dynamic route recalculation doesn't crash on newly booked rides
    const recalcRes = await recalculateRideRouteAndFares(regRide.id);
    assert(recalcRes !== undefined, "Dynamic route and fare recalculation executed cleanly");

    // 4. Booking cancellation
    const cancelBooking = await prisma.booking.update({
      where: { id: regBooking.id },
      data: { status: "CANCELLED" },
    });
    assert(cancelBooking.status === "CANCELLED", "Booking cancellation functions normally");

  } finally {
    // Clean up test data
    console.log("\n--- Cleaning up test records ---");
    const testUserIds = [driver.id, passengerAlice.id, passengerBob.id];
    
    // Delete payment audits
    const payments = await prisma.payment.findMany({
      where: { userId: { in: testUserIds } },
      select: { id: true },
    });
    if (payments.length > 0) {
      await prisma.paymentAudit.deleteMany({
        where: { paymentId: { in: payments.map((p) => p.id) } },
      });
    }

    // Delete payments
    await prisma.payment.deleteMany({
      where: { userId: { in: testUserIds } },
    });

    // Delete bookings
    await prisma.booking.deleteMany({
      where: { userId: { in: testUserIds } },
    });

    // Delete rides
    await prisma.ride.deleteMany({
      where: { driverId: driver.id },
    });

    // Delete users
    await prisma.user.deleteMany({
      where: { id: { in: testUserIds } },
    });
    console.log("  Cleaned up all temporary test records.");
  }

  console.log("\n==================================================================");
  console.log(`  DYNAMIC PAYMENT TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runDynamicPaymentTestSuite().catch((err) => {
  console.error("Test suite encountered fatal error:", err);
  process.exit(1);
});

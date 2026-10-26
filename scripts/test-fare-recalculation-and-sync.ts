import fs from "fs";
import path from "path";

// Load .env
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
import { recalculateRideRouteAndFares } from "../src/lib/dynamicRouting";
import { calculateFare } from "../src/lib/fareCalculator";
import bcrypt from "bcryptjs";

async function runDynamicRecalculationTestSuite() {
  console.log("==================================================================");
  console.log("   TPOOL AUDIT: DYNAMIC FARE RECALCULATION & SYNC TEST SUITE");
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

  // --- Real route corridor: IIIT Pune to Talegaon Railway Station ---
  const routePoints: [number, number][] = [
    [18.7460, 73.6660], // Start: IIIT Pune Campus
    [18.7420, 73.6700], // intermediate
    [18.7380, 73.6750], // Chhatrapati Chowk
    [18.7350, 73.6790], // intermediate
    [18.7330, 73.6820], // Maruti Mandir
    [18.7310, 73.6850], // Station Road
    [18.7290, 73.6890], // End: Talegaon Railway Station
  ];

  try {
    // -------------------------------------------------------------
    // Test 1: Authoritative Private Pooling Formula Verification
    // -------------------------------------------------------------
    console.log("--- Test 1: Private Pooling Pricing Formula (₹10/km base + ₹10/km detour) ---");
    const fare10km = calculateFare({
      rideType: "Private Car Pool",
      routeDistanceMeters: 10000,
      pickupDetourMeters: 0,
      dropDetourMeters: 0,
      includePlatformFee: false,
    });
    assert(fare10km.mainRouteFare === 100.0, "10km base route fare is exactly ₹100 (₹10/km)");
    assert(fare10km.detourFare === 0.0, "Detour fare is ₹0 when on-route");
    assert(fare10km.passengerTotal === 100.0, "Total passenger fare is ₹100 without detour");
    assert(fare10km.passengerTotalPaise === 10000, "Integer paise precision correctly stores 10000 paise");

    const fareWithDetour = calculateFare({
      rideType: "Private Car Pool",
      routeDistanceMeters: 10000,
      pickupDetourMeters: 2000, // 2km detour
      dropDetourMeters: 0,
      includePlatformFee: false,
    });
    assert(fareWithDetour.mainRouteFare === 100.0, "Main route fare remains ₹100");
    assert(fareWithDetour.pickupDetourFare === 20.0, "2km detour fare is exactly ₹20 (₹10/km detour)");
    assert(fareWithDetour.detourFare === 20.0, "Total detour fare is ₹20");
    assert(fareWithDetour.passengerTotal === 120.0, "Total passenger fare is ₹120 (₹100 + ₹20)");
    assert(fareWithDetour.passengerTotalPaise === 12000, "Integer paise is 12000 paise");

    // -------------------------------------------------------------
    // Test 2: Driver exclusion from passenger count and fare calculation
    // -------------------------------------------------------------
    console.log("\n--- Test 2: Driver is never charged or treated as a passenger ---");
    assert(fareWithDetour.driverEarning === 120.0, "Driver earns full subtotal (₹120) and is not charged");

    // -------------------------------------------------------------
    // Database Setup for Integration Tests
    // -------------------------------------------------------------
    console.log("\n--- Setting up Test Users and Ride in Database ---");
    const hashedPwd = await bcrypt.hash("Password123!", 8);

    const driver = await prisma.user.upsert({
      where: { email: "driver_sync_audit@test.com" },
      update: { userType: "DRIVER" },
      create: {
        email: "driver_sync_audit@test.com",
        name: "Sync Test Driver",
        password: hashedPwd,
        role: "USER",
        userType: "DRIVER",
        phoneNumber: "+919876543220",
      },
    });

    const pass1 = await prisma.user.upsert({
      where: { email: "passenger1_sync_audit@test.com" },
      update: { userType: "PASSENGER" },
      create: {
        email: "passenger1_sync_audit@test.com",
        name: "Alice Passenger",
        password: hashedPwd,
        role: "USER",
        userType: "PASSENGER",
        phoneNumber: "+919876543221",
      },
    });

    const pass2 = await prisma.user.upsert({
      where: { email: "passenger2_sync_audit@test.com" },
      update: { userType: "PASSENGER" },
      create: {
        email: "passenger2_sync_audit@test.com",
        name: "Bob Passenger",
        password: hashedPwd,
        role: "USER",
        userType: "PASSENGER",
        phoneNumber: "+919876543222",
      },
    });

    // Create a Ride with baseline route
    const testRide = await prisma.ride.create({
      data: {
        driverId: driver.id,
        origin: "IIIT Pune Campus",
        originLat: routePoints[0][0],
        originLon: routePoints[0][1],
        destination: "Talegaon Railway Station",
        destLat: routePoints[6][0],
        destLon: routePoints[6][1],
        departure: new Date(Date.now() + 3600000),
        seats: 3,
        price: 80.0,
        rideType: "Private Car Pool",
        status: "ACTIVE",
        baseRouteGeometry: JSON.stringify(routePoints),
        baseDistance: 4200, // 4.2 km
        routeGeometry: JSON.stringify(routePoints),
        distance: 4200,
      },
    });
    assert(Boolean(testRide.id), `Created active test ride ${testRide.id}`);

    // -------------------------------------------------------------
    // Test 3: Passenger 1 Books with an Off-Corridor Detour
    // -------------------------------------------------------------
    console.log("\n--- Test 3: Passenger 1 Booking with Off-Corridor Detour ---");
    // Off-corridor pickup ~600m away from Chhatrapati Chowk
    const detourPickupLat = 18.7395;
    const detourPickupLon = 73.6790;

    const booking1 = await prisma.booking.create({
      data: {
        rideId: testRide.id,
        userId: pass1.id,
        seats: 1,
        fare: 0, // will be computed by dynamic routing
        status: "CONFIRMED",
        pickupLocation: "Off-route Tech Park",
        pickupLat: detourPickupLat,
        pickupLon: detourPickupLon,
        dropLocation: "Talegaon Railway Station",
        dropLat: routePoints[6][0],
        dropLon: routePoints[6][1],
      },
    });

    // Run dynamic routing recalculation
    const rerouteRes1 = await recalculateRideRouteAndFares(testRide.id);
    assert(rerouteRes1.success === true, "Initial reroute for Passenger 1 succeeded");

    const updatedBooking1 = await prisma.booking.findUnique({
      where: { id: booking1.id },
    });
    assert(Boolean(updatedBooking1), "Found updated Passenger 1 booking");
    const initialFarePass1 = updatedBooking1!.fare;
    const initialDetourFare1 = updatedBooking1!.detourFare || 0;
    console.log(`    Passenger 1 Initial Fare: ₹${initialFarePass1.toFixed(2)} (Incl. Detour ₹${initialDetourFare1.toFixed(2)})`);
    assert(initialFarePass1 > 0, "Passenger 1 has a positive calculated fare");
    assert(initialDetourFare1 > 0, "Passenger 1 pays for their off-corridor detour");

    // -------------------------------------------------------------
    // Test 4: Passenger 1 Pre-Pays Their Fare (Early Payment Settlement)
    // -------------------------------------------------------------
    console.log("\n--- Test 4: Passenger 1 Pre-Pays Their Entire Initial Fare ---");
    const payment1 = await prisma.payment.create({
      data: {
        bookingId: booking1.id,
        rideId: testRide.id,
        userId: pass1.id,
        amount: initialFarePass1,
        amountSubunits: Math.round(initialFarePass1 * 100),
        amountPaid: initialFarePass1,
        finalFare: initialFarePass1,
        outstandingBalance: 0,
        status: "SUCCEEDED",
        provider: "RAZORPAY",
        providerOrderId: `order_test_${Date.now()}_1`,
        providerPaymentId: `pay_test_${Date.now()}_1`,
        idempotencyKey: `idem_${booking1.id}_init`,
      },
    });
    assert(payment1.status === "SUCCEEDED" && payment1.outstandingBalance === 0, "Passenger 1 payment recorded as SUCCEEDED with 0 balance");

    // -------------------------------------------------------------
    // Test 5: Passenger 2 Joins at Nearby Intermediate Stop (Shares Detour)
    // -------------------------------------------------------------
    console.log("\n--- Test 5: Passenger 2 Joins and Shares Detour Cluster ---");
    // Pickup within 150m of Passenger 1's detour pickup (cluster grouping < 300m)
    const detourPickup2Lat = 18.7398;
    const detourPickup2Lon = 73.6792;

    const booking2 = await prisma.booking.create({
      data: {
        rideId: testRide.id,
        userId: pass2.id,
        seats: 1,
        fare: 0,
        status: "CONFIRMED",
        pickupLocation: "Off-route Tech Park Gate 2",
        pickupLat: detourPickup2Lat,
        pickupLon: detourPickup2Lon,
        dropLocation: "Talegaon Railway Station",
        dropLat: routePoints[6][0],
        dropLon: routePoints[6][1],
      },
    });

    // Create an unpaid payment for Passenger 2
    await prisma.payment.create({
      data: {
        bookingId: booking2.id,
        rideId: testRide.id,
        userId: pass2.id,
        amount: 50.0,
        amountSubunits: 5000,
        amountPaid: 0,
        finalFare: 50.0,
        outstandingBalance: 50.0,
        status: "PENDING",
        provider: "RAZORPAY",
        providerOrderId: `order_test_${Date.now()}_2`,
        idempotencyKey: `idem_${booking2.id}_init`,
      },
    });

    // Recalculate dynamic routing and shared fares
    const rerouteRes2 = await recalculateRideRouteAndFares(testRide.id);
    assert(rerouteRes2.success === true, "Reroute with Passenger 2 joining succeeded");

    // Check Passenger 1's recalculated fare
    const pass1AfterJoin = await prisma.booking.findUnique({
      where: { id: booking1.id },
      include: { payment: true },
    });
    const newFarePass1 = pass1AfterJoin!.fare;
    const newDetourFare1 = pass1AfterJoin!.detourFare || 0;
    console.log(`    Passenger 1 Recalculated Fare: ₹${newFarePass1.toFixed(2)} (Previous: ₹${pass1AfterJoin!.previousFare?.toFixed(2)})`);
    console.log(`    Passenger 1 Detour Fare: Halved from ₹${initialDetourFare1.toFixed(2)} to ₹${newDetourFare1.toFixed(2)}`);

    assert(newFarePass1 < initialFarePass1, "Passenger 1 fare decreased due to shared detour savings!");
    assert(pass1AfterJoin!.previousFare === initialFarePass1, "Passenger 1 previousFare accurately records old fare");
    assert(pass1AfterJoin!.fareVersion === 2, "Passenger 1 fareVersion incremented to 2");
    assert(Boolean(pass1AfterJoin!.fareChangeReason?.includes("Shared detour")), "Passenger 1 fareChangeReason explains detour savings");

    // -------------------------------------------------------------
    // Test 6: Overpayment / Refund Credit for Passenger 1
    // -------------------------------------------------------------
    console.log("\n--- Test 6: Refund / Credit Synchronization for Pre-Paid Passenger 1 ---");
    const expectedRefund = Math.round((initialFarePass1 - newFarePass1) * 100) / 100;
    const payment1After = pass1AfterJoin!.payment!;
    console.log(`    Expected Refund/Credit: ₹${expectedRefund.toFixed(2)}`);
    console.log(`    Payment Recorded Refund: ₹${payment1After.refundAmount?.toFixed(2)}`);
    console.log(`    Payment Outstanding Balance: ₹${payment1After.outstandingBalance?.toFixed(2)}`);

    assert(payment1After.outstandingBalance === 0, "Passenger 1 outstanding balance remains 0");
    assert(payment1After.status === "SUCCEEDED", "Passenger 1 status remains SUCCEEDED");
    assert(
      typeof payment1After.refundAmount === "number" && Math.abs(payment1After.refundAmount - expectedRefund) < 0.05,
      "Passenger 1 payment accurately records credit/refund for detour savings"
    );

    // Verify PaymentAudit was logged
    const audits = await prisma.paymentAudit.findMany({
      where: { bookingId: booking1.id, action: "FARE_RECALCULATED_DECREASE_REFUND_CREDIT" },
    });
    assert(audits.length >= 1, "PaymentAudit entry logged for fare decrease and credit/refund");

    // -------------------------------------------------------------
    // Test 7: Unpaid Passenger 2 Balance Update
    // -------------------------------------------------------------
    console.log("\n--- Test 7: Unpaid Passenger 2 Balance Synchronization ---");
    const pass2Booking = await prisma.booking.findUnique({
      where: { id: booking2.id },
      include: { payment: true },
    });
    assert(pass2Booking!.fare > 0, "Passenger 2 has a valid calculated fare");
    assert(
      Math.abs(pass2Booking!.payment!.outstandingBalance! - pass2Booking!.fare) < 0.01,
      "Passenger 2 outstanding balance matches their newly calculated fare"
    );

    // -------------------------------------------------------------
    // Test 8: Passenger 2 Cancels -> Passenger 1 Fare Recalculated Upward
    // -------------------------------------------------------------
    console.log("\n--- Test 8: Co-Passenger Cancels -> Detour No Longer Shared ---");
    await prisma.booking.update({
      where: { id: booking2.id },
      data: { status: "CANCELLED" },
    });

    const rerouteRes3 = await recalculateRideRouteAndFares(testRide.id);
    assert(rerouteRes3.success === true, "Reroute after Passenger 2 cancellation succeeded");

    const pass1AfterCancel = await prisma.booking.findUnique({
      where: { id: booking1.id },
      include: { payment: true },
    });
    console.log(`    Passenger 1 Restored Fare: ₹${pass1AfterCancel!.fare.toFixed(2)} (Previous: ₹${pass1AfterCancel!.previousFare?.toFixed(2)})`);
    assert(
      Math.abs(pass1AfterCancel!.fare - initialFarePass1) < 0.05,
      "Passenger 1 fare restored to full detour cost when co-passenger exits"
    );
    assert(pass1AfterCancel!.fareVersion === 3, "Passenger 1 fareVersion incremented to 3");
    assert(pass1AfterCancel!.previousFare === newFarePass1, "Passenger 1 previousFare accurately records the intermediate shared fare");

    // -------------------------------------------------------------
    // Cleanup
    // -------------------------------------------------------------
    console.log("\n--- Cleaning up Test Records ---");
    await prisma.paymentAudit.deleteMany({ where: { bookingId: { in: [booking1.id, booking2.id] } } });
    await prisma.payment.deleteMany({ where: { rideId: testRide.id } });
    await prisma.booking.deleteMany({ where: { rideId: testRide.id } });
    await prisma.ride.delete({ where: { id: testRide.id } });
    await prisma.user.deleteMany({ where: { email: { in: [driver.email, pass1.email, pass2.email] } } });
    console.log("    Cleaned up test data safely.");

  } catch (err) {
    console.error("Test execution failed:", err);
    failed++;
  }

  console.log("\n==================================================================");
  console.log(`   TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log("==================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runDynamicRecalculationTestSuite();

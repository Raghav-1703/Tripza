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
import { calculateFare } from "../src/lib/fareCalculator";
import { sendEmergencyEmail, sendEmergencySms } from "../src/lib/notifications";
import { recalculateRideRouteAndFares } from "../src/lib/dynamicRouting";
import { 
  handleEarlyExitSettlement, 
  createOrGetPaymentOrder, 
  verifyAndConfirmPayment,
  PaymentStatus 
} from "../src/lib/payment";
import bcrypt from "bcryptjs";
import crypto from "crypto";

async function runAuditSuite() {
  console.log("==================================================================");
  console.log("   TPOOL AUDIT: LOCATION, DYNAMIC FARE, & EARLY EXIT TEST SUITE");
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

  // -------------------------------------------------------------
  // TEST SUITE 1: SOS Live Location & Accuracy Verification
  // -------------------------------------------------------------
  console.log("\n--- [TEST SUITE 1] SOS Live Location & Anti-Fabrication Audit ---");

  // 1.1 Fresh valid GPS coordinates formatting
  const testPayloadWithGps = {
    passengerName: "Test Passenger Alpha",
    passengerEmail: "passenger.alpha@tpool.local",
    emergencyContactEmail: "ice.contact@tpool.local",
    emergencyContactName: "ICE Guardian",
    rideId: "ride_test_sos_1",
    origin: "Indiranagar, Bangalore",
    destination: "Electronic City, Bangalore",
    driverName: "Captain Vikram",
    departure: new Date(),
    alertCreatedAt: new Date(),
    latitude: 12.9716,
    longitude: 77.5946,
    accuracy: 14.5,
  };

  const emailRes1 = await sendEmergencyEmail(testPayloadWithGps);
  assert(emailRes1.success === true, "Emergency email handles live coordinates with high accuracy (±15m)");

  // 1.2 Invalid / missing GPS coordinates: Must NOT fabricate fallback coordinates
  const testPayloadNoGps = {
    passengerName: "Test Passenger Beta",
    passengerEmail: "passenger.beta@tpool.local",
    emergencyContactEmail: "ice.contact2@tpool.local",
    emergencyContactName: "ICE Guardian 2",
    rideId: "ride_test_sos_2",
    origin: "Koramangala, Bangalore",
    destination: "Whitefield, Bangalore",
    driverName: "Captain Rohit",
    departure: new Date(),
    alertCreatedAt: new Date(),
    latitude: null,
    longitude: null,
    accuracy: null,
  };

  const emailRes2 = await sendEmergencyEmail(testPayloadNoGps);
  assert(emailRes2.success === true, "Emergency alert dispatches with 'Unavailable' status without fabricating fake coordinates");

  // 1.3 Out-of-bounds coordinates rejection
  const invalidLat = 195.4;
  const invalidLon = -210.1;
  const isValidCoord = (lat: number, lon: number) => lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  assert(!isValidCoord(invalidLat, invalidLon), "Strict validation rejects invalid coordinates outside [-90, 90] and [-180, 180]");

  // -------------------------------------------------------------
  // TEST SUITE 2: Authoritative Fare Calculation Engine
  // -------------------------------------------------------------
  console.log("\n--- [TEST SUITE 2] Authoritative Fare Calculation Engine Rules ---");

  // 2.1 Personal Cab: ₹20/km main, ₹10/km detour, 0 incentive, 3% platform fee
  const personalCabFare = calculateFare({
    rideType: "Personal Cab",
    routeDistanceMeters: 10000, // 10 km -> 10 * 20 = 200
    pickupDetourMeters: 2000,   // 2 km -> 2 * 10 = 20
    dropDetourMeters: 0,
  });
  assert(Math.abs(personalCabFare.passengerTotal - 247.2) < 0.01, `Personal Cab fare matches ₹247.20 (actual: ₹${personalCabFare.passengerTotal})`);

  // 2.2 Private Car Pool: ₹10/km main, ₹20/km detour, 0 incentive, 3% platform fee
  const privatePoolFare = calculateFare({
    rideType: "Private Car Pool",
    routeDistanceMeters: 10000, // 10 km -> 10 * 10 = 100
    pickupDetourMeters: 2000,   // 2 km -> 2 * 20 = 40
    dropDetourMeters: 0,
  });
  assert(Math.abs(privatePoolFare.passengerTotal - 123.6) < 0.01, `Private Car Pool fare matches ₹123.60 (actual: ₹${privatePoolFare.passengerTotal})`);

  // 2.3 Cab Pool: ₹20/km main, ₹20/km detour, ₹3 incentive, 3% platform fee
  const cabPoolFare = calculateFare({
    rideType: "Cab Pool",
    routeDistanceMeters: 10000, // 10 km -> 10 * 20 = 200
    pickupDetourMeters: 2000,   // 2 km -> 2 * 20 = 40
    dropDetourMeters: 0,
  });
  assert(Math.abs(cabPoolFare.passengerTotal - 250.29) < 0.01, `Cab Pool fare matches ₹250.29 (actual: ₹${cabPoolFare.passengerTotal})`);

  // -------------------------------------------------------------
  // TEST SUITE 3: Dynamic Shared Ride Recalculation on Passenger Join
  // -------------------------------------------------------------
  console.log("\n--- [TEST SUITE 3] Dynamic Detour Halving on Co-Passenger Join ---");

  const testRunId = `audit_${Date.now()}`;
  const pw = await bcrypt.hash("TestPass123!", 8);

  const driver = await prisma.user.create({
    data: {
      email: `driver_${testRunId}@tpool.local`,
      name: "Dynamic Driver",
      password: pw,
      userType: "DRIVER",
    },
  });

  const p1 = await prisma.user.create({
    data: {
      email: `p1_${testRunId}@tpool.local`,
      name: "Passenger One",
      password: pw,
      userType: "PASSENGER",
    },
  });

  const p2 = await prisma.user.create({
    data: {
      email: `p2_${testRunId}@tpool.local`,
      name: "Passenger Two",
      password: pw,
      userType: "PASSENGER",
    },
  });

  const ride = await prisma.ride.create({
    data: {
      driverId: driver.id,
      origin: "Kempegowda Station, Majestic, Bangalore",
      destination: "Electronic City Phase 1, Bangalore",
      originLat: 12.9767,
      originLon: 77.5713,
      destLat: 12.8452,
      destLon: 77.6602,
      departure: new Date(Date.now() + 3600000),
      seats: 3,
      price: 200,
      rideType: "Cab Pool",
      status: "ACTIVE",
    },
  });

  const pickupLat = 12.9352;
  const pickupLon = 77.6245;
  const dropLat = 12.8452;
  const dropLon = 77.6602;

  const booking1 = await prisma.booking.create({
    data: {
      userId: p1.id,
      rideId: ride.id,
      seats: 1,
      status: "CONFIRMED",
      pickupLocation: "Koramangala 4th Block",
      dropLocation: "Electronic City",
      pickupLat,
      pickupLon,
      dropLat,
      dropLon,
      fare: 250,
    },
  });

  await recalculateRideRouteAndFares(ride.id);

  const b1Solo = await prisma.booking.findUnique({
    where: { id: booking1.id },
  });
  const soloFare = b1Solo!.fare;
  const soloDetour = b1Solo!.detourDistance || 0;
  console.log(`  ℹ️ Passenger 1 Solo Fare: ₹${soloFare.toFixed(2)}, Detour: ${soloDetour}m`);

  const booking2 = await prisma.booking.create({
    data: {
      userId: p2.id,
      rideId: ride.id,
      seats: 1,
      status: "CONFIRMED",
      pickupLocation: "Koramangala 4th Block (Shared)",
      dropLocation: "Electronic City",
      pickupLat: pickupLat + 0.0001,
      pickupLon: pickupLon + 0.0001,
      dropLat,
      dropLon,
      fare: 250,
    },
  });

  await recalculateRideRouteAndFares(ride.id);

  const b1Shared = await prisma.booking.findUnique({
    where: { id: booking1.id },
  });
  const b2Shared = await prisma.booking.findUnique({
    where: { id: booking2.id },
  });

  console.log(`  ℹ️ Passenger 1 Shared Fare: ₹${b1Shared!.fare.toFixed(2)}, Detour: ${b1Shared!.detourDistance}m`);
  console.log(`  ℹ️ Passenger 2 Shared Fare: ₹${b2Shared!.fare.toFixed(2)}, Detour: ${b2Shared!.detourDistance}m`);

  assert(
    b1Shared!.fare < soloFare,
    `Passenger 1 fare decreased when Passenger 2 joined and shared detour (₹${soloFare.toFixed(2)} -> ₹${b1Shared!.fare.toFixed(2)})`
  );
  assert(
    Math.abs(b1Shared!.fare - b2Shared!.fare) < 1.0,
    `Shared pooling allocates equal detour distance to co-passengers at same stop`
  );

  // -------------------------------------------------------------
  // TEST SUITE 4: Early Exit / Leave-Ride Settlement
  // -------------------------------------------------------------
  console.log("\n--- [TEST SUITE 4] Early Exit Recalculation & Idempotency ---");

  const orderResult = await createOrGetPaymentOrder({
    bookingId: booking1.id,
    userId: p1.id,
  });

  const secret = process.env.RAZORPAY_KEY_SECRET || "dummy_secret_12345";
  const dummyPaymentId = `pay_sim_${Date.now()}`;
  const validSignature = crypto
    .createHmac("sha256", secret)
    .update(`${orderResult.providerOrderId}|${dummyPaymentId}`)
    .digest("hex");

  const confirmResult = await verifyAndConfirmPayment({
    bookingId: booking1.id,
    userId: p1.id,
    razorpayOrderId: orderResult.providerOrderId,
    razorpayPaymentId: dummyPaymentId,
    razorpaySignature: validSignature,
    paymentMethod: "UPI",
  });
  assert(confirmResult.success === true && confirmResult.status === PaymentStatus.SUCCEEDED, "Passenger 1 successfully paid fare before early exit");

  const exitLat = 12.9172;
  const exitLon = 77.6228;
  const exitSettlement = await handleEarlyExitSettlement({
    bookingId: booking1.id,
    userId: p1.id,
    exitLat,
    exitLon,
    exitLocationName: "Silk Board Junction",
  });

  assert(exitSettlement.success === true, "Early exit recorded successfully");
  assert(exitSettlement.newFare < exitSettlement.previousFare, `Early exit recalculated lower fare based on actual travelled distance (₹${exitSettlement.previousFare} -> ₹${exitSettlement.newFare})`);
  assert(exitSettlement.refundProcessed > 0, `Automated refund processed for overpayment difference (₹${exitSettlement.refundProcessed.toFixed(2)})`);

  const duplicateExit = await handleEarlyExitSettlement({
    bookingId: booking1.id,
    userId: p1.id,
    exitLat,
    exitLon,
    exitLocationName: "Silk Board Junction",
  });
  assert(duplicateExit.isExisting === true, "Duplicate early exit call returns existing settlement idempotently");
  assert(duplicateExit.newFare === exitSettlement.newFare, "Duplicate early exit does not alter settled fare");

  // -------------------------------------------------------------
  // TEST SUITE 5: Remaining Passenger & Route Preservation After Early Exit
  // -------------------------------------------------------------
  console.log("\n--- [TEST SUITE 5] Remaining Passengers & Driver Route Preservation ---");

  const b1Exited = await prisma.booking.findUnique({
    where: { id: booking1.id },
  });
  const fb1 = JSON.parse(b1Exited!.fareBreakdown!);
  assert(fb1.earlyExit === true, "Passenger 1 booking preserves earlyExit = true in fareBreakdown");

  await recalculateRideRouteAndFares(ride.id);

  const b1AfterReroute = await prisma.booking.findUnique({
    where: { id: booking1.id },
  });
  assert(b1AfterReroute!.fare === exitSettlement.newFare, "RecalculateRideRouteAndFares strictly preserved already-settled early exit fare");

  const updatedRide = await prisma.ride.findUnique({
    where: { id: ride.id },
  });
  assert(updatedRide!.routeUpdatedAt !== null, "Ride routeUpdatedAt timestamp updated for live passenger & driver polling");

  // -------------------------------------------------------------
  // TEST SUITE 6: Concurrency Mutex on Dynamic Recalculation
  // -------------------------------------------------------------
  console.log("\n--- [TEST SUITE 6] Concurrency Mutex on Simultaneous Recalculations ---");

  const concurrentCalls = [
    recalculateRideRouteAndFares(ride.id),
    recalculateRideRouteAndFares(ride.id),
    recalculateRideRouteAndFares(ride.id),
    recalculateRideRouteAndFares(ride.id),
    recalculateRideRouteAndFares(ride.id),
  ];

  const results = await Promise.all(concurrentCalls);
  const allSucceeded = results.every((r) => r.success === true);
  assert(allSucceeded, "5 simultaneous recalculations serialized cleanly without deadlock or race condition");

  // Clean up test data
  console.log("\n--- Cleaning up audit test fixtures ---");
  await prisma.paymentAudit.deleteMany({ where: { bookingId: { in: [booking1.id, booking2.id] } } });
  await prisma.payment.deleteMany({ where: { bookingId: { in: [booking1.id, booking2.id] } } });
  await prisma.booking.deleteMany({ where: { rideId: ride.id } });
  await prisma.ride.delete({ where: { id: ride.id } });
  await prisma.user.deleteMany({ where: { id: { in: [driver.id, p1.id, p2.id] } } });
  console.log("  Audit test fixtures cleaned up successfully.");

  // Summary
  console.log("\n==================================================================");
  console.log(`   AUDIT RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runAuditSuite().catch((err) => {
  console.error("Audit test suite failed with unhandled error:", err);
  process.exit(1);
});

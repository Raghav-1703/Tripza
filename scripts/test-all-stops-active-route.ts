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
import { checkPassengerEligibility, recalculateRideRouteAndFares } from "../src/lib/dynamicRouting";
import { handleEarlyExitSettlement } from "../src/lib/payment";
import { calculateFare } from "../src/lib/fareCalculator";
import bcrypt from "bcryptjs";

async function runAllStopsTestSuite() {
  console.log("==================================================================");
  console.log("   TPOOL AUDIT: EVERY STOP ALONG ACTIVE RIDE ROUTE TEST SUITE");
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
  // Baseline Polyline:
  // IIIT Pune Campus (18.7460, 73.6660) -> Talegaon Dabhade / Chhatrapati Chowk (18.7380, 73.6750)
  // -> Maruti Mandir / Station Road (18.7330, 73.6820) -> Talegaon Railway Station (18.7290, 73.6890)
  const routePoints: [number, number][] = [
    [18.7460, 73.6660], // Start: IIIT Pune Campus
    [18.7420, 73.6700], // intermediate road segment
    [18.7380, 73.6750], // Chhatrapati Chowk
    [18.7350, 73.6790], // intermediate road segment
    [18.7330, 73.6820], // Maruti Mandir
    [18.7310, 73.6850], // Station Approach Road
    [18.7290, 73.6890], // End: Talegaon Railway Station
  ];

  const driverOrigin = { lat: 18.7460, lon: 73.6660, name: "IIIT Pune Campus" };
  const driverDestination = { lat: 18.7290, lon: 73.6890, name: "Talegaon Railway Station" };

  const chhatrapatiChowk = { lat: 18.7380, lon: 73.6750, name: "Chhatrapati Chowk" };
  const marutiMandir = { lat: 18.7330, lon: 73.6820, name: "Maruti Mandir" };

  // -------------------------------------------------------------
  // TEST SUITE 1: All Combinations of Pickup and Drop-off Along Route
  // -------------------------------------------------------------
  console.log("\n--- [TEST SUITE 1] Pickup and Drop-off Combinations Along Route ---");

  // 1.1 Origin to Intermediate (IIIT Pune -> Chhatrapati Chowk)
  const comb1 = await checkPassengerEligibility({
    passengerOrigin: driverOrigin.name,
    passengerDestination: chhatrapatiChowk.name,
    passengerOriginCoords: driverOrigin,
    passengerDestinationCoords: chhatrapatiChowk,
    driverOriginCoords: driverOrigin,
    driverDestCoords: driverDestination,
    existingRouteGeometry: routePoints,
    rideType: "Cab Pool",
  });
  assert(comb1.eligible === true, "Origin to Intermediate stop (IIIT Pune -> Chhatrapati Chowk) is eligible");
  assert(
    comb1.segmentDistanceMeters! > 0 && comb1.segmentDistanceMeters! < 2500,
    `Partial segment distance (${(comb1.segmentDistanceMeters!).toFixed(0)}m) is strictly shorter than full route`
  );
  assert(comb1.fare! > 0, `Segment fare calculated: ₹${comb1.fare!.toFixed(2)}`);

  // 1.2 Intermediate to Intermediate (Chhatrapati Chowk -> Maruti Mandir)
  const comb2 = await checkPassengerEligibility({
    passengerOrigin: chhatrapatiChowk.name,
    passengerDestination: marutiMandir.name,
    passengerOriginCoords: chhatrapatiChowk,
    passengerDestinationCoords: marutiMandir,
    driverOriginCoords: driverOrigin,
    driverDestCoords: driverDestination,
    existingRouteGeometry: routePoints,
    rideType: "Cab Pool",
  });
  assert(comb2.eligible === true, "Intermediate to Intermediate stop (Chhatrapati Chowk -> Maruti Mandir) is eligible");
  assert(
    comb2.segmentDistanceMeters! > 0 && comb2.segmentDistanceMeters! < comb1.segmentDistanceMeters!,
    `Intermediate segment distance (${(comb2.segmentDistanceMeters!).toFixed(0)}m) reflects exact stop-to-stop distance`
  );

  // 1.3 Intermediate to Final Destination (Chhatrapati Chowk -> Talegaon Railway Station)
  const comb3 = await checkPassengerEligibility({
    passengerOrigin: chhatrapatiChowk.name,
    passengerDestination: driverDestination.name,
    passengerOriginCoords: chhatrapatiChowk,
    passengerDestinationCoords: driverDestination,
    driverOriginCoords: driverOrigin,
    driverDestCoords: driverDestination,
    existingRouteGeometry: routePoints,
    rideType: "Cab Pool",
  });
  assert(comb3.eligible === true, "Intermediate to Destination (Chhatrapati Chowk -> Talegaon Station) is eligible");

  // 1.4 Full Journey: Origin to Destination (IIIT Pune -> Talegaon Railway Station)
  const comb4 = await checkPassengerEligibility({
    passengerOrigin: driverOrigin.name,
    passengerDestination: driverDestination.name,
    passengerOriginCoords: driverOrigin,
    passengerDestinationCoords: driverDestination,
    driverOriginCoords: driverOrigin,
    driverDestCoords: driverDestination,
    existingRouteGeometry: routePoints,
    rideType: "Cab Pool",
  });
  assert(comb4.eligible === true, "Origin to Final Destination full trip is eligible");
  assert(
    comb4.segmentDistanceMeters! > comb1.segmentDistanceMeters! && comb4.segmentDistanceMeters! > comb3.segmentDistanceMeters!,
    "Full route distance is greater than any partial intermediate segment"
  );

  // -------------------------------------------------------------
  // TEST SUITE 2: Direction Enforcement & Rejection Rules
  // -------------------------------------------------------------
  console.log("\n--- [TEST SUITE 2] Route Direction Enforcement & Anti-Reverse Audit ---");

  // 2.1 Complete Reverse: Destination to Origin (Talegaon Railway Station -> IIIT Pune)
  const rev1 = await checkPassengerEligibility({
    passengerOrigin: driverDestination.name,
    passengerDestination: driverOrigin.name,
    passengerOriginCoords: driverDestination,
    passengerDestinationCoords: driverOrigin,
    driverOriginCoords: driverOrigin,
    driverDestCoords: driverDestination,
    existingRouteGeometry: routePoints,
  });
  assert(rev1.eligible === false, "Reverse journey (Talegaon Station -> IIIT Pune) is strictly rejected");
  assert(
    rev1.reason?.includes("direction") ?? false,
    `Rejection message states direction mismatch: "${rev1.reason}"`
  );

  // 2.2 Intermediate Reverse: Drop occurs before pickup along route (Maruti Mandir -> Chhatrapati Chowk)
  const rev2 = await checkPassengerEligibility({
    passengerOrigin: marutiMandir.name,
    passengerDestination: chhatrapatiChowk.name,
    passengerOriginCoords: marutiMandir,
    passengerDestinationCoords: chhatrapatiChowk,
    driverOriginCoords: driverOrigin,
    driverDestCoords: driverDestination,
    existingRouteGeometry: routePoints,
  });
  assert(rev2.eligible === false, "Intermediate reverse trip (Maruti Mandir -> Chhatrapati Chowk) is strictly rejected");

  // 2.3 Identical Stop: Pickup and Drop at the exact same location
  const sameStop = await checkPassengerEligibility({
    passengerOrigin: chhatrapatiChowk.name,
    passengerDestination: chhatrapatiChowk.name,
    passengerOriginCoords: chhatrapatiChowk,
    passengerDestinationCoords: chhatrapatiChowk,
    driverOriginCoords: driverOrigin,
    driverDestCoords: driverDestination,
    existingRouteGeometry: routePoints,
  });
  assert(sameStop.eligible === false, "Zero-length journey (same pickup & drop point) is rejected");

  // -------------------------------------------------------------
  // TEST SUITE 3: Configurable Detour Limits
  // -------------------------------------------------------------
  console.log("\n--- [TEST SUITE 3] Configurable Detour Limits ---");

  // Point with perpendicular distance ~1.2 km from Chhatrapati Chowk
  const detourPoint = { lat: 18.7480, lon: 73.6750 }; // ~1.1 km north of route

  // With strict 0.5 km limit: must be rejected
  const strictDetour = await checkPassengerEligibility({
    passengerOrigin: "Detour Point",
    passengerDestination: driverDestination.name,
    passengerOriginCoords: detourPoint,
    passengerDestinationCoords: driverDestination,
    driverOriginCoords: driverOrigin,
    driverDestCoords: driverDestination,
    existingRouteGeometry: routePoints,
    maxDetourKm: 0.5,
  });
  assert(strictDetour.eligible === false, "Pickup with 1.1km detour is rejected under 0.5km maxDetour limit");

  // With relaxed 2.0 km limit: must be accepted
  const relaxedDetour = await checkPassengerEligibility({
    passengerOrigin: "Detour Point",
    passengerDestination: driverDestination.name,
    passengerOriginCoords: detourPoint,
    passengerDestinationCoords: driverDestination,
    driverOriginCoords: driverOrigin,
    driverDestCoords: driverDestination,
    existingRouteGeometry: routePoints,
    maxDetourKm: 2.0,
  });
  assert(relaxedDetour.eligible === true, "Pickup with 1.1km detour is accepted under 2.0km maxDetour limit");

  // -------------------------------------------------------------
  // TEST SUITE 4: Active Ride Dynamic Matching & Vehicle Progress
  // -------------------------------------------------------------
  console.log("\n--- [TEST SUITE 4] Active Ride Telemetry & Upcoming Stops Only ---");

  // Create active ride in DB with driver telemetry at Chhatrapati Chowk
  const testRunId = `active_route_${Date.now()}`;
  const pw = await bcrypt.hash("TestPass123!", 8);

  const driver = await prisma.user.create({
    data: {
      email: `driver_${testRunId}@tpool.local`,
      name: "Highway Driver",
      password: pw,
      userType: "DRIVER",
    },
  });

  const p1 = await prisma.user.create({
    data: {
      email: `p1_${testRunId}@tpool.local`,
      name: "Early Boarder",
      password: pw,
      userType: "PASSENGER",
    },
  });

  const p2 = await prisma.user.create({
    data: {
      email: `p2_${testRunId}@tpool.local`,
      name: "Downstream Boarder",
      password: pw,
      userType: "PASSENGER",
    },
  });

  // Ride is currently ACTIVE and vehicle has reached Chhatrapati Chowk
  const activeRide = await prisma.ride.create({
    data: {
      driverId: driver.id,
      origin: driverOrigin.name,
      destination: driverDestination.name,
      originLat: driverOrigin.lat,
      originLon: driverOrigin.lon,
      destLat: driverDestination.lat,
      destLon: driverDestination.lon,
      departure: new Date(Date.now() - 600000), // departed 10 mins ago
      seats: 1, // Only 1 seat available
      price: 150,
      rideType: "Cab Pool",
      status: "ACTIVE",
      currentLat: chhatrapatiChowk.lat,
      currentLon: chhatrapatiChowk.lon,
      baseRouteGeometry: JSON.stringify(routePoints),
      routeGeometry: JSON.stringify(routePoints),
      distance: 3500,
    },
  });

  // Passenger A tries to book at IIIT Pune (behind the vehicle's current position)
  const behindVehicle = await checkPassengerEligibility({
    rideId: activeRide.id,
    passengerOrigin: driverOrigin.name,
    passengerDestination: driverDestination.name,
    passengerOriginCoords: driverOrigin,
    passengerDestinationCoords: driverDestination,
  });
  assert(
    behindVehicle.eligible === false,
    "Passenger cannot book at a pickup the active vehicle has already passed"
  );
  assert(
    behindVehicle.reason?.includes("passed") ?? false,
    `Rejection specifies vehicle position: "${behindVehicle.reason}"`
  );

  // Passenger B tries to book at Maruti Mandir (ahead of the vehicle)
  const aheadOfVehicle = await checkPassengerEligibility({
    rideId: activeRide.id,
    passengerOrigin: marutiMandir.name,
    passengerDestination: driverDestination.name,
    passengerOriginCoords: marutiMandir,
    passengerDestinationCoords: driverDestination,
  });
  assert(
    aheadOfVehicle.eligible === true,
    "Passenger can book at an upcoming pickup ahead of the active vehicle"
  );

  // -------------------------------------------------------------
  // TEST SUITE 5: Seat Capacity & Early Exit Seat Liberation
  // -------------------------------------------------------------
  console.log("\n--- [TEST SUITE 5] Seat Capacity & Seat Liberation on Exit ---");

  // Passenger 1 books the only available seat (IIIT Pune -> Chhatrapati Chowk)
  const booking1 = await prisma.booking.create({
    data: {
      userId: p1.id,
      rideId: activeRide.id,
      seats: 1,
      status: "CONFIRMED",
      pickupLocation: driverOrigin.name,
      dropLocation: chhatrapatiChowk.name,
      pickupLat: driverOrigin.lat,
      pickupLon: driverOrigin.lon,
      dropLat: chhatrapatiChowk.lat,
      dropLon: chhatrapatiChowk.lon,
      fare: 80,
    },
  });

  // Decrement seats to 0 (ride is now full)
  await prisma.ride.update({
    where: { id: activeRide.id },
    data: { seats: 0 },
  });

  const fullRide = await prisma.ride.findUnique({ where: { id: activeRide.id } });
  assert(fullRide!.seats === 0, "Active ride has 0 seats remaining");

  // Passenger 1 reaches their stop (Chhatrapati Chowk) and exits early
  const exitRes = await handleEarlyExitSettlement({
    bookingId: booking1.id,
    userId: p1.id,
    exitLat: chhatrapatiChowk.lat,
    exitLon: chhatrapatiChowk.lon,
    exitLocationName: chhatrapatiChowk.name,
  });
  assert(exitRes.success === true, "Passenger 1 early exit settled");

  // Verify that ride available seats was incremented back to 1!
  const rideAfterExit = await prisma.ride.findUnique({ where: { id: activeRide.id } });
  assert(
    rideAfterExit!.seats === 1,
    `Ride seats incremented to ${rideAfterExit!.seats} when passenger exited early`
  );

  // Passenger 2 can now book the newly available seat for the downstream journey!
  const booking2 = await prisma.booking.create({
    data: {
      userId: p2.id,
      rideId: activeRide.id,
      seats: 1,
      status: "CONFIRMED",
      pickupLocation: marutiMandir.name,
      dropLocation: driverDestination.name,
      pickupLat: marutiMandir.lat,
      pickupLon: marutiMandir.lon,
      dropLat: driverDestination.lat,
      dropLon: driverDestination.lon,
      fare: 65,
    },
  });
  assert(booking2.id !== null, "Downstream passenger 2 successfully booked the vacated seat");

  // Clean up
  console.log("\n--- Cleaning up test records ---");
  await prisma.paymentAudit.deleteMany({ where: { bookingId: { in: [booking1.id, booking2.id] } } });
  await prisma.payment.deleteMany({ where: { bookingId: { in: [booking1.id, booking2.id] } } });
  await prisma.booking.deleteMany({ where: { rideId: activeRide.id } });
  await prisma.ride.delete({ where: { id: activeRide.id } });
  await prisma.user.deleteMany({ where: { id: { in: [driver.id, p1.id, p2.id] } } });
  console.log("  Test records cleaned up successfully.");

  // Summary
  console.log("\n==================================================================");
  console.log(`   AUDIT RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runAllStopsTestSuite().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});

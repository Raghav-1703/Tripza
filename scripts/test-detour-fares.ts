import { prisma } from "../src/lib/prisma";
import { checkPassengerEligibility, recalculateRideRouteAndFares, calculateRoadDetourDistance } from "../src/lib/dynamicRouting";
import { calculateFare } from "../src/lib/fareCalculator";

async function runDetourFareTests() {
  console.log("==================================================================");
  console.log("  TPOOL DETOUR FARE CALCULATION & SHARED DETOUR TEST SUITE");
  console.log("==================================================================\n");

  let allPassed = true;
  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      allPassed = false;
    }
  }

  // 1. Setup test driver and ride: Zudio Talegaon -> IIIT Pune
  // Coordinates:
  // Zudio Talegaon: 18.7295, 73.6762
  // IIIT Pune (Near Varale / Talegaon MIDC): 18.7523, 73.6542
  const driver = await prisma.user.upsert({
    where: { email: "testdriver_detour@tpool.local" },
    update: {},
    create: {
      name: "Detour Test Driver",
      email: "testdriver_detour@tpool.local",
      password: "hashedpassword123",
      userType: "DRIVER",
    },
  });

  const p1User = await prisma.user.upsert({
    where: { email: "passenger_onroute@tpool.local" },
    update: {},
    create: {
      name: "On-Route Passenger",
      email: "passenger_onroute@tpool.local",
      password: "hashedpassword123",
      userType: "PASSENGER",
    },
  });

  const p2User = await prisma.user.upsert({
    where: { email: "passenger_offroute_pickup@tpool.local" },
    update: {},
    create: {
      name: "Off-Route Pickup Passenger",
      email: "passenger_offroute_pickup@tpool.local",
      password: "hashedpassword123",
      userType: "PASSENGER",
    },
  });

  const p3User = await prisma.user.upsert({
    where: { email: "passenger_shared1@tpool.local" },
    update: {},
    create: {
      name: "Shared Detour Passenger 1",
      email: "passenger_shared1@tpool.local",
      password: "hashedpassword123",
      userType: "PASSENGER",
    },
  });

  const p4User = await prisma.user.upsert({
    where: { email: "passenger_shared2@tpool.local" },
    update: {},
    create: {
      name: "Shared Detour Passenger 2",
      email: "passenger_shared2@tpool.local",
      password: "hashedpassword123",
      userType: "PASSENGER",
    },
  });

  // Create a clean test ride
  const departureDate = new Date();
  departureDate.setHours(departureDate.getHours() + 4);

  const testRide = await prisma.ride.create({
    data: {
      driverId: driver.id,
      origin: "Zudio Talegaon",
      originLat: 18.7295,
      originLon: 73.6762,
      destination: "IIIT Pune",
      destLat: 18.7523,
      destLon: 73.6542,
      departure: departureDate,
      seats: 4,
      price: 120,
      rideType: "Personal Cab",
      distance: 6200,
      duration: 720,
    },
  });

  console.log(`Created test ride ${testRide.id} (Zudio -> IIIT Pune)`);

  // --- TEST 1: Baseline Route Identification & Preservation ---
  console.log("\n--- TEST 1: Baseline Route Identification & Preservation ---");
  const initResult = await recalculateRideRouteAndFares(testRide.id);
  assert(initResult.success, "Initial route calculation succeeded");

  const rideWithBase = await prisma.ride.findUnique({ where: { id: testRide.id } });
  assert(Boolean(rideWithBase?.baseRouteGeometry), "Baseline route geometry (baseRouteGeometry) is saved in DB");
  assert(Boolean(rideWithBase?.baseDistance && rideWithBase.baseDistance > 0), `Baseline distance saved: ${rideWithBase?.baseDistance}m`);
  const initialBaseGeometry = rideWithBase?.baseRouteGeometry;
  const initialBaseDistance = rideWithBase?.baseDistance;

  // --- TEST 2: On-Route Passenger (Station Corridor -> IIIT Pune) ---
  console.log("\n--- TEST 2: On-Route Passenger ---");
  const basePoints: [number, number][] = JSON.parse(rideWithBase!.baseRouteGeometry!);
  // Point along the corridor (Talegaon Station Road) and end destination point (IIIT Pune)
  const stationLat = basePoints[30][0];
  const stationLon = basePoints[30][1];
  const iiitLat = basePoints[basePoints.length - 1][0];
  const iiitLon = basePoints[basePoints.length - 1][1];

  const elig1 = await checkPassengerEligibility({
    rideId: testRide.id,
    passengerOrigin: "Talegaon Station Corridor",
    passengerDestination: "IIIT Pune Gate",
    passengerOriginCoords: { lat: stationLat, lon: stationLon },
    passengerDestinationCoords: { lat: iiitLat, lon: iiitLon },
  });

  assert(elig1.eligible, "On-route passenger is eligible");
  assert(elig1.pickupDetourMeters === 0, `On-route pickup detour is 0m (actual: ${elig1.pickupDetourMeters ?? 0}m)`);
  assert(elig1.dropDetourMeters === 0, `On-route drop detour is 0m (actual: ${elig1.dropDetourMeters ?? 0}m)`);
  assert((elig1.detourFare || 0) === 0, `On-route detour fare is ₹0.00 (actual: ₹${elig1.detourFare?.toFixed(2)})`);
  console.log(`  On-route passenger normal fare: ₹${elig1.fare?.toFixed(2)} (base segment: ${((elig1.segmentDistanceMeters || 0) / 1000).toFixed(2)} km)`);

  // Confirm Passenger 1 booking
  const booking1 = await prisma.booking.create({
    data: {
      rideId: testRide.id,
      userId: p1User.id,
      status: "CONFIRMED",
      pickupLocation: "Talegaon Station",
      pickupLat: stationLat,
      pickupLon: stationLon,
      dropLocation: "IIIT Pune",
      dropLat: iiitLat,
      dropLon: iiitLon,
      fare: elig1.fare || 0,
      mainFare: elig1.mainFare || 0,
      detourFare: 0,
      detourDistance: 0,
    },
  });

  await recalculateRideRouteAndFares(testRide.id);

  const updatedB1 = await prisma.booking.findUnique({ where: { id: booking1.id } });
  assert(updatedB1?.detourFare === 0, `Confirmed on-route booking has detourFare = ₹0.00`);
  assert(updatedB1?.detourDistance === 0, `Confirmed on-route booking has detourDistance = 0m`);
  const b1FareAfterP1 = updatedB1?.fare || 0;

  // --- TEST 3: Off-Route Pickup (e.g., Real Dream Home -> IIIT Pune) ---
  console.log("\n--- TEST 3: Off-Route Pickup ---");
  // Real Dream Home is off-route (~18.7210, 73.6820)
  const rdhLat = 18.7210;
  const rdhLon = 73.6820;

  const elig2 = await checkPassengerEligibility({
    rideId: testRide.id,
    passengerOrigin: "Real Dream Home",
    passengerDestination: "IIIT Pune",
    passengerOriginCoords: { lat: rdhLat, lon: rdhLon },
    passengerDestinationCoords: { lat: iiitLat, lon: iiitLon },
  });

  assert(elig2.eligible, "Off-route pickup passenger within 2.0km limit is eligible");
  assert((elig2.pickupDetourMeters || 0) > 0, `Off-route pickup detour detected: ${(elig2.pickupDetourMeters || 0).toFixed(0)}m`);
  assert(elig2.dropDetourMeters === 0, `On-route drop detour is 0m`);
  assert((elig2.detourFare || 0) > 0, `Off-route pickup passenger charged detour fare: ₹${elig2.detourFare?.toFixed(2)}`);

  // Confirm Passenger 2 booking
  const booking2 = await prisma.booking.create({
    data: {
      rideId: testRide.id,
      userId: p2User.id,
      status: "CONFIRMED",
      pickupLocation: "Real Dream Home",
      pickupLat: rdhLat,
      pickupLon: rdhLon,
      dropLocation: "IIIT Pune",
      dropLat: iiitLat,
      dropLon: iiitLon,
      fare: elig2.fare || 0,
      mainFare: elig2.mainFare || 0,
      detourFare: elig2.detourFare || 0,
      detourDistance: elig2.detourDistance || 0,
    },
  });

  await recalculateRideRouteAndFares(testRide.id);

  const updatedB2 = await prisma.booking.findUnique({ where: { id: booking2.id } });
  const checkB1AfterP2 = await prisma.booking.findUnique({ where: { id: booking1.id } });

  assert((updatedB2?.detourFare || 0) > 0, `Passenger 2 charged detour fare: ₹${updatedB2?.detourFare?.toFixed(2)}`);
  assert(checkB1AfterP2?.detourFare === 0, `Passenger 1 (on-route) detour fare is STILL ₹0.00 (not affected by P2 detour)`);
  assert(
    Math.abs((checkB1AfterP2?.fare || 0) - b1FareAfterP1) < 0.1,
    `Passenger 1 fare remains stable (₹${checkB1AfterP2?.fare?.toFixed(2)} vs ₹${b1FareAfterP1.toFixed(2)}) — no detour leakage`
  );

  // --- TEST 4: Off-Route Drop-Off & Two Passengers Sharing a Detour ---
  console.log("\n--- TEST 4: Shared Detour Allocation (No Double-Counting) ---");
  // Ambi is an off-route location (~18.7610, 73.6820) ~1.5km from corridor
  // Passenger 3 and Passenger 4 both drop off at Ambi (locations within 100m of each other)
  const ambiLat1 = 18.7610;
  const ambiLon1 = 73.6820;
  const ambiLat2 = 18.7615; // 60m away in same neighborhood
  const ambiLon2 = 73.6822;

  // First, add Passenger 3 alone with Ambi drop-off
  const booking3 = await prisma.booking.create({
    data: {
      rideId: testRide.id,
      userId: p3User.id,
      status: "CONFIRMED",
      pickupLocation: "Talegaon Station",
      pickupLat: stationLat,
      pickupLon: stationLon,
      dropLocation: "Ambi Gate 1",
      dropLat: ambiLat1,
      dropLon: ambiLon1,
      fare: 0,
    },
  });

  await recalculateRideRouteAndFares(testRide.id);

  const b3Solo = await prisma.booking.findUnique({ where: { id: booking3.id } });
  const soloDetourFare = b3Solo?.detourFare || 0;
  const soloDetourDist = b3Solo?.detourDistance || 0;
  assert(soloDetourFare > 0, `Passenger 3 solo off-route drop detour fare: ₹${soloDetourFare.toFixed(2)} (${soloDetourDist.toFixed(0)}m)`);

  // Now, add Passenger 4 sharing the exact same Ambi detour
  const booking4 = await prisma.booking.create({
    data: {
      rideId: testRide.id,
      userId: p4User.id,
      status: "CONFIRMED",
      pickupLocation: "Talegaon Station",
      pickupLat: stationLat,
      pickupLon: stationLon,
      dropLocation: "Ambi Gate 2",
      dropLat: ambiLat2,
      dropLon: ambiLon2,
      fare: 0,
    },
  });

  await recalculateRideRouteAndFares(testRide.id);

  const b3Shared = await prisma.booking.findUnique({ where: { id: booking3.id } });
  const b4Shared = await prisma.booking.findUnique({ where: { id: booking4.id } });
  const checkB1AfterShared = await prisma.booking.findUnique({ where: { id: booking1.id } });

  const b3SharedDetour = b3Shared?.detourDistance || 0;
  const b4SharedDetour = b4Shared?.detourDistance || 0;
  const totalDetourChargedMeters = b3SharedDetour + b4SharedDetour;

  assert(
    Math.abs(b3SharedDetour - soloDetourDist / 2) < 50,
    `Passenger 3 detour distance halved when shared with Passenger 4 (${b3SharedDetour.toFixed(0)}m vs solo ${soloDetourDist.toFixed(0)}m)`
  );
  assert(
    Math.abs(b4SharedDetour - soloDetourDist / 2) < 50,
    `Passenger 4 detour distance allocated equal share (${b4SharedDetour.toFixed(0)}m)`
  );
  assert(
    Math.abs(totalDetourChargedMeters - soloDetourDist) < 100,
    `Total detour distance charged across P3 & P4 equals original detour (${totalDetourChargedMeters.toFixed(0)}m vs ${soloDetourDist.toFixed(0)}m) — NO DOUBLE COUNTING`
  );
  assert(
    checkB1AfterShared?.detourFare === 0,
    `Passenger 1 (on-route) STILL pays ₹0.00 detour after multiple other detours added`
  );

  // --- TEST 5: Baseline Route Persistence ---
  console.log("\n--- TEST 5: Baseline Route Persistence ---");
  const finalRide = await prisma.ride.findUnique({ where: { id: testRide.id } });
  assert(
    finalRide?.baseRouteGeometry === initialBaseGeometry,
    "Ride baseRouteGeometry is completely unchanged and identical to initial baseline"
  );
  assert(
    finalRide?.baseDistance === initialBaseDistance,
    `Ride baseDistance is permanently preserved (${finalRide?.baseDistance}m)`
  );
  assert(
    finalRide?.routeGeometry !== finalRide?.baseRouteGeometry,
    "Ride current routeGeometry has dynamically expanded to include all intermediate stops"
  );
  assert(
    (finalRide?.distance || 0) > (finalRide?.baseDistance || 0),
    `Total multi-stop route distance (${finalRide?.distance}m) reflects added passenger detours (> baseline ${finalRide?.baseDistance}m)`
  );

  // --- TEST 6: Routing Failure Fallback ---
  console.log("\n--- TEST 6: Routing Failure Fallback ---");
  const fallbackResult = await recalculateRideRouteAndFares("invalid-ride-id-99999");
  assert(!fallbackResult.success, "Handles invalid ride ID gracefully without throwing");

  // Clean up test bookings and test ride
  await prisma.booking.deleteMany({ where: { rideId: testRide.id } });
  await prisma.ride.delete({ where: { id: testRide.id } });
  console.log("\nCleaned up test data.");

  console.log("\n==================================================================");
  if (allPassed) {
    console.log("  🎉 ALL 6 DETOUR FARE & ROUTING TESTS PASSED PERFECTLY!");
  } else {
    console.error("  ❌ SOME TESTS FAILED. PLEASE REVIEW LOGS.");
  }
  console.log("==================================================================\n");

  if (!allPassed) {
    process.exit(1);
  }
}

runDetourFareTests()
  .catch((e) => {
    console.error("Test execution failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

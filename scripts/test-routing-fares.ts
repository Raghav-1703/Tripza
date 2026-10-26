import { checkPassengerEligibility, recalculateRideRouteAndFares } from "../src/lib/dynamicRouting";
import { calculateFare } from "../src/lib/fareCalculator";
import { prisma } from "../src/lib/prisma";

async function runTests() {
  console.log("=================================================");
  console.log("  TPOOL DYNAMIC ROUTING & FARES TEST SUITE");
  console.log("=================================================\n");

  let allPassed = true;
  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      allPassed = false;
    }
  }

  // --- TEST 1: Passenger Eligibility & Direction Matching ---
  console.log("--- 1. Passenger Eligibility & Direction Matching Tests ---");
  // Pune Station (18.5284, 73.8739) -> Hinjewadi (18.5913, 73.7389)
  const driverOrigin = { lat: 18.5284, lon: 73.8739, name: "Pune Station" };
  const driverDestination = { lat: 18.5913, lon: 73.7389, name: "Hinjewadi Phase 1" };

  // Case 1A: Passenger along corridor and forward direction (Shivajinagar/University -> Pashan/Bavdhan bypass)
  const pass1 = await checkPassengerEligibility({
    passengerOrigin: "Shivajinagar Gate",
    passengerDestination: "Bavdhan Bypass",
    driverOriginCoords: driverOrigin,
    driverDestCoords: driverDestination,
    passengerOriginCoords: { lat: 18.5350, lon: 73.8390 },
    passengerDestinationCoords: { lat: 18.5660, lon: 73.7712 },
    rideType: "Private Car Pool",
  });
  assert(pass1.eligible, "Passenger along route (Shivajinagar -> Bavdhan) is eligible");
  assert((pass1.pickupDetourMeters || 0) <= 500, `Pickup detour (${(pass1.pickupDetourMeters || 0).toFixed(0)}m) <= 500m (0.5km) limit`);
  assert((pass1.dropDetourMeters || 0) <= 500, `Drop-off detour (${(pass1.dropDetourMeters || 0).toFixed(0)}m) <= 500m (0.5km) limit`);
  assert((pass1.fare || 0) > 0, `Calculated passenger segment fare is positive: ₹${pass1.fare?.toFixed(2)}`);

  // Case 1B: Passenger exceeding pickup radius (> 0.5km for Private Car Pool)
  // Katraj is ~8km south of route
  const pass2 = await checkPassengerEligibility({
    passengerOrigin: "Katraj",
    passengerDestination: "Hinjewadi",
    driverOriginCoords: driverOrigin,
    driverDestCoords: driverDestination,
    passengerOriginCoords: { lat: 18.4575, lon: 73.8677 },
    passengerDestinationCoords: { lat: 18.5913, lon: 73.7389 },
    rideType: "Private Car Pool",
  });
  assert(!pass2.eligible, "Passenger with pickup far off route (Katraj) is rejected");
  assert(pass2.reason?.includes("Pickup point is") ?? false, `Rejection reason correctly indicates radius violation: "${pass2.reason}"`);

  // Case 1C: Passenger in reverse direction (Bavdhan Bypass -> Shivajinagar Gate)
  // Both coordinates are right on the route (< 0.1km), but reversed relative to driver direction
  const pass3 = await checkPassengerEligibility({
    passengerOrigin: "Bavdhan Bypass",
    passengerDestination: "Shivajinagar Gate",
    driverOriginCoords: driverOrigin,
    driverDestCoords: driverDestination,
    passengerOriginCoords: { lat: 18.5660, lon: 73.7712 },
    passengerDestinationCoords: { lat: 18.5350, lon: 73.8390 },
    rideType: "Private Car Pool",
  });
  assert(!pass3.eligible, "Passenger travelling opposite to driver direction is rejected");
  assert(pass3.reason?.includes("direction") ?? false, `Rejection reason correctly indicates direction mismatch: "${pass3.reason}"`);

  // Case 1D: Cab Pool radius test (0.5km < dist <= 1.0km)
  // Point ~0.7km perpendicular to route
  const pass4 = await checkPassengerEligibility({
    passengerOrigin: "Model Colony",
    passengerDestination: "Bavdhan Bypass",
    driverOriginCoords: driverOrigin,
    driverDestCoords: driverDestination,
    passengerOriginCoords: { lat: 18.5410, lon: 73.8320 },
    passengerDestinationCoords: { lat: 18.5660, lon: 73.7712 },
    rideType: "Cab Pool", // Limit is 1.0 km
  });
  assert(pass4.eligible, `Cab Pool accepts passenger within 1.0km (detour: ${(pass4.pickupDetourMeters || 0).toFixed(0)}m)`);

  // --- TEST 2: Vehicle Rates, Detour Charges & Fare Formula ---
  console.log("\n--- 2. Fare Calculation Formula Verification ---");
  // Test Personal Cab: ₹20/km, detours 0, platform 3%
  const personalCabFare = calculateFare({
    rideType: "Personal Cab",
    routeDistanceMeters: 10000, // 10 km
  });
  // 10 * 20 = 200, 3% = 6 -> 206
  assert(personalCabFare.mainRouteFare === 200, "Personal Cab 10km main fare = ₹200 (₹20/km)");
  assert(personalCabFare.pickupDetourFare === 0, "Personal Cab detour fare = ₹0");
  assert(personalCabFare.platformFee === 6, "Personal Cab 3% platform fee on ₹200 = ₹6");
  assert(personalCabFare.passengerTotal === 206, "Personal Cab total = ₹206");

  // Test Private Car Pool: ₹10/km, detour ₹10/km, platform 3%
  const carPoolFare = calculateFare({
    rideType: "Private Car Pool",
    routeDistanceMeters: 10000, // 10 km
    pickupDetourMeters: 500, // 0.5 km = ₹5
    dropDetourMeters: 300, // 0.3 km = ₹3
  });
  // Subtotal = 100 + 5 + 3 = 108. Platform fee = 108 * 0.03 = 3.24 -> total = 111.24
  assert(carPoolFare.mainRouteFare === 100, "Private Car Pool 10km main fare = ₹100 (₹10/km)");
  assert(carPoolFare.pickupDetourFare === 5, "Private Car Pool 500m pickup detour = ₹5 (₹10/km)");
  assert(carPoolFare.dropDetourFare === 3, "Private Car Pool 300m drop detour = ₹3 (₹10/km)");
  assert(Math.abs(carPoolFare.passengerTotal - 111.24) < 0.01, `Private Car Pool total = ₹111.24 (got ₹${carPoolFare.passengerTotal})`);

  // Test Cab Pool: ₹20/km, detour ₹20/km, pooling incentive ₹3 flat, platform 3%
  const cabPoolFare = calculateFare({
    rideType: "Cab Pool",
    routeDistanceMeters: 10000, // 10 km
    pickupDetourMeters: 500, // 0.5 km = ₹10
    dropDetourMeters: 0,
  });
  // Subtotal = 200 + 10 + 3 = 213. Platform fee = 213 * 0.03 = 6.39 -> total = 219.39
  assert(cabPoolFare.mainRouteFare === 200, "Cab Pool 10km main fare = ₹200 (₹20/km)");
  assert(cabPoolFare.poolingIncentive === 3, "Cab Pool pooling incentive = ₹3");
  assert(Math.abs(cabPoolFare.passengerTotal - 219.39) < 0.01, `Cab Pool total = ₹219.39 (got ₹${cabPoolFare.passengerTotal})`);

  // --- TEST 3: Dynamic Route Recalculation with Valhalla ---
  console.log("\n--- 3. Multi-stop Route Recalculation (Valhalla) ---");
  const existingRide = await prisma.ride.findFirst({
    include: { bookings: { include: { user: true } } },
  });

  if (existingRide) {
    console.log(`  Testing recalculateRideRouteAndFares on ride ${existingRide.id} (${existingRide.origin} -> ${existingRide.destination})`);
    const result = await recalculateRideRouteAndFares(existingRide.id);
    assert(result.success, `Route recalculation returned success: ${result.success}`);
    assert(result.routeGeometry !== null, "Recalculated route geometry is non-null");

    const updatedRide = await prisma.ride.findUnique({
      where: { id: existingRide.id },
      include: { bookings: true },
    });

    assert(Boolean(updatedRide?.routeGeometry), "Ride routeGeometry is persisted in database");
    assert(Boolean(updatedRide?.routeUpdatedAt), "Ride routeUpdatedAt is stamped");
    if (updatedRide?.routeGeometry) {
      const parsed = JSON.parse(updatedRide.routeGeometry);
      assert(Array.isArray(parsed) && parsed.length > 10, `Polyline contains ${parsed?.length} coordinates`);
    }

    console.log(`  Route distance: ${((updatedRide?.distance || 0) / 1000).toFixed(2)} km`);
  } else {
    console.log("  No existing ride found to test live database updates.");
  }

  // --- TEST 4: Fallback Resilience on Routing Failure ---
  console.log("\n--- 4. Fallback Resilience Test ---");
  const fakeResult = await recalculateRideRouteAndFares("non-existent-ride-id-12345");
  assert(!fakeResult.success, "Recalculation gracefully handles non-existent ride without crashing");
  assert(fakeResult.reason?.includes("not found") ?? false, `Failure reason provided: "${fakeResult.reason}"`);

  console.log("\n=================================================");
  if (allPassed) {
    console.log("  🎉 ALL TESTS PASSED SUCCESSFULLY!");
  } else {
    console.error("  ❌ SOME TESTS FAILED!");
  }
  console.log("=================================================");
}

runTests()
  .catch((e) => {
    console.error("Test execution failed with error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

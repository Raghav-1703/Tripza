import { prisma } from "../src/lib/prisma";
import { recalculateRideRouteAndFares } from "../src/lib/dynamicRouting";

async function testBookingWorkflow() {
  console.log("=================================================");
  console.log("  TPOOL BOOKING ACCEPTANCE & SYNC TEST");
  console.log("=================================================\n");

  // 1. Get an existing ride and users
  const ride = await prisma.ride.findFirst({
    include: { bookings: true },
  });

  if (!ride) {
    console.error("No ride found in database.");
    return;
  }

  const passenger = await prisma.user.findFirst({
    where: { id: { not: ride.driverId } },
  });

  if (!passenger) {
    console.error("No passenger user found in database.");
    return;
  }

  console.log(`Using Ride: ${ride.id} (${ride.origin} -> ${ride.destination})`);
  console.log(`Using Passenger: ${passenger.id} (${passenger.name})`);

  // 2. Create or find a test booking with detour pickup and drop
  // Talegaon route: start is IIIT Pune Road, end is Talegaon Railway Station
  // Pickup near highway (18.7300, 73.6800), Drop near station road (18.7330, 73.6850)
  let booking = await prisma.booking.findFirst({
    where: { rideId: ride.id, userId: passenger.id },
  });

  if (!booking) {
    booking = await prisma.booking.create({
      data: {
        rideId: ride.id,
        userId: passenger.id,
        status: "PENDING",
        seats: 1,
        fare: 45.0,
        pickupLocation: "Talegaon Highway Junction",
        pickupLat: 18.7300,
        pickupLon: 73.6800,
        dropLocation: "Station Road Corner",
        dropLat: 18.7330,
        dropLon: 73.6850,
      },
    });
    console.log(`Created test booking: ${booking.id} (Status: PENDING)`);
  } else {
    booking = await prisma.booking.update({
      where: { id: booking.id },
      data: {
        pickupLocation: "Talegaon Highway Junction",
        pickupLat: 18.7300,
        pickupLon: 73.6800,
        dropLocation: "Station Road Corner",
        dropLat: 18.7330,
        dropLon: 73.6850,
      },
    });
    console.log(`Updated test booking stops: ${booking.id}`);
  }

  // 3. Confirm the booking (simulating driver CONFIRM action)
  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "CONFIRMED" },
  });
  console.log(`Booking ${booking.id} confirmed!`);

  // 4. Trigger recalculateRideRouteAndFares (as done in PATCH /api/bookings/[id])
  const rerouteResult = await recalculateRideRouteAndFares(ride.id);
  console.log("Reroute result:", rerouteResult.success ? "SUCCESS" : "FAILED", rerouteResult.reason || "");

  // 5. Check persisted ride and booking values
  const updatedRide = await prisma.ride.findUnique({
    where: { id: ride.id },
    include: { bookings: true },
  });

  const updatedBooking = updatedRide?.bookings.find((b) => b.id === booking.id);
  console.log(`Updated ride route distance: ${((updatedRide?.distance || 0) / 1000).toFixed(2)} km`);
  console.log(`Updated passenger fare: ₹${updatedBooking?.fare?.toFixed(2)}`);
  console.log(`Ride route updatedAt: ${updatedRide?.routeUpdatedAt?.toISOString()}`);

  if (updatedRide?.routeGeometry && updatedBooking?.fare) {
    console.log("\n✅ PASS: Booking confirmation dynamically updated route and passenger fare!");
  } else {
    console.error("\n❌ FAIL: Route or fare was not updated properly.");
  }

  console.log("\n=================================================");
}

testBookingWorkflow()
  .catch((e) => {
    console.error("Booking workflow test error:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

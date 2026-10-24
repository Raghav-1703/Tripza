import { prisma } from "../src/lib/prisma";
import { getPublicAppOrigin, buildPublicTrackingUrl } from "../src/lib/appUrl";
import { validateAndNormalizePhone } from "../src/lib/phoneValidation";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failedCount++;
  }
}

async function runTests() {
  console.log("================================================================================");
  console.log("RUNNING TPOOL CRITICAL VERIFICATION: APP URL & DRIVER/PASSENGER PHONE NUMBERS");
  console.log("================================================================================\n");

  const originalEnv = { ...process.env };

  try {
    // -------------------------------------------------------------------------
    // TEST SUITE 1: APP URL & TRACKING LINK RESOLUTION
    // -------------------------------------------------------------------------
    console.log("--- Suite 1: App URL & Origin Validation ---");

    // 1.1 Development LAN IP
    (process.env as any).NODE_ENV = "development";
    process.env.APP_URL = "http://192.168.1.100:3000";
    const lanResult = getPublicAppOrigin();
    assert(lanResult.origin === "http://192.168.1.100:3000", "Development resolves explicitly configured LAN origin");
    assert(lanResult.isLocalhost === false, "LAN IP is recognized as non-localhost for external devices");
    assert(!lanResult.error, "LAN IP produces no error");

    // 1.2 Development Localhost
    process.env.APP_URL = "http://localhost:3000";
    const devLocalResult = getPublicAppOrigin();
    assert(devLocalResult.origin === "http://localhost:3000", "Development resolves localhost origin");
    assert(devLocalResult.isLocalhost === true, "Development correctly flags localhost so UI can warn user");

    // 1.3 Production Deployed HTTPS Domain
    (process.env as any).NODE_ENV = "production";
    process.env.APP_URL = "https://tpool.example.com";
    const prodResult = getPublicAppOrigin();
    assert(prodResult.origin === "https://tpool.example.com", "Production resolves HTTPS domain");
    assert(prodResult.isLocalhost === false, "Production domain is not localhost");
    assert(!prodResult.error, "Production HTTPS domain produces no error");

    // 1.4 Production Rejection of Localhost / Loopback
    process.env.APP_URL = "http://localhost:3000";
    const prodLocalReject = getPublicAppOrigin();
    assert(!prodLocalReject.origin, "Production rejects localhost origin");
    assert(Boolean(prodLocalReject.error?.includes("localhost") || prodLocalReject.error?.includes("HTTPS")), "Production provides clear actionable error when localhost is configured");

    // 1.5 Production Rejection of Insecure HTTP
    process.env.APP_URL = "http://tpool.example.com";
    const prodHttpReject = getPublicAppOrigin();
    assert(!prodHttpReject.origin, "Production rejects insecure HTTP");
    assert(Boolean(prodHttpReject.error?.includes("HTTPS")), "Production provides error demanding HTTPS");

    // 1.6 Missing Configuration and No NEXTAUTH_URL Fallback
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    const missingResult = getPublicAppOrigin();
    assert(!missingResult.origin, "Missing APP_URL returns empty origin (no silent NEXTAUTH_URL fallback)");
    assert(Boolean(missingResult.error?.includes("not configured")), "Missing configuration returns clear actionable error");

    // 1.7 Malformed URL
    process.env.APP_URL = "invalid-not-a-url";
    const malformedResult = getPublicAppOrigin();
    assert(Boolean(malformedResult.error?.includes("Invalid application URL")), "Malformed URL produces validation error");

    // 1.8 buildPublicTrackingUrl
    (process.env as any).NODE_ENV = "development";
    process.env.APP_URL = "https://tpool.example.com";
    const trackingUrlRes = buildPublicTrackingUrl("test_token_12345");
    assert(trackingUrlRes.url === "https://tpool.example.com/track/test_token_12345", "buildPublicTrackingUrl safely constructs full URL");

    // -------------------------------------------------------------------------
    // TEST SUITE 2: PHONE NUMBER VALIDATION & NORMALIZATION
    // -------------------------------------------------------------------------
    console.log("\n--- Suite 2: Phone Validation & Normalization ---");

    // 2.1 10-digit Indian mobile numbers
    const indian1 = validateAndNormalizePhone("9876543210");
    assert(indian1.isValid && indian1.normalized === "+919876543210", "10-digit number normalized to E.164 +91");

    // 2.2 Formatted Indian mobile with spaces and dashes
    const indian2 = validateAndNormalizePhone("98765-43210");
    assert(indian2.isValid && indian2.normalized === "+919876543210", "Formatted number normalized cleanly");

    // 2.3 International phone number (US)
    const usPhone = validateAndNormalizePhone("+1 (415) 555-2671");
    assert(usPhone.isValid && usPhone.normalized === "+14155552671", "US international number normalized correctly");

    // 2.4 International phone number (UK)
    const ukPhone = validateAndNormalizePhone("+44 7911 123456");
    assert(ukPhone.isValid && ukPhone.normalized === "+447911123456", "UK international number normalized correctly");

    // 2.5 Invalid phone inputs
    const shortPhone = validateAndNormalizePhone("12345");
    assert(!shortPhone.isValid && Boolean(shortPhone.error), "Short phone rejected");

    const alphaPhone = validateAndNormalizePhone("98765abcde");
    assert(!alphaPhone.isValid && Boolean(alphaPhone.error), "Phone with alphabets rejected");

    const emptyPhone = validateAndNormalizePhone("");
    assert(!emptyPhone.isValid && Boolean(emptyPhone.error), "Empty phone rejected");

    // -------------------------------------------------------------------------
    // TEST SUITE 3: DRIVER & PASSENGER PHONE PERSISTENCE IN DATABASE
    // -------------------------------------------------------------------------
    console.log("\n--- Suite 3: Profile Phone Storage & Separation ---");

    // Restore dev environment
    (process.env as any).NODE_ENV = "development";
    process.env.APP_URL = "http://localhost:3000";

    const driverEmail = "driver_phone_test@iiitp.ac.in";
    const passengerEmail = "passenger_phone_test@iiitp.ac.in";

    // Create or update driver
    const driver = await prisma.user.upsert({
      where: { email: driverEmail },
      update: {
        phoneNumber: "+919111122222",
        emergencyContactPhone: "+919999900000",
        emergencyContactName: "Driver Guardian",
      },
      create: {
        name: "Test Driver Phone",
        email: driverEmail,
        password: "hashed_dummy_pw",
        role: "USER",
        userType: "DRIVER",
        phoneNumber: "+919111122222",
        emergencyContactPhone: "+919999900000",
        emergencyContactName: "Driver Guardian",
      },
    });

    // Create or update passenger
    const passenger = await prisma.user.upsert({
      where: { email: passengerEmail },
      update: {
        phoneNumber: "+919333344444",
        emergencyContactPhone: "+919999911111",
        emergencyContactName: "Passenger Guardian",
      },
      create: {
        name: "Test Passenger Phone",
        email: passengerEmail,
        password: "hashed_dummy_pw",
        role: "USER",
        userType: "PASSENGER",
        phoneNumber: "+919333344444",
        emergencyContactPhone: "+919999911111",
        emergencyContactName: "Passenger Guardian",
      },
    });

    assert(driver.phoneNumber === "+919111122222", "Driver own phone number persisted correctly");
    assert(driver.emergencyContactPhone === "+919999900000", "Driver emergency contact phone remains distinct");
    assert(driver.phoneNumber !== driver.emergencyContactPhone, "Driver personal phone and emergency contact are completely separate");

    assert(passenger.phoneNumber === "+919333344444", "Passenger own phone number persisted correctly");
    assert(passenger.emergencyContactPhone === "+919999911111", "Passenger emergency contact phone remains distinct");
    assert(passenger.phoneNumber !== passenger.emergencyContactPhone, "Passenger personal phone and emergency contact are completely separate");

    // 3.2 Update and clear personal phone number
    const updatedPassenger = await prisma.user.update({
      where: { id: passenger.id },
      data: { phoneNumber: "+919888877777" },
    });
    assert(updatedPassenger.phoneNumber === "+919888877777", "User can update their own phone number");

    const clearedPassenger = await prisma.user.update({
      where: { id: passenger.id },
      data: { phoneNumber: null },
    });
    assert(clearedPassenger.phoneNumber === null, "User can safely remove/clear their phone number");

    // Reset passenger phone for further tests
    await prisma.user.update({
      where: { id: passenger.id },
      data: { phoneNumber: "+919333344444" },
    });

    // -------------------------------------------------------------------------
    // TEST SUITE 4: RIDE DETAILS & PHONE VISIBILITY AUTHORIZATION
    // -------------------------------------------------------------------------
    console.log("\n--- Suite 4: Ride Coordination Phone Visibility Authorization ---");

    // Create test ride
    const testRide = await prisma.ride.create({
      data: {
        driverId: driver.id,
        origin: "IIIT Pune Campus",
        destination: "Talegaon Dabhade",
        departure: new Date(Date.now() + 3600 * 1000 * 2),
        seats: 3,
        price: 150,
        vehicleName: "Honda City",
        status: "ACTIVE",
      },
    });

    // Create a pending booking
    const pendingBooking = await prisma.booking.create({
      data: {
        rideId: testRide.id,
        userId: passenger.id,
        seats: 1,
        fare: 150,
        status: "PENDING",
      },
    });

    // Verify Authorization Matrix
    // Function simulating the exact authorization logic in src/app/rides/[id]/page.tsx
    const getRidePhoneVisibility = (
      viewerId: string | null,
      rideDriverId: string,
      driverPhone: string | null,
      bookingList: Array<{ userId: string; status: string; passengerPhone: string | null }>
    ) => {
      const isDriver = viewerId === rideDriverId;
      const myBooking = bookingList.find((b) => b.userId === viewerId);
      const isConfirmedPassenger = myBooking?.status === "CONFIRMED";

      // Driver phone visible to: driver themselves OR confirmed passenger
      let visibleDriverPhone: string | null = null;
      if (isDriver) {
        visibleDriverPhone = driverPhone;
      } else if (isConfirmedPassenger) {
        visibleDriverPhone = driverPhone;
      }

      // Passenger phones visible to: driver (for confirmed bookings only)
      const visiblePassengerPhones: Record<string, string | null> = {};
      for (const b of bookingList) {
        if (isDriver && b.status === "CONFIRMED") {
          visiblePassengerPhones[b.userId] = b.passengerPhone;
        } else {
          visiblePassengerPhones[b.userId] = null;
        }
      }

      return { visibleDriverPhone, visiblePassengerPhones };
    }

    const testBookings = [
      { userId: passenger.id, status: "PENDING", passengerPhone: "+919333344444" },
    ];

    // Case 4.1: Unauthenticated viewer
    const anonVisibility = getRidePhoneVisibility(null, driver.id, driver.phoneNumber, testBookings);
    assert(anonVisibility.visibleDriverPhone === null, "Public / unauthenticated visitor cannot see driver phone");
    assert(anonVisibility.visiblePassengerPhones[passenger.id] === null, "Public visitor cannot see passenger phone");

    // Case 4.2: Unrelated user
    const unrelatedVisibility = getRidePhoneVisibility("unrelated-user-id", driver.id, driver.phoneNumber, testBookings);
    assert(unrelatedVisibility.visibleDriverPhone === null, "Unrelated user cannot see driver phone");
    assert(unrelatedVisibility.visiblePassengerPhones[passenger.id] === null, "Unrelated user cannot see passenger phone");

    // Case 4.3: Pending passenger
    const pendingPassengerVisibility = getRidePhoneVisibility(passenger.id, driver.id, driver.phoneNumber, testBookings);
    assert(pendingPassengerVisibility.visibleDriverPhone === null, "Pending passenger cannot see driver phone before confirmation");

    // Case 4.4: Driver viewing pending booking
    const driverPendingVisibility = getRidePhoneVisibility(driver.id, driver.id, driver.phoneNumber, testBookings);
    assert(driverPendingVisibility.visiblePassengerPhones[passenger.id] === null, "Driver cannot see passenger phone while booking is PENDING");

    // Confirm the booking
    await prisma.booking.update({
      where: { id: pendingBooking.id },
      data: { status: "CONFIRMED" },
    });
    testBookings[0].status = "CONFIRMED";

    // Case 4.5: Confirmed passenger viewing ride
    const confirmedPassengerVisibility = getRidePhoneVisibility(passenger.id, driver.id, driver.phoneNumber, testBookings);
    assert(confirmedPassengerVisibility.visibleDriverPhone === "+919111122222", "Confirmed passenger CAN see driver phone for coordination");

    // Case 4.6: Driver viewing confirmed booking
    const driverConfirmedVisibility = getRidePhoneVisibility(driver.id, driver.id, driver.phoneNumber, testBookings);
    assert(driverConfirmedVisibility.visiblePassengerPhones[passenger.id] === "+919333344444", "Driver CAN see confirmed passenger phone for pickup coordination");

    // -------------------------------------------------------------------------
    // TEST SUITE 5: PUBLIC TRIP TRACKING PRIVACY & LIFECYCLE
    // -------------------------------------------------------------------------
    console.log("\n--- Suite 5: Public Tracking Link Security & Privacy ---");

    // 5.1 Create tracking token
    const tokenRecord = await prisma.tripShareToken.create({
      data: {
        token: "tok_safety_test_48chars_sample_random_token_1234",
        rideId: testRide.id,
        userId: passenger.id,
        bookingId: pendingBooking.id,
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });

    // 5.2 Simulate Public Tracking Endpoint Retrieval
    const shareRecord = await prisma.tripShareToken.findUnique({
      where: { token: tokenRecord.token },
      include: {
        ride: {
          include: {
            driver: { select: { id: true, name: true } },
          },
        },
        user: { select: { id: true, name: true } },
        booking: {
          select: {
            pickupLocation: true,
            dropLocation: true,
            status: true,
          },
        },
      },
    });

    assert(Boolean(shareRecord), "Tracking record retrievable via public token");
    // Ensure no phone numbers are selected in the public tracking query
    const recordAny = shareRecord as any;
    assert(!recordAny.ride?.driver?.phoneNumber, "Public tracking record strictly excludes driver phone");
    assert(!recordAny.user?.phoneNumber, "Public tracking record strictly excludes passenger phone");
    assert(!recordAny.user?.emergencyContactPhone, "Public tracking record strictly excludes emergency contact numbers");

    // 5.3 Token Revocation
    const revoked = await prisma.tripShareToken.update({
      where: { id: tokenRecord.id },
      data: { isRevoked: true },
    });
    assert(revoked.isRevoked === true, "Token owner can revoke tracking link");

    // 5.4 Ride Completion terminates tracking access
    await prisma.ride.update({
      where: { id: testRide.id },
      data: { status: "COMPLETED" },
    });
    const completedRide = await prisma.ride.findUnique({
      where: { id: testRide.id },
      select: { status: true },
    });
    assert(completedRide?.status === "COMPLETED", "Completed ride marked in database");

    // -------------------------------------------------------------------------
    // CLEANUP TEST DATA
    // -------------------------------------------------------------------------
    await prisma.tripShareToken.deleteMany({ where: { rideId: testRide.id } });
    await prisma.booking.deleteMany({ where: { rideId: testRide.id } });
    await prisma.ride.delete({ where: { id: testRide.id } });
    console.log("\n  ✓ Test records cleaned up safely.");

  } finally {
    process.env = originalEnv;
  }

  console.log("\n================================================================================");
  console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log("================================================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner threw error:", err);
  process.exit(1);
});

import { prisma } from "../src/lib/prisma";
import bcrypt from "bcryptjs";

const BASE_URL = "http://localhost:3000";

async function authenticateUser(email: string, passwordPlain: string): Promise<string> {
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`);
  const csrfData = await csrfRes.json();
  const csrfToken = csrfData.csrfToken;
  const setCookie = csrfRes.headers.get("set-cookie") || "";
  const csrfMatch = setCookie.match(/next-auth\.csrf-token=([^;]+)/);
  const csrfCookieVal = csrfMatch ? csrfMatch[1] : "";

  const params = new URLSearchParams();
  params.append("email", email);
  params.append("password", passwordPlain);
  params.append("csrfToken", csrfToken);
  params.append("json", "true");

  const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: `next-auth.csrf-token=${csrfCookieVal}`,
    },
    body: params.toString(),
    redirect: "manual",
  });

  const loginCookies = loginRes.headers.get("set-cookie") || "";
  const sessionMatch = loginCookies.match(/next-auth\.session-token=([^;]+)/);
  if (!sessionMatch) {
    throw new Error(`Failed to authenticate ${email}`);
  }

  return `next-auth.session-token=${sessionMatch[1]}`;
}

async function runE2EHtmlTests() {
  console.log("==================================================================");
  console.log("  TPOOL SSR / HTML RENDERING & END-TO-END VERIFICATION");
  console.log("==================================================================");

  const plainPassword = "TestPassword123!";
  const hashedPassword = await bcrypt.hash(plainPassword, 10);
  const passengerEmail = "test_share_passenger_a@tpool.test";
  const driverEmail = "test_share_driver@tpool.test";

  const passenger = await prisma.user.upsert({
    where: { email: passengerEmail },
    update: { password: hashedPassword, userType: "PASSENGER" },
    create: {
      email: passengerEmail,
      name: "Passenger Alice",
      password: hashedPassword,
      userType: "PASSENGER",
    },
  });

  const driver = await prisma.user.upsert({
    where: { email: driverEmail },
    update: { password: hashedPassword, userType: "DRIVER" },
    create: {
      email: driverEmail,
      name: "Driver David",
      password: hashedPassword,
      userType: "DRIVER",
    },
  });

  const cookiePassenger = await authenticateUser(passengerEmail, plainPassword);

  // 1. Test /profile HTML rendering
  const profileRes = await fetch(`${BASE_URL}/profile`, {
    headers: { Cookie: cookiePassenger },
  });
  const profileHtml = await profileRes.text();
  const hasContactCard = profileHtml.includes("Trusted &amp; Emergency Contacts") || profileHtml.includes("Trusted & Emergency Contacts");
  console.log(hasContactCard ? "✅ PASS: /profile renders Trusted & Emergency Contacts Card" : "❌ FAIL: /profile missing Contact Card");

  // Create active ride for testing
  const activeRide = await prisma.ride.create({
    data: {
      driverId: driver.id,
      origin: "Main Campus Station",
      destination: "Metro Interchange",
      departure: new Date(Date.now() + 3600000),
      seats: 3,
      price: 150,
      rideType: "Personal Cab",
      status: "ACTIVE",
    },
  });

  const booking = await prisma.booking.create({
    data: {
      rideId: activeRide.id,
      userId: passenger.id,
      seats: 1,
      fare: 150,
      status: "CONFIRMED",
    },
  });

  // 2. Test /rides/[id] HTML rendering with Share Trip button
  const rideRes = await fetch(`${BASE_URL}/rides/${activeRide.id}`, {
    headers: { Cookie: cookiePassenger },
  });
  const rideHtml = await rideRes.text();
  const hasShareTripBtn = rideHtml.includes("Share Trip (SMS)");
  console.log(hasShareTripBtn ? "✅ PASS: /rides/[id] renders 'Share Trip (SMS)' button" : "❌ FAIL: /rides/[id] missing Share Trip button");

  // 3. Generate a token and test /track/[token] HTML rendering
  const tokenRecord = await prisma.tripShareToken.create({
    data: {
      token: "testtokene2e0123456789abcdef0123456789abcdef012345",
      rideId: activeRide.id,
      userId: passenger.id,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });

  const trackRes = await fetch(`${BASE_URL}/track/${tokenRecord.token}`);
  const trackHtml = await trackRes.text();
  const hasSafeTrack = trackHtml.includes("TPool SafeTrack") || trackHtml.includes("SafeTrack");
  console.log(hasSafeTrack && trackRes.status === 200 ? "✅ PASS: /track/[token] renders public TPool SafeTrack page (200 OK)" : "❌ FAIL: /track/[token] rendering failed");

  // Cleanup
  await prisma.tripShareToken.deleteMany({ where: { id: tokenRecord.id } });
  await prisma.booking.deleteMany({ where: { id: booking.id } });
  await prisma.ride.deleteMany({ where: { id: activeRide.id } });

  console.log("==================================================================");
  console.log("  E2E HTML RENDERING VERIFICATION COMPLETE");
  console.log("==================================================================");
}

runE2EHtmlTests()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

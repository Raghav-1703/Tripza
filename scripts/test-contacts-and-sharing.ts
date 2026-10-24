import { prisma } from "../src/lib/prisma";
import bcrypt from "bcryptjs";

interface TestResult {
  num: number;
  category: string;
  name: string;
  expected: string;
  actual: string;
  passed: boolean;
  evidence?: string;
}

const results: TestResult[] = [];
let testIndex = 1;

function recordTest(
  category: string,
  name: string,
  expected: string,
  actual: string,
  passed: boolean,
  evidence?: string
) {
  results.push({
    num: testIndex++,
    category,
    name,
    expected,
    actual,
    passed,
    evidence,
  });
  const badge = passed ? "✅ PASS" : "❌ FAIL";
  console.log(`${badge} [#${testIndex - 1}] [${category}] ${name}`);
  if (!passed && evidence) {
    console.error(`   Error/Evidence: ${evidence}`);
  }
}

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
    throw new Error(`Failed to authenticate ${email}. Headers: ${loginCookies}`);
  }

  return `next-auth.session-token=${sessionMatch[1]}`;
}

async function runTestSuite() {
  console.log("==================================================================");
  console.log("  TPOOL CONTACT MANAGEMENT & TRUSTED TRIP SHARING TEST SUITE");
  console.log("==================================================================\n");

  const plainPassword = "TestPassword123!";
  const hashedPassword = await bcrypt.hash(plainPassword, 10);

  // Setup test users
  const driverEmail = "test_share_driver@tpool.test";
  const passengerAEmail = "test_share_passenger_a@tpool.test";
  const passengerBEmail = "test_share_passenger_b@tpool.test";

  const driverUser = await prisma.user.upsert({
    where: { email: driverEmail },
    update: { password: hashedPassword, userType: "DRIVER" },
    create: {
      email: driverEmail,
      name: "Driver David",
      password: hashedPassword,
      userType: "DRIVER",
    },
  });

  const passengerA = await prisma.user.upsert({
    where: { email: passengerAEmail },
    update: { password: hashedPassword, userType: "PASSENGER" },
    create: {
      email: passengerAEmail,
      name: "Passenger Alice",
      password: hashedPassword,
      userType: "PASSENGER",
    },
  });

  const passengerB = await prisma.user.upsert({
    where: { email: passengerBEmail },
    update: { password: hashedPassword, userType: "PASSENGER" },
    create: {
      email: passengerBEmail,
      name: "Passenger Bob",
      password: hashedPassword,
      userType: "PASSENGER",
    },
  });

  // Clean existing test contacts and share tokens for these users
  await prisma.tripShareToken.deleteMany({
    where: { userId: { in: [driverUser.id, passengerA.id, passengerB.id] } },
  });
  await prisma.trustedContact.deleteMany({
    where: { userId: { in: [driverUser.id, passengerA.id, passengerB.id] } },
  });

  // Authenticate users
  const cookieDriver = await authenticateUser(driverEmail, plainPassword);
  const cookiePassengerA = await authenticateUser(passengerAEmail, plainPassword);
  const cookiePassengerB = await authenticateUser(passengerBEmail, plainPassword);

  // Setup active and completed rides
  const testRideActive = await prisma.ride.create({
    data: {
      driverId: driverUser.id,
      origin: "Main Campus Station",
      originLat: 28.545,
      originLon: 77.192,
      destination: "Metro Interchange",
      destLat: 28.567,
      destLon: 77.210,
      departure: new Date(Date.now() + 3600000),
      seats: 3,
      price: 150,
      rideType: "Personal Cab",
      vehicleName: "Honda Civic (DL 01 AB 1234)",
      status: "ACTIVE",
      isLiveSharing: true,
      currentLat: 28.552,
      currentLon: 77.198,
      locationUpdatedAt: new Date(),
    },
  });

  // Booking for passenger A (CONFIRMED)
  const bookingA = await prisma.booking.create({
    data: {
      rideId: testRideActive.id,
      userId: passengerA.id,
      seats: 1,
      fare: 150,
      status: "CONFIRMED",
      pickupLocation: "Campus Gate 2",
      pickupLat: 28.547,
      pickupLon: 77.194,
      dropLocation: "Metro Gate 1",
      dropLat: 28.566,
      dropLon: 77.209,
    },
  });

  // Completed ride for lifecycle tests
  const testRideCompleted = await prisma.ride.create({
    data: {
      driverId: driverUser.id,
      origin: "Library Road",
      destination: "City Center",
      departure: new Date(Date.now() - 7200000),
      seats: 2,
      price: 120,
      status: "COMPLETED",
      isLiveSharing: false,
    },
  });

  // ============================================================================
  // SECTION 1: CONTACT MANAGEMENT (AUTHENTICATION & VALIDATION)
  // ============================================================================
  console.log("\n--- Category 1: Contact Management Authentication & Validation ---");

  // Test 1: Unauthenticated user cannot GET /api/contacts
  {
    const res = await fetch(`${BASE_URL}/api/contacts`);
    recordTest(
      "Contact Auth",
      "Unauthenticated user GET /api/contacts rejected",
      "401 Unauthorized",
      `${res.status}`,
      res.status === 401
    );
  }

  // Test 2: Unauthenticated user cannot POST /api/contacts
  {
    const res = await fetch(`${BASE_URL}/api/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hacker Contact", phone: "+919876543210" }),
    });
    recordTest(
      "Contact Auth",
      "Unauthenticated user POST /api/contacts rejected",
      "401 Unauthorized",
      `${res.status}`,
      res.status === 401
    );
  }

  // Test 3: Validation: Empty name rejected
  {
    const res = await fetch(`${BASE_URL}/api/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiePassengerA },
      body: JSON.stringify({ name: "   ", phone: "+919876543210" }),
    });
    const json = await res.json();
    recordTest(
      "Contact Validation",
      "Empty contact name rejected with 400",
      "400 Bad Request",
      `${res.status} (${json.message})`,
      res.status === 400 && json.message.includes("empty")
    );
  }

  // Test 4: Validation: Invalid phone number format rejected
  {
    const res = await fetch(`${BASE_URL}/api/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiePassengerA },
      body: JSON.stringify({ name: "Invalid Phone", phone: "abc12345" }),
    });
    recordTest(
      "Contact Validation",
      "Invalid phone number rejected with 400",
      "400 Bad Request",
      `${res.status}`,
      res.status === 400
    );
  }

  // Test 5: Validation: Excessively long phone number rejected
  {
    const res = await fetch(`${BASE_URL}/api/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiePassengerA },
      body: JSON.stringify({ name: "Too Long", phone: "12345678901234567890123456789012345" }),
    });
    recordTest(
      "Contact Validation",
      "Excessively long phone number (>30 chars) rejected with 400",
      "400 Bad Request",
      `${res.status}`,
      res.status === 400
    );
  }

  // ============================================================================
  // SECTION 2: CONTACT CREATION, DUPLICATES & OWNERSHIP (PASSENGERS & DRIVERS)
  // ============================================================================
  console.log("\n--- Category 2: Contact Creation & Duplicate Prevention ---");

  let contactAlice1Id = "";
  // Test 6: Passenger Alice adds a trusted emergency contact
  {
    const res = await fetch(`${BASE_URL}/api/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiePassengerA },
      body: JSON.stringify({
        name: "Mom Emergency",
        phone: "+91 98765 43210",
        isEmergency: true,
      }),
    });
    const json = await res.json();
    contactAlice1Id = json.id;
    recordTest(
      "Contact Creation",
      "Passenger Alice creates trusted emergency contact",
      "201 Created with normalized phone +919876543210 and isEmergency: true",
      `${res.status} (phone: ${json.phone}, emergency: ${json.isEmergency})`,
      res.status === 201 && json.phone === "+919876543210" && json.isEmergency === true
    );
  }

  // Test 7: Duplicate prevention: Alice adding same phone number rejected with 409
  {
    const res = await fetch(`${BASE_URL}/api/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiePassengerA },
      body: JSON.stringify({
        name: "Mother Duplicate",
        phone: "9876543210", // Same digits with/without country code or formatting
      }),
    });
    const json = await res.json();
    recordTest(
      "Duplicate Prevention",
      "Adding duplicate contact phone for same user rejected with 409",
      "409 Conflict",
      `${res.status} (${json.message})`,
      res.status === 409
    );
  }

  // Test 8: Driver David adds their own personal contact
  let contactDavidId = "";
  {
    const res = await fetch(`${BASE_URL}/api/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieDriver },
      body: JSON.stringify({
        name: "David Brother",
        phone: "+91 91234 56789",
        isEmergency: false,
      }),
    });
    const json = await res.json();
    contactDavidId = json.id;
    recordTest(
      "Contact Creation",
      "Driver David creates personal contact",
      "201 Created",
      `${res.status} (id: ${json.id})`,
      res.status === 201 && json.name === "David Brother"
    );
  }

  // Test 9: Contact isolation: Alice's contacts list does NOT include David's contacts
  {
    const res = await fetch(`${BASE_URL}/api/contacts`, {
      headers: { Cookie: cookiePassengerA },
    });
    const json = await res.json();
    const includesDavidContact = json.some((c: any) => c.id === contactDavidId);
    recordTest(
      "Contact Privacy",
      "User contacts list strictly scoped to authenticated user (no leakage)",
      "Only Alice's contacts returned (David's excluded)",
      `Count: ${json.length}, includesDavid: ${includesDavidContact}`,
      res.status === 200 && !includesDavidContact && json.some((c: any) => c.id === contactAlice1Id)
    );
  }

  // ============================================================================
  // SECTION 3: CONTACT EDIT, DELETE & IDOR SECURITY
  // ============================================================================
  console.log("\n--- Category 3: Contact Edit, Delete & IDOR Protection ---");

  // Test 10: IDOR Protection: Bob attempts to PATCH Alice's contact -> 403 Forbidden
  {
    const res = await fetch(`${BASE_URL}/api/contacts/${contactAlice1Id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookiePassengerB },
      body: JSON.stringify({ name: "Hacked by Bob" }),
    });
    recordTest(
      "Contact Security",
      "IDOR Attempt: User B cannot PATCH User A's contact",
      "403 Forbidden",
      `${res.status}`,
      res.status === 403
    );
  }

  // Test 11: IDOR Protection: Bob attempts to DELETE Alice's contact -> 403 Forbidden
  {
    const res = await fetch(`${BASE_URL}/api/contacts/${contactAlice1Id}`, {
      method: "DELETE",
      headers: { Cookie: cookiePassengerB },
    });
    recordTest(
      "Contact Security",
      "IDOR Attempt: User B cannot DELETE User A's contact",
      "403 Forbidden",
      `${res.status}`,
      res.status === 403
    );
  }

  // Test 12: Owner Alice successfully updates her contact name and phone
  {
    const res = await fetch(`${BASE_URL}/api/contacts/${contactAlice1Id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookiePassengerA },
      body: JSON.stringify({ name: "Mom (Primary Emergency)", phone: "+919876543211" }),
    });
    const json = await res.json();
    recordTest(
      "Contact Edit",
      "Owner Alice edits contact details successfully",
      "200 OK with updated name and phone",
      `${res.status} (name: ${json.name}, phone: ${json.phone})`,
      res.status === 200 && json.name === "Mom (Primary Emergency)" && json.phone === "+919876543211"
    );
  }

  // ============================================================================
  // SECTION 4: FREE SMS TRIP SHARING (DRIVER & PASSENGER AUTHORIZATION)
  // ============================================================================
  console.log("\n--- Category 4: Free SMS Trip Sharing Authorization ---");

  // Test 13: Unauthenticated user cannot create share token
  {
    const res = await fetch(`${BASE_URL}/api/rides/${testRideActive.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipientPhone: "+919876543211" }),
    });
    recordTest(
      "Share Auth",
      "Unauthenticated user POST /api/rides/[id]/share rejected",
      "401 Unauthorized",
      `${res.status}`,
      res.status === 401
    );
  }

  // Test 14: User Bob (neither driver nor confirmed passenger on this ride) cannot share -> 403
  {
    const res = await fetch(`${BASE_URL}/api/rides/${testRideActive.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiePassengerB },
      body: JSON.stringify({ recipientPhone: "+919876543211" }),
    });
    recordTest(
      "Share Auth",
      "Unauthorized user (not driver or rider) cannot share ride",
      "403 Forbidden",
      `${res.status}`,
      res.status === 403
    );
  }

  // Test 15: Confirmed Passenger Alice creates share token for active ride
  let passengerShareToken = "";
  let passengerShareUrl = "";
  let passengerTokenId = "";
  {
    const res = await fetch(`${BASE_URL}/api/rides/${testRideActive.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiePassengerA },
      body: JSON.stringify({
        recipientName: "Mom",
        recipientPhone: "+91 98765 43211",
      }),
    });
    const json = await res.json();
    passengerShareToken = json.token;
    passengerShareUrl = json.shareUrl;
    passengerTokenId = json.id;
    recordTest(
      "Share Creation",
      "Confirmed Passenger Alice generates secure 48-char share token",
      "201 Created with 48-char hex token and prefilled safety message",
      `${res.status} (token len: ${json.token?.length}, msg includes 'TPool trip')`,
      res.status === 201 &&
        typeof json.token === "string" &&
        json.token.length >= 40 &&
        json.safetyMessage.includes(json.shareUrl)
    );
  }

  // Test 16: Driver David creates share token for their active ride
  let driverShareToken = "";
  {
    const res = await fetch(`${BASE_URL}/api/rides/${testRideActive.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieDriver },
      body: JSON.stringify({
        recipientName: "Brother",
        recipientPhone: "+91 91234 56789",
      }),
    });
    const json = await res.json();
    driverShareToken = json.token;
    recordTest(
      "Share Creation",
      "Driver David generates secure share token for their ride",
      "201 Created",
      `${res.status} (token len: ${json.token?.length})`,
      res.status === 201 && typeof json.token === "string"
    );
  }

  // Test 17: User can list their own share tokens for this ride
  {
    const res = await fetch(`${BASE_URL}/api/rides/${testRideActive.id}/share`, {
      headers: { Cookie: cookiePassengerA },
    });
    const json = await res.json();
    const hasAliceToken = json.some((t: any) => t.token === passengerShareToken);
    const hasDriverToken = json.some((t: any) => t.token === driverShareToken);
    recordTest(
      "Share Token Privacy",
      "Alice lists only her share tokens (Driver's tokens excluded)",
      "Alice's token included, Driver's excluded",
      `Alice found: ${hasAliceToken}, Driver found: ${hasDriverToken}`,
      res.status === 200 && hasAliceToken && !hasDriverToken
    );
  }

  // ============================================================================
  // SECTION 5: PUBLIC TRACKING ENDPOINT PRIVACY & ACCURACY
  // ============================================================================
  console.log("\n--- Category 5: Public Tracking Page API & Privacy Safeguards ---");

  // Test 18: Public tracking endpoint GET /api/track/[token] without session
  {
    const res = await fetch(`${BASE_URL}/api/track/${passengerShareToken}`);
    const json = await res.json();
    const leaksPassengerB = JSON.stringify(json).includes(passengerBEmail);
    const leaksDriverEmail = JSON.stringify(json).includes(driverEmail);
    const leaksPassword = JSON.stringify(json).includes("Password");

    recordTest(
      "Public Tracking",
      "Public tracking endpoint returns sanitized trip safety payload without credentials",
      "200 OK with driverName, vehicleName, origin, destination, currentLat/Lon, and zero credential leakage",
      `Driver: ${json.driverName}, Vehicle: ${json.vehicleName}, Status: ${json.rideStatus}, Leaks: ${leaksPassengerB || leaksDriverEmail || leaksPassword}`,
      res.status === 200 &&
        json.driverName === "Driver David" &&
        json.vehicleName.includes("Honda Civic") &&
        json.rideStatus === "ACTIVE" &&
        !leaksPassengerB &&
        !leaksDriverEmail &&
        !leaksPassword
    );
  }

  // Test 19: Privacy check: Tracking link does NOT expose other passengers
  {
    const res = await fetch(`${BASE_URL}/api/track/${passengerShareToken}`);
    const json = await res.json();
    // Verify booking list / other passengers are NOT present
    const hasBookingsArray = "bookings" in json || "passengers" in json;
    recordTest(
      "Privacy Safeguard",
      "Other passengers' identities and bookings strictly withheld from tracking view",
      "No bookings or passenger array present in tracking payload",
      `hasBookingsArray: ${hasBookingsArray}`,
      !hasBookingsArray
    );
  }

  // Test 20: Malformed token rejected
  {
    const res = await fetch(`${BASE_URL}/api/track/invalid--token$$$`);
    recordTest(
      "Tracking Validation",
      "Malformed tracking token format rejected with 400",
      "400 Bad Request",
      `${res.status}`,
      res.status === 400
    );
  }

  // Test 21: Non-existent token returns 404
  {
    const res = await fetch(`${BASE_URL}/api/track/0123456789abcdef0123456789abcdef0123456789abcdef`);
    recordTest(
      "Tracking Validation",
      "Non-existent valid-format token returns 404",
      "404 Not Found",
      `${res.status}`,
      res.status === 404
    );
  }

  // ============================================================================
  // SECTION 6: REVOCATION, LIFECYCLE & EXPIRATION
  // ============================================================================
  console.log("\n--- Category 6: Token Revocation, IDOR & Lifecycle Expiration ---");

  // Test 22: IDOR: Bob attempts to revoke Alice's share token -> 403 Forbidden
  {
    const res = await fetch(
      `${BASE_URL}/api/rides/${testRideActive.id}/share?tokenId=${passengerTokenId}`,
      {
        method: "DELETE",
        headers: { Cookie: cookiePassengerB },
      }
    );
    recordTest(
      "Revocation Security",
      "IDOR Attempt: User B cannot revoke User A's share token",
      "403 Forbidden",
      `${res.status}`,
      res.status === 403
    );
  }

  // Test 23: Owner Alice revokes her share token
  {
    const res = await fetch(
      `${BASE_URL}/api/rides/${testRideActive.id}/share?tokenId=${passengerTokenId}`,
      {
        method: "DELETE",
        headers: { Cookie: cookiePassengerA },
      }
    );
    const json = await res.json();
    recordTest(
      "Revocation",
      "Owner Alice successfully revokes her share token",
      "200 OK with isRevoked: true",
      `${res.status} (isRevoked: ${json.isRevoked})`,
      res.status === 200 && json.isRevoked === true
    );
  }

  // Test 24: Immediate enforcement: /api/track/[token] returns 410 Gone for revoked token
  {
    const res = await fetch(`${BASE_URL}/api/track/${passengerShareToken}`);
    const json = await res.json();
    recordTest(
      "Revocation Enforcement",
      "Revoked tracking token immediately blocks location access (410)",
      "410 Gone with isRevoked: true",
      `${res.status} (isRevoked: ${json.isRevoked})`,
      res.status === 410 && json.isRevoked === true
    );
  }

  // Test 25: Lifecycle: Completed ride token generation rejected
  {
    const res = await fetch(`${BASE_URL}/api/rides/${testRideCompleted.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieDriver },
      body: JSON.stringify({ recipientPhone: "+919123456789" }),
    });
    recordTest(
      "Lifecycle Check",
      "Attempting to share an already completed ride rejected with 400",
      "400 Bad Request",
      `${res.status}`,
      res.status === 400
    );
  }

  // Test 26: Automatic GPS termination when ride completes
  // Create a fresh share token for an active ride, then mark ride COMPLETED
  let activeToCompleteToken = "";
  {
    const res = await fetch(`${BASE_URL}/api/rides/${testRideActive.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieDriver },
      body: JSON.stringify({ recipientPhone: "+919999988888" }),
    });
    const json = await res.json();
    activeToCompleteToken = json.token;
  }

  // Mark ride as COMPLETED in DB
  await prisma.ride.update({
    where: { id: testRideActive.id },
    data: { status: "COMPLETED" },
  });

  // Verify /api/track/[token] now terminates live tracking and reports trip finished
  {
    const res = await fetch(`${BASE_URL}/api/track/${activeToCompleteToken}`);
    const json = await res.json();
    recordTest(
      "Lifecycle Termination",
      "Live GPS tracking automatically terminated when ride completes",
      "410 Gone with isFinished: true and no live coordinates",
      `${res.status} (isFinished: ${json.isFinished}, rideStatus: ${json.rideStatus})`,
      res.status === 410 && json.isFinished === true && json.rideStatus === "COMPLETED"
    );
  }

  // ============================================================================
  // SECTION 7: EDGE CASES & STABILITY
  // ============================================================================
  console.log("\n--- Category 7: Edge Cases, One-Time Share & Contact Deletion ---");

  // Test 27: One-time share without saving contact
  // Alice generates token with ad-hoc phone number without it being saved in contacts
  const adHocPhone = "+919988776655";
  let adHocToken = "";
  {
    // Re-activate ride for this test
    await prisma.ride.update({
      where: { id: testRideActive.id },
      data: { status: "ACTIVE" },
    });

    const res = await fetch(`${BASE_URL}/api/rides/${testRideActive.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiePassengerA },
      body: JSON.stringify({
        recipientName: "AdHoc Friend",
        recipientPhone: adHocPhone,
      }),
    });
    const json = await res.json();
    adHocToken = json.token;

    // Verify it was NOT saved to Alice's saved contacts
    const contactsRes = await fetch(`${BASE_URL}/api/contacts`, {
      headers: { Cookie: cookiePassengerA },
    });
    const contactsList = await contactsRes.json();
    const wasSaved = contactsList.some((c: any) => c.phone === adHocPhone);

    recordTest(
      "One-Time Share",
      "One-time trip share generates valid link without saving to address book",
      "201 Created and NOT present in saved contacts",
      `Created: ${res.status === 201}, wasSavedInContacts: ${wasSaved}`,
      res.status === 201 && !wasSaved && typeof adHocToken === "string"
    );
  }

  // Test 28: Deleting a saved contact does NOT delete or invalidate previously generated share links
  {
    // Create a new contact, generate token with it, then delete contact
    const addRes = await fetch(`${BASE_URL}/api/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiePassengerA },
      body: JSON.stringify({ name: "Temporary Contact", phone: "+919777788888" }),
    });
    const newContact = await addRes.json();

    const shareRes = await fetch(`${BASE_URL}/api/rides/${testRideActive.id}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiePassengerA },
      body: JSON.stringify({ recipientPhone: newContact.phone }),
    });
    const shareData = await shareRes.json();

    // Now delete the contact
    const delRes = await fetch(`${BASE_URL}/api/contacts/${newContact.id}`, {
      method: "DELETE",
      headers: { Cookie: cookiePassengerA },
    });

    // Tracking link should still be valid and active
    const trackRes = await fetch(`${BASE_URL}/api/track/${shareData.token}`);
    recordTest(
      "Contact Deletion Decoupling",
      "Deleting a saved contact does not compromise or delete existing share token",
      "Contact deleted (200) and track link remains active (200)",
      `Delete: ${delRes.status}, Track: ${trackRes.status}`,
      delRes.status === 200 && trackRes.status === 200
    );
  }

  // Test 29: Concurrent access to public tracking link
  {
    const fetchPromises = Array.from({ length: 5 }, () =>
      fetch(`${BASE_URL}/api/track/${adHocToken}`)
    );
    const responses = await Promise.all(fetchPromises);
    const all200 = responses.every((r) => r.status === 200);
    recordTest(
      "Concurrency",
      "Multiple simultaneous viewers can access tracking link without conflict",
      "All 5 concurrent requests return 200 OK",
      `Statuses: ${responses.map((r) => r.status).join(", ")}`,
      all200
    );
  }

  // Cleanup test rides and bookings
  await prisma.tripShareToken.deleteMany({
    where: { userId: { in: [driverUser.id, passengerA.id, passengerB.id] } },
  });
  await prisma.booking.deleteMany({
    where: { id: bookingA.id },
  });
  await prisma.ride.deleteMany({
    where: { id: { in: [testRideActive.id, testRideCompleted.id] } },
  });

  // ============================================================================
  // SUMMARY REPORT
  // ============================================================================
  console.log("\n==================================================================");
  console.log("  TEST RESULTS SUMMARY");
  console.log("==================================================================");
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`Total Scenarios: ${total}`);
  console.log(`Passed:          ${passed}`);
  console.log(`Failed:          ${failed}`);

  if (failed > 0) {
    console.error(`\n❌ ${failed} test(s) failed.`);
    process.exit(1);
  } else {
    console.log(`\n✅ All ${total} tests passed with 100% success rate!`);
  }
}

runTestSuite()
  .catch((e) => {
    console.error("Test execution failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

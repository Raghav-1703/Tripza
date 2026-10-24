import { prisma } from "../src/lib/prisma";
import bcrypt from "bcryptjs";

interface AuditResult {
  num: number;
  area: string;
  test: string;
  expected: string;
  actual: string;
  status: "PASS" | "FAIL";
  evidence?: string;
}

const auditResults: AuditResult[] = [];
let testIndex = 1;

function recordAudit(
  area: string,
  test: string,
  expected: string,
  actual: string,
  passed: boolean,
  evidence?: string
) {
  auditResults.push({
    num: testIndex++,
    area,
    test,
    expected,
    actual,
    status: passed ? "PASS" : "FAIL",
    evidence,
  });
  const badge = passed ? "✅ PASS" : "❌ FAIL";
  console.log(`${badge} [#${testIndex - 1}] [${area}] ${test}`);
  if (!passed && evidence) {
    console.error(`   Details: ${evidence}`);
  }
}

const BASE_URL = "http://localhost:3000";

// Helper to log in a user and extract next-auth.session-token
async function authenticateUser(email: string, passwordPlain: string): Promise<string> {
  // 1. Get CSRF token
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`);
  const csrfData = await csrfRes.json();
  const csrfToken = csrfData.csrfToken;
  const setCookie = csrfRes.headers.get("set-cookie") || "";

  // Extract csrf token cookie
  const csrfMatch = setCookie.match(/next-auth\.csrf-token=([^;]+)/);
  const csrfCookieVal = csrfMatch ? csrfMatch[1] : "";

  // 2. Call credentials callback
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

async function runAudit() {
  console.log("==================================================================");
  console.log("  TPOOL REPORT & BLOCK LIVE AUDIT & HTTP VERIFICATION");
  console.log("==================================================================\n");

  const pwdHash = await bcrypt.hash("Password123!", 10);

  // Setup distinct test users
  const aliceEmail = "audit_alice@tpool.test";
  const bobEmail = "audit_bob@tpool.test";
  const charlieEmail = "audit_charlie@tpool.test";
  const daveEmail = "audit_dave_driver@tpool.test";
  const adminEmail = "audit_admin@tpool.test";

  const alice = await prisma.user.upsert({
    where: { email: aliceEmail },
    update: { password: pwdHash, userType: "PASSENGER", status: "ACTIVE" },
    create: { email: aliceEmail, name: "Alice Audit", password: pwdHash, userType: "PASSENGER", role: "USER", status: "ACTIVE" },
  });

  const bob = await prisma.user.upsert({
    where: { email: bobEmail },
    update: { password: pwdHash, userType: "PASSENGER", status: "ACTIVE" },
    create: { email: bobEmail, name: "Bob Audit", password: pwdHash, userType: "PASSENGER", role: "USER", status: "ACTIVE" },
  });

  const charlie = await prisma.user.upsert({
    where: { email: charlieEmail },
    update: { password: pwdHash, userType: "PASSENGER", status: "ACTIVE" },
    create: { email: charlieEmail, name: "Charlie Audit", password: pwdHash, userType: "PASSENGER", role: "USER", status: "ACTIVE" },
  });

  const dave = await prisma.user.upsert({
    where: { email: daveEmail },
    update: { password: pwdHash, userType: "DRIVER", status: "ACTIVE" },
    create: { email: daveEmail, name: "Dave Driver Audit", password: pwdHash, userType: "DRIVER", role: "USER", status: "ACTIVE" },
  });

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { password: pwdHash, role: "ADMIN", status: "ACTIVE" },
    create: { email: adminEmail, name: "Admin Audit", password: pwdHash, userType: "BOTH", role: "ADMIN", status: "ACTIVE" },
  });

  const auditIds = [alice.id, bob.id, charlie.id, dave.id, admin.id];

  // Clean initial state
  await prisma.block.deleteMany({
    where: { OR: [{ blockerId: { in: auditIds } }, { blockedId: { in: auditIds } }] },
  });
  await prisma.report.deleteMany({
    where: { OR: [{ reporterId: { in: auditIds } }, { reportedUserId: { in: auditIds } }] },
  });

  console.log("Authenticating test accounts against live server...");
  const aliceCookie = await authenticateUser(aliceEmail, "Password123!");
  const bobCookie = await authenticateUser(bobEmail, "Password123!");
  const charlieCookie = await authenticateUser(charlieEmail, "Password123!");
  const daveCookie = await authenticateUser(daveEmail, "Password123!");
  const adminCookie = await authenticateUser(adminEmail, "Password123!");
  console.log("Authenticated 5 accounts successfully.\n");

  // ==========================================
  // SECTION 1: UNAUTHENTICATED & INVALID ACCESS
  // ==========================================
  console.log("--- 1. Unauthenticated & Invalid Access ---");

  // Test 1: GET /api/blocks unauthenticated
  {
    const res = await fetch(`${BASE_URL}/api/blocks`);
    recordAudit(
      "Auth Enforcement",
      "GET /api/blocks without session returns 401 Unauthorized",
      "status === 401",
      `status === ${res.status}`,
      res.status === 401
    );
  }

  // Test 2: POST /api/blocks unauthenticated
  {
    const res = await fetch(`${BASE_URL}/api/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blockedId: bob.id }),
    });
    recordAudit(
      "Auth Enforcement",
      "POST /api/blocks without session returns 401 Unauthorized",
      "status === 401",
      `status === ${res.status}`,
      res.status === 401
    );
  }

  // Test 3: DELETE /api/blocks/[id] unauthenticated
  {
    const res = await fetch(`${BASE_URL}/api/blocks/${bob.id}`, { method: "DELETE" });
    recordAudit(
      "Auth Enforcement",
      "DELETE /api/blocks/[id] without session returns 401 Unauthorized",
      "status === 401",
      `status === ${res.status}`,
      res.status === 401
    );
  }

  // Test 4: POST /api/reports unauthenticated
  {
    const res = await fetch(`${BASE_URL}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportedUserId: dave.id, reason: "HARASSMENT" }),
    });
    recordAudit(
      "Auth Enforcement",
      "POST /api/reports without session returns 401 Unauthorized",
      "status === 401",
      `status === ${res.status}`,
      res.status === 401
    );
  }

  // Test 5: GET /api/reports rejected with 405 Method Not Allowed
  {
    const res = await fetch(`${BASE_URL}/api/reports`, {
      headers: { Cookie: aliceCookie },
    });
    recordAudit(
      "Report Confidentiality",
      "GET /api/reports rejected to protect report confidentiality",
      "status === 405",
      `status === ${res.status}`,
      res.status === 405
    );
  }

  // ==========================================
  // SECTION 2: AUTHENTICATED BLOCKING & UNBLOCKING
  // ==========================================
  console.log("\n--- 2. Authenticated Blocking & Bidirectionality ---");

  // Test 6: Alice blocks Bob
  {
    const res = await fetch(`${BASE_URL}/api/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: aliceCookie },
      body: JSON.stringify({ blockedId: bob.id }),
    });
    const body = await res.json();
    recordAudit(
      "Block API",
      "Alice blocks Bob via POST /api/blocks returns 201 Created",
      "status === 201 && block created",
      `status === ${res.status}, msg=${body.message}`,
      res.status === 201 && !!body.block
    );
  }

  // Test 7: Block relationship check from Alice's perspective
  {
    const res = await fetch(`${BASE_URL}/api/blocks/check?userId=${bob.id}`, {
      headers: { Cookie: aliceCookie },
    });
    const data = await res.json();
    const passed = data.isBlocked === true && data.blockedByMe === true && data.blockedByThem === false;
    recordAudit(
      "Block Check",
      "Alice checks block relationship with Bob: blockedByMe=true",
      "isBlocked=true, blockedByMe=true, blockedByThem=false",
      JSON.stringify(data),
      passed
    );
  }

  // Test 8: Block relationship check from Bob's perspective (reverse)
  {
    const res = await fetch(`${BASE_URL}/api/blocks/check?userId=${alice.id}`, {
      headers: { Cookie: bobCookie },
    });
    const data = await res.json();
    const passed = data.isBlocked === true && data.blockedByMe === false && data.blockedByThem === true;
    recordAudit(
      "Block Check",
      "Bob checks block relationship with Alice: blockedByThem=true",
      "isBlocked=true, blockedByMe=false, blockedByThem=true",
      JSON.stringify(data),
      passed
    );
  }

  // Test 9: Listing blocks for Alice
  {
    const res = await fetch(`${BASE_URL}/api/blocks`, {
      headers: { Cookie: aliceCookie },
    });
    const list = await res.json();
    const hasBob = Array.isArray(list) && list.some((b: any) => b.blocked.id === bob.id);
    recordAudit(
      "Block List",
      "Alice's GET /api/blocks includes Bob",
      "Bob present in blocked list",
      `Count: ${list.length}, hasBob: ${hasBob}`,
      hasBob
    );
  }

  // Test 10: Listing blocks for Bob
  {
    const res = await fetch(`${BASE_URL}/api/blocks`, {
      headers: { Cookie: bobCookie },
    });
    const list = await res.json();
    recordAudit(
      "Block List",
      "Bob's GET /api/blocks is empty (did not initiate block)",
      "list.length === 0",
      `list.length === ${list.length}`,
      list.length === 0
    );
  }

  // Test 11: Repeated block is idempotent
  {
    const res = await fetch(`${BASE_URL}/api/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: aliceCookie },
      body: JSON.stringify({ blockedId: bob.id }),
    });
    const body = await res.json();
    recordAudit(
      "Block Idempotency",
      "Repeated POST /api/blocks handles gracefully without error",
      "status 201 with existing block",
      `status: ${res.status}, block: ${body.block?.id}`,
      res.status === 201 && body.block?.blockedId === bob.id
    );
  }

  // Test 12: Self-blocking rejected
  {
    const res = await fetch(`${BASE_URL}/api/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: aliceCookie },
      body: JSON.stringify({ blockedId: alice.id }),
    });
    recordAudit(
      "Validation",
      "POST /api/blocks rejects self-blocking with 400",
      "status === 400",
      `status === ${res.status}`,
      res.status === 400
    );
  }

  // Test 13: Nonexistent user blocked rejected
  {
    const res = await fetch(`${BASE_URL}/api/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: aliceCookie },
      body: JSON.stringify({ blockedId: "nonexistent-user-cuid-999" }),
    });
    recordAudit(
      "Validation",
      "POST /api/blocks rejects nonexistent user with 404",
      "status === 404",
      `status === ${res.status}`,
      res.status === 404
    );
  }

  // Test 14: Concurrent block requests handle cleanly
  {
    const promises = Array.from({ length: 5 }, () =>
      fetch(`${BASE_URL}/api/blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: aliceCookie },
        body: JSON.stringify({ blockedId: bob.id }),
      })
    );
    const results = await Promise.all(promises);
    const all201 = results.every((r) => r.status === 201);
    const dbRows = await prisma.block.count({
      where: { blockerId: alice.id, blockedId: bob.id },
    });
    recordAudit(
      "Concurrency",
      "Concurrent block requests maintain single record without race errors",
      "All requests return 201 and dbRows === 1",
      `All 201: ${all201}, dbRows: ${dbRows}`,
      all201 && dbRows === 1
    );
  }

  // ==========================================
  // SECTION 3: IDOR & AUTHORIZATION AUDIT
  // ==========================================
  console.log("\n--- 3. IDOR & Authorization Audit ---");

  // Test 15: Charlie attempts to unblock Bob on behalf of Alice
  {
    const res = await fetch(`${BASE_URL}/api/blocks/${bob.id}`, {
      method: "DELETE",
      headers: { Cookie: charlieCookie },
    });
    // Should return 404 because Charlie has not blocked Bob
    recordAudit(
      "IDOR Protection",
      "User C cannot unblock a relationship initiated by User A",
      "status === 404 Block record not found",
      `status === ${res.status}`,
      res.status === 404
    );

    // Verify block still exists in DB
    const stillBlocked = await prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId: alice.id, blockedId: bob.id } },
    });
    recordAudit(
      "IDOR Protection",
      "Block record remained intact after unauthorized unblock attempt",
      "Block record exists",
      `Exists: ${!!stillBlocked}`,
      !!stillBlocked
    );
  }

  // ==========================================
  // SECTION 4: BACKEND ROUTE RESTRICTIONS AUDIT
  // ==========================================
  console.log("\n--- 4. Backend Route Restrictions Audit ---");

  // Create a test ride by Dave
  const auditRide = await prisma.ride.create({
    data: {
      driverId: dave.id,
      origin: "Talegaon Dabhade, Pune",
      destination: "IIIT Pune, Pune",
      departure: new Date(Date.now() + 3 * 3600 * 1000),
      seats: 3,
      price: 60.0,
      status: "SCHEDULED",
    },
  });

  // Test 16: Alice blocks Driver Dave
  {
    await fetch(`${BASE_URL}/api/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: aliceCookie },
      body: JSON.stringify({ blockedId: dave.id }),
    });

    // Alice attempts to book Dave's ride
    const res = await fetch(`${BASE_URL}/api/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: aliceCookie },
      body: JSON.stringify({ rideId: auditRide.id, fare: 60.0 }),
    });
    const data = await res.json();
    recordAudit(
      "Booking Enforcement",
      "POST /api/bookings returns 403 Forbidden when passenger blocked driver",
      "status === 403",
      `status === ${res.status}, msg=${data.message}`,
      res.status === 403
    );
  }

  // Test 17: Driver Dave blocks Bob; Bob attempts to book Dave's ride (reverse)
  {
    await fetch(`${BASE_URL}/api/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: daveCookie },
      body: JSON.stringify({ blockedId: bob.id }),
    });

    const res = await fetch(`${BASE_URL}/api/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: bobCookie },
      body: JSON.stringify({ rideId: auditRide.id, fare: 60.0 }),
    });
    const data = await res.json();
    recordAudit(
      "Booking Enforcement",
      "POST /api/bookings returns 403 Forbidden in reverse (driver blocked passenger)",
      "status === 403",
      `status === ${res.status}, msg=${data.message}`,
      res.status === 403
    );
    // Unblock Dave and Bob
    await fetch(`${BASE_URL}/api/blocks/${bob.id}`, { method: "DELETE", headers: { Cookie: daveCookie } });
  }

  // Test 18: Co-passenger block prevents booking
  {
    // Charlie books Dave's ride
    const charlieBookingRes = await fetch(`${BASE_URL}/api/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: charlieCookie },
      body: JSON.stringify({ rideId: auditRide.id, fare: 60.0 }),
    });
    const charlieBookingData = await charlieBookingRes.json();
    const charlieBookingId = charlieBookingData.id || charlieBookingData.booking?.id;

    // Confirm Charlie's booking
    if (charlieBookingId) {
      await prisma.booking.update({
        where: { id: charlieBookingId },
        data: { status: "CONFIRMED" },
      });
    }

    // Unblock Alice & Dave for this test
    await fetch(`${BASE_URL}/api/blocks/${dave.id}`, { method: "DELETE", headers: { Cookie: aliceCookie } });

    // But Charlie blocks Alice!
    await fetch(`${BASE_URL}/api/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: charlieCookie },
      body: JSON.stringify({ blockedId: alice.id }),
    });

    // Alice attempts to book Dave's ride containing Charlie
    const res = await fetch(`${BASE_URL}/api/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: aliceCookie },
      body: JSON.stringify({ rideId: auditRide.id, fare: 60.0 }),
    });
    const data = await res.json();
    recordAudit(
      "Booking Enforcement",
      "POST /api/bookings returns 403 Forbidden when an active co-passenger has a block relationship",
      "status === 403",
      `status === ${res.status}, msg=${data.message}`,
      res.status === 403
    );

    // Clean up Charlie's block on Alice
    await fetch(`${BASE_URL}/api/blocks/${alice.id}`, { method: "DELETE", headers: { Cookie: charlieCookie } });
  }

  // Test 19: Message route blocks send when sender has block conflict
  {
    // Dave blocks Charlie
    await fetch(`${BASE_URL}/api/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: daveCookie },
      body: JSON.stringify({ blockedId: charlie.id }),
    });

    // Charlie (confirmed passenger) tries to send message in ride discussion
    const res = await fetch(`${BASE_URL}/api/rides/${auditRide.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: charlieCookie },
      body: JSON.stringify({ content: "Can you pick me up near highway?" }),
    });
    const data = await res.json();
    recordAudit(
      "Message Enforcement",
      "POST /api/rides/[id]/messages returns 403 Forbidden when participant has block relationship",
      "status === 403",
      `status === ${res.status}, msg=${data.message}`,
      res.status === 403
    );
    // Unblock Dave and Charlie
    await fetch(`${BASE_URL}/api/blocks/${charlie.id}`, { method: "DELETE", headers: { Cookie: daveCookie } });
  }

  // Test 20: Ratings route blocks rating between blocked users
  {
    // Complete ride
    await prisma.ride.update({ where: { id: auditRide.id }, data: { status: "COMPLETED" } });

    // Charlie blocks Dave
    await fetch(`${BASE_URL}/api/blocks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: charlieCookie },
      body: JSON.stringify({ blockedId: dave.id }),
    });

    // Charlie attempts to submit rating for Dave
    const res = await fetch(`${BASE_URL}/api/ratings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: charlieCookie },
      body: JSON.stringify({ rideId: auditRide.id, revieweeId: dave.id, rating: 5, review: "Great ride" }),
    });
    const data = await res.json();
    recordAudit(
      "Rating Enforcement",
      "POST /api/ratings returns 403 Forbidden between blocked users",
      "status === 403",
      `status === ${res.status}, msg=${data.message}`,
      res.status === 403
    );
    await fetch(`${BASE_URL}/api/blocks/${dave.id}`, { method: "DELETE", headers: { Cookie: charlieCookie } });
  }

  // ==========================================
  // SECTION 5: REPORT SYSTEM & ADMIN MODERATION AUDIT
  // ==========================================
  console.log("\n--- 5. Report System & Admin Moderation Audit ---");

  let auditReportId = "";

  // Test 21: Alice submits valid report on Dave
  {
    const res = await fetch(`${BASE_URL}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: aliceCookie },
      body: JSON.stringify({
        reportedUserId: dave.id,
        rideId: auditRide.id,
        reason: "UNSAFE_DRIVING",
        description: "Driver was speeding through residential intersections.",
      }),
    });
    const data = await res.json();
    auditReportId = data.report?.id;
    recordAudit(
      "Report Submission",
      "POST /api/reports submits confidential report with 201 Created",
      "status === 201 && report created",
      `status === ${res.status}, reportId=${auditReportId}`,
      res.status === 201 && !!auditReportId
    );
  }

  // Test 22: Alice attempts duplicate pending report on Dave
  {
    const res = await fetch(`${BASE_URL}/api/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: aliceCookie },
      body: JSON.stringify({
        reportedUserId: dave.id,
        rideId: auditRide.id,
        reason: "UNSAFE_DRIVING",
        description: "Another report attempt",
      }),
    });
    recordAudit(
      "Report Duplicate",
      "POST /api/reports returns 409 Conflict on duplicate pending submission",
      "status === 409",
      `status === ${res.status}`,
      res.status === 409
    );
  }

  // Test 23: Regular user Dave attempts to view admin reports
  {
    const res = await fetch(`${BASE_URL}/api/admin/reports`, {
      headers: { Cookie: daveCookie },
    });
    recordAudit(
      "Admin Auth",
      "Regular user cannot access GET /api/admin/reports (403 Forbidden)",
      "status === 403",
      `status === ${res.status}`,
      res.status === 403
    );
  }

  // Test 24: Regular user Dave attempts to modify moderation status
  {
    const res = await fetch(`${BASE_URL}/api/admin/reports/${auditReportId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: daveCookie },
      body: JSON.stringify({ status: "DISMISSED" }),
    });
    recordAudit(
      "Admin Auth",
      "Regular user cannot modify report status via PATCH /api/admin/reports/[id] (403)",
      "status === 403",
      `status === ${res.status}`,
      res.status === 403
    );
  }

  // Test 25: Admin accesses GET /api/admin/reports
  {
    const res = await fetch(`${BASE_URL}/api/admin/reports`, {
      headers: { Cookie: adminCookie },
    });
    const reports = await res.json();
    const hasAuditReport = Array.isArray(reports) && reports.some((r: any) => r.id === auditReportId);
    recordAudit(
      "Admin Moderation",
      "Admin user successfully retrieves reports via GET /api/admin/reports (200 OK)",
      "status === 200 && report found",
      `status === ${res.status}, found: ${hasAuditReport}`,
      res.status === 200 && hasAuditReport
    );
  }

  // Test 26: Admin updates report status to RESOLVED
  {
    const res = await fetch(`${BASE_URL}/api/admin/reports/${auditReportId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ status: "RESOLVED" }),
    });
    const updated = await res.json();
    recordAudit(
      "Admin Moderation",
      "Admin user updates report status via PATCH /api/admin/reports/[id]",
      "status === 200 && status === RESOLVED",
      `status === ${res.status}, reportStatus: ${updated.status}`,
      res.status === 200 && updated.status === "RESOLVED"
    );
  }

  // ==========================================
  // SECTION 6: HISTORICAL DATA & UNBLOCK RESTORATION
  // ==========================================
  console.log("\n--- 6. Historical Data Preservation & Unblocking ---");

  // Test 27: Verify historical messages and bookings intact
  {
    const bookingInDb = await prisma.booking.findFirst({ where: { rideId: auditRide.id, userId: charlie.id } });
    recordAudit(
      "Data Preservation",
      "Confirmed booking and ride records are preserved without destruction",
      "Booking exists",
      `Booking found: ${!!bookingInDb}`,
      !!bookingInDb
    );
  }

  // Test 28: Alice unblocks Bob
  {
    const res = await fetch(`${BASE_URL}/api/blocks/${bob.id}`, {
      method: "DELETE",
      headers: { Cookie: aliceCookie },
    });
    const data = await res.json();
    recordAudit(
      "Unblock API",
      "Alice unblocks Bob via DELETE /api/blocks/[id] returns 200 OK",
      "status === 200",
      `status === ${res.status}, msg=${data.message}`,
      res.status === 200
    );

    // Verify unblock
    const checkRes = await fetch(`${BASE_URL}/api/blocks/check?userId=${bob.id}`, {
      headers: { Cookie: aliceCookie },
    });
    const checkData = await checkRes.json();
    recordAudit(
      "Unblock Verification",
      "Block relationship check returns isBlocked=false after unblocking",
      "isBlocked === false",
      `isBlocked === ${checkData.isBlocked}`,
      checkData.isBlocked === false
    );
  }

  // Clean up audit test data
  console.log("\n--- Cleaning up audit fixtures ---");
  await prisma.rating.deleteMany({
    where: { OR: [{ reviewerId: { in: auditIds } }, { revieweeId: { in: auditIds } }] },
  });
  await prisma.message.deleteMany({ where: { OR: [{ rideId: auditRide.id }, { userId: { in: auditIds } }] } });
  await prisma.booking.deleteMany({ where: { OR: [{ rideId: auditRide.id }, { userId: { in: auditIds } }] } });
  await prisma.ride.deleteMany({ where: { OR: [{ id: auditRide.id }, { driverId: { in: auditIds } }] } });
  await prisma.report.deleteMany({
    where: { OR: [{ reporterId: { in: auditIds } }, { reportedUserId: { in: auditIds } }] },
  });
  await prisma.block.deleteMany({
    where: { OR: [{ blockerId: { in: auditIds } }, { blockedId: { in: auditIds } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: auditIds } } });
  console.log("Audit cleanup finished.\n");

  // Summary
  console.log("==================================================================");
  console.log("  LIVE AUDIT MATRIX SUMMARY");
  console.log("==================================================================");
  const total = auditResults.length;
  const passed = auditResults.filter((r) => r.status === "PASS").length;
  const failed = auditResults.filter((r) => r.status === "FAIL").length;

  console.log(`Total Audit Checks Executed : ${total}`);
  console.log(`Passed                      : ${passed}`);
  console.log(`Failed                      : ${failed}`);
  console.log(`Pass Rate                   : ${((passed / total) * 100).toFixed(1)}%`);
  console.log("==================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runAudit()
  .catch((e) => {
    console.error("Audit runner crashed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

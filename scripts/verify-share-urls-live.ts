import { prisma } from "../src/lib/prisma";
import { getPublicAppOrigin, buildPublicTrackingUrl } from "../src/lib/appUrl";

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

async function main() {
  console.log("================================================================================");
  console.log("LIVE VERIFICATION: TPOOL TRIP-SHARING URLS (LOCALHOST, LAN & PRODUCTION)");
  console.log("================================================================================\n");

  const originalEnv = { ...process.env };

  try {
    // -------------------------------------------------------------------------
    // TEST 1: ENVIRONMENT ISOLATION & SOURCE OF TRUTH (APP_URL)
    // -------------------------------------------------------------------------
    console.log("--- 1. Testing Single Explicit Origin (APP_URL) ---");

    // Scenario 1A: Same-Computer Localhost Development
    (process.env as any).NODE_ENV = "development";
    process.env.APP_URL = "http://localhost:3000";
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXTAUTH_URL = "http://arbitrary-different-domain:3000";

    const localRes = getPublicAppOrigin();
    assert(localRes.origin === "http://localhost:3000", "Localhost development uses explicit APP_URL=http://localhost:3000");
    assert(localRes.isLocalhost === true, "Localhost origin correctly flagged isLocalhost=true for UI guidance");

    const localUrl = buildPublicTrackingUrl("tok_local_test_123");
    assert(localUrl.url === "http://localhost:3000/track/tok_local_test_123", "Local tracking URL constructed correctly");

    // Scenario 1B: Different-Device LAN Testing (Wi-Fi IP)
    process.env.APP_URL = "http://192.168.0.101:3000";
    const lanRes = getPublicAppOrigin();
    assert(lanRes.origin === "http://192.168.0.101:3000", "LAN development uses configured Wi-Fi IP origin http://192.168.0.101:3000");
    assert(lanRes.isLocalhost === false, "LAN IP correctly recognized as non-localhost (isLocalhost=false)");

    const lanUrl = buildPublicTrackingUrl("tok_lan_test_456");
    assert(lanUrl.url === "http://192.168.0.101:3000/track/tok_lan_test_456", "LAN tracking URL uses configured LAN IP");

    // Scenario 1C: Production HTTPS Deployment
    (process.env as any).NODE_ENV = "production";
    process.env.APP_URL = "https://rides.tpool.org";
    const prodRes = getPublicAppOrigin();
    assert(prodRes.origin === "https://rides.tpool.org", "Production uses configured HTTPS domain https://rides.tpool.org");
    assert(prodRes.isLocalhost === false, "Production is not localhost");
    assert(!prodRes.error, "Production HTTPS domain has no errors");

    const prodUrl = buildPublicTrackingUrl("tok_prod_test_789");
    assert(prodUrl.url === "https://rides.tpool.org/track/tok_prod_test_789", "Production tracking URL uses deployed HTTPS domain");

    // Scenario 1D: Strict Production Rejection of Insecure HTTP & Localhost
    process.env.APP_URL = "http://rides.tpool.org";
    const prodInsecureRes = getPublicAppOrigin();
    assert(!prodInsecureRes.origin, "Production rejects insecure http://");
    assert(Boolean(prodInsecureRes.error?.includes("HTTPS")), "Production provides clear HTTPS requirement error");

    process.env.APP_URL = "https://localhost:3000";
    const prodLocalhostRes = getPublicAppOrigin();
    assert(!prodLocalhostRes.origin, "Production strictly rejects localhost/loopback");
    assert(Boolean(prodLocalhostRes.error?.includes("localhost")), "Production provides clear non-localhost error");

    // Scenario 1E: Missing APP_URL (No silent fallbacks)
    (process.env as any).NODE_ENV = "development";
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXTAUTH_URL = "http://localhost:3000"; // Should NOT be used as fallback!

    const missingRes = getPublicAppOrigin();
    assert(!missingRes.origin, "Missing APP_URL returns empty origin (does NOT fallback to NEXTAUTH_URL)");
    assert(Boolean(missingRes.error?.includes("not configured")), "Missing APP_URL returns actionable configuration guidance");

    const missingUrl = buildPublicTrackingUrl("tok_missing");
    assert(!missingUrl.url && Boolean(missingUrl.error), "buildPublicTrackingUrl fails cleanly when APP_URL is missing");

    // Scenario 1F: Invalid / Malformed URL Format
    process.env.APP_URL = "ht!tp://broken:not-valid";
    const invalidRes = getPublicAppOrigin();
    assert(!invalidRes.origin && Boolean(invalidRes.error?.includes("Invalid application URL")), "Invalid URL format returns descriptive error");

    // -------------------------------------------------------------------------
    // TEST 2: LIVE HTTP ENDPOINT VALIDATION ON RUNNING SERVER
    // -------------------------------------------------------------------------
    console.log("\n--- 2. Testing Live HTTP Server & Tracking Flow ---");

    // Ensure we have a test user and test ride in database
    let testDriver = await prisma.user.findFirst({ where: { userType: "DRIVER" } });
    if (!testDriver) {
      testDriver = await prisma.user.create({
        data: {
          name: "Test Driver Live",
          email: `driver_live_${Date.now()}@example.com`,
          password: "dummy_password_hash",
          role: "USER",
          userType: "DRIVER",
          phoneNumber: "+919876543210",
        },
      });
    }

    let testRide = await prisma.ride.findFirst({
      where: {
        driverId: testDriver.id,
        status: { in: ["ACTIVE", "SCHEDULED"] },
      },
    });

    if (!testRide) {
      testRide = await prisma.ride.create({
        data: {
          driverId: testDriver.id,
          origin: "Pune Station",
          destination: "Hinjawadi Phase 1",
          departure: new Date(Date.now() + 3600000),
          seats: 3,
          price: 150,
          status: "ACTIVE",
          currentLat: 18.5284,
          currentLon: 73.8739,
          locationUpdatedAt: new Date(),
          isLiveSharing: true,
        },
      });
    }

    // Create a live share token
    const testTokenStr = `live_verify_${Date.now()}_abc123xyz`;
    const shareToken = await prisma.tripShareToken.create({
      data: {
        token: testTokenStr,
        rideId: testRide.id,
        userId: testDriver.id,
        recipientName: "Emergency Test Contact",
        recipientPhone: "+919876501234",
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });

    // Test GET /api/track/[token] over HTTP
    const apiRes = await fetch(`http://localhost:3000/api/track/${shareToken.token}`);
    assert(apiRes.status === 200, `GET /api/track/[token] returns HTTP 200 OK (status: ${apiRes.status})`);

    const trackJson = await apiRes.json();
    assert(trackJson.token === shareToken.token, "Returned tracking token matches created token");
    assert(trackJson.driverName === testDriver.name, "Returned tracking record contains driver name");
    assert(trackJson.origin === testRide.origin, "Returned tracking record contains origin");
    assert(trackJson.destination === testRide.destination, "Returned tracking record contains destination");
    assert(!trackJson.driverPhone && !trackJson.recipientPhone, "Public tracking API strictly withholds phone numbers for privacy");

    // Test GET /track/[token] HTML page over HTTP
    const pageRes = await fetch(`http://localhost:3000/track/${shareToken.token}`);
    assert(pageRes.status === 200, `GET /track/[token] renders HTML page HTTP 200 OK (status: ${pageRes.status})`);
    const pageHtml = await pageRes.text();
    assert(pageHtml.includes("TPool SafeTrack"), "Tracking page HTML contains 'TPool SafeTrack' header");
    assert(pageHtml.includes("Live Trusted Trip Sharing"), "Tracking page HTML contains trip sharing description");

    // Clean up test token
    await prisma.tripShareToken.delete({ where: { id: shareToken.id } });

    console.log("\n================================================================================");
    console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
    console.log("================================================================================");

    if (failedCount > 0) {
      process.exit(1);
    }
  } finally {
    process.env = originalEnv;
  }
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

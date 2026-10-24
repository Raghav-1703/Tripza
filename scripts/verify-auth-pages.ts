import { prisma } from "../src/lib/prisma";
import bcrypt from "bcryptjs";

async function verifyAuthPages() {
  console.log("================================================================================");
  console.log("VERIFYING AUTHENTICATED DASHBOARD & PROFILE STYLING");
  console.log("================================================================================\n");

  const email = "verify_ui_user@tpool.local";
  const password = "Password123!";
  const hashedPassword = await bcrypt.hash(password, 10);

  // Upsert test user
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      password: hashedPassword,
      userType: "PASSENGER",
      phoneNumber: "+919876543210",
      status: "ACTIVE",
    },
    create: {
      name: "UI Verification User",
      email,
      password: hashedPassword,
      userType: "PASSENGER",
      phoneNumber: "+919876543210",
      role: "USER",
      status: "ACTIVE",
    },
  });

  // 1. NextAuth sign in via REST credentials flow to obtain session cookie
  const csrfRes = await fetch("http://localhost:3000/api/auth/csrf");
  const csrfData = await csrfRes.json();
  const csrfToken = csrfData.csrfToken;

  const cookieHeader = csrfRes.headers.get("set-cookie") || "";
  const csrfCookie = cookieHeader.split(";")[0];

  const signinRes = await fetch("http://localhost:3000/api/auth/callback/credentials", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: csrfCookie,
    },
    body: new URLSearchParams({
      csrfToken,
      email,
      password,
      json: "true",
    }),
    redirect: "manual",
  });

  const sessionCookies = signinRes.headers.get("set-cookie") || "";
  console.log("Authentication result:", signinRes.status, "Cookies set:", sessionCookies.includes("next-auth.session-token"));

  const authCookie = sessionCookies
    .split(",")
    .map(c => c.trim().split(";")[0])
    .filter(c => c.startsWith("next-auth.session-token"))
    .join("; ");

  // 2. Fetch /dashboard with auth cookie
  const dashRes = await fetch("http://localhost:3000/dashboard", {
    headers: { Cookie: authCookie },
  });
  const dashHtml = await dashRes.text();

  console.log("\n--- Dashboard Inspection ---");
  console.log(`  HTTP Status: ${dashRes.status}`);
  console.log(`  Has Global Stylesheet Link: ${dashHtml.includes("/_next/static/css/app/layout.css") ? "✓ YES" : "✗ NO"}`);
  console.log(`  Passenger Dashboard Rendered: ${dashHtml.includes("Find a Ride") || dashHtml.includes("Upcoming Bookings") ? "✓ YES" : "✗ NO"}`);
  console.log(`  User Greeting Rendered: ${dashHtml.includes("UI Verification User") || dashHtml.includes("Welcome") ? "✓ YES" : "✗ NO"}`);
  console.log(`  Styled Card Layouts Present: ${dashHtml.includes("rounded-xl") && dashHtml.includes("border") && dashHtml.includes("bg-card") ? "✓ YES" : "✗ NO"}`);

  // 3. Fetch /profile with auth cookie
  const profRes = await fetch("http://localhost:3000/profile", {
    headers: { Cookie: authCookie },
  });
  const profHtml = await profRes.text();

  console.log("\n--- Profile Inspection ---");
  console.log(`  HTTP Status: ${profRes.status}`);
  console.log(`  Has Global Stylesheet Link: ${profHtml.includes("/_next/static/css/app/layout.css") ? "✓ YES" : "✗ NO"}`);
  console.log(`  Account Details Section: ${profHtml.includes("Account Details") ? "✓ YES" : "✗ NO"}`);
  console.log(`  Phone Number Field Rendered: ${profHtml.includes("+919876543210") || profHtml.includes("Personal Phone Number") ? "✓ YES" : "✗ NO"}`);
  console.log(`  Trusted Contacts Section: ${profHtml.includes("Trusted &amp; Emergency Contacts") || profHtml.includes("Trusted & Emergency Contacts") ? "✓ YES" : "✗ NO"}`);
  console.log(`  Blocked Accounts Section: ${profHtml.includes("Safety &amp; Blocked Accounts") || profHtml.includes("Safety & Blocked Accounts") ? "✓ YES" : "✗ NO"}`);
  console.log(`  Tailwind Styling Classes: ${profHtml.includes("max-w-5xl") && profHtml.includes("space-y-8") ? "✓ YES" : "✗ NO"}`);

  // 4. Clean up test user
  await prisma.user.delete({ where: { id: user.id } });
  console.log("\n  ✓ Test user cleaned up safely.");

  const allPassed =
    dashRes.status === 200 &&
    profRes.status === 200 &&
    dashHtml.includes("/_next/static/css/app/layout.css") &&
    profHtml.includes("/_next/static/css/app/layout.css");

  console.log("\n================================================================================");
  console.log(allPassed ? "AUTHENTICATED PAGES VERIFIED: STYLESHEET FULLY LOADED & RENDERED!" : "VERIFICATION FAILED");
  console.log("================================================================================");

  if (!allPassed) {
    process.exit(1);
  }
}

verifyAuthPages().catch(err => {
  console.error("Test error:", err);
  process.exit(1);
});

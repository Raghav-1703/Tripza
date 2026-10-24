interface PageCheck {
  url: string;
  name: string;
  expectedKeywords: string[];
  expectedClasses: string[];
}

const pagesToCheck: PageCheck[] = [
  {
    url: "http://localhost:3000/",
    name: "Homepage",
    expectedKeywords: ["Verified Users", "Save Money", "Greener Rides"],
    expectedClasses: ["max-w-7xl", "flex", "grid", "border-t"],
  },
  {
    url: "http://localhost:3000/login",
    name: "Login Page",
    expectedKeywords: ["Sign In", "Email", "Password"],
    expectedClasses: ["max-w-md", "rounded-lg", "shadow-sm", "border", "bg-card"],
  },
  {
    url: "http://localhost:3000/register",
    name: "Register Page",
    expectedKeywords: ["Create an account", "Full Name", "Passenger / Student"],
    expectedClasses: ["max-w-lg", "space-y-4", "border"],
  },
  {
    url: "http://localhost:3000/search",
    name: "Search Page",
    expectedKeywords: ["Search Results", "Back to Search"],
    expectedClasses: ["max-w-7xl", "space-y-8", "text-3xl"],
  },
];

async function runPageChecks() {
  console.log("================================================================================");
  console.log("VERIFYING STYLESHEET DELIVERY AND RENDERED HTML ACROSS APPLICATION PAGES");
  console.log("================================================================================\n");

  let allPassed = true;

  // 1. Check Global Stylesheet
  console.log("--- 1. Checking Global Stylesheet Delivery ---");
  const homeRes = await fetch("http://localhost:3000/");
  const homeHtml = await homeRes.text();
  const cssMatch = homeHtml.match(/href="(\/_next\/static\/css\/app\/layout\.css[^"]*)"/);

  if (!cssMatch) {
    console.error("  ✗ FAIL: No layout stylesheet link found in HTML!");
    process.exit(1);
  }

  const cssUrl = "http://localhost:3000" + cssMatch[1];
  const cssRes = await fetch(cssUrl);
  const cssText = await cssRes.text();

  console.log(`  Styles URL: ${cssUrl}`);
  console.log(`  HTTP Status: ${cssRes.status} ${cssRes.statusText}`);
  console.log(`  Content-Type: ${cssRes.headers.get("content-type")}`);
  console.log(`  Total CSS Bundle Size: ${cssText.length} bytes (~${(cssText.length / 1024).toFixed(1)} KB)`);

  const containsTailwindVariables = cssText.includes("--background") && cssText.includes("--primary");
  const containsCoreUtilities = cssText.includes(".flex") && cssText.includes(".grid") && cssText.includes(".border");
  const containsThemeTokens = cssText.includes("hsl(var(--") && cssText.includes(".dark");

  if (cssRes.status === 200 && containsTailwindVariables && containsCoreUtilities && containsThemeTokens) {
    console.log("  ✓ Stylesheet successfully serves complete compiled Tailwind CSS bundle!\n");
  } else {
    console.error("  ✗ FAIL: Stylesheet did not meet criteria!");
    allPassed = false;
  }

  // 2. Check Each Key Page
  console.log("--- 2. Checking Page Delivery and HTML Classes ---");
  for (const page of pagesToCheck) {
    try {
      const res = await fetch(page.url);
      const text = await res.text();

      const hasCssLink = text.includes("/_next/static/css/app/layout.css");
      const hasKeywords = page.expectedKeywords.every(k => text.includes(k));
      const hasClasses = page.expectedClasses.every(c => text.includes(c));

      console.log(`Page: ${page.name} (${page.url})`);
      console.log(`  HTTP Status: ${res.status}`);
      console.log(`  Has Global Stylesheet Link: ${hasCssLink ? "✓ YES" : "✗ NO"}`);
      console.log(`  Content Keywords Present: ${hasKeywords ? "✓ YES" : "✗ NO"}`);
      console.log(`  Tailwind Styling Classes Present: ${hasClasses ? "✓ YES" : "✗ NO"}`);

      if (res.status === 200 && hasCssLink && hasKeywords && hasClasses) {
        console.log(`  ✓ ${page.name} verified successfully.\n`);
      } else {
        console.error(`  ✗ ${page.name} failed verification.\n`);
        allPassed = false;
      }
    } catch (err) {
      console.error(`  ✗ Error checking ${page.name}:`, err);
      allPassed = false;
    }
  }

  console.log("================================================================================");
  console.log(allPassed ? "ALL PAGES AND STYLESHEET ASSETS VERIFIED SUCCESSFULLY!" : "SOME CHECKS FAILED");
  console.log("================================================================================");

  if (!allPassed) {
    process.exit(1);
  }
}

runPageChecks().catch(err => {
  console.error("Runner error:", err);
  process.exit(1);
});

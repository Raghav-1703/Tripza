async function check() {
  try {
    const htmlRes = await fetch("http://localhost:3000/");
    const html = await htmlRes.text();
    const matches = [...html.matchAll(/href="(\/_next\/static\/css\/[^"]+)"/g)];
    console.log(`Found ${matches.length} CSS link tags:`);
    for (const m of matches) {
      const cssUrl = "http://localhost:3000" + m[1];
      const res = await fetch(cssUrl);
      const text = await res.text();
      console.log(`  URL: ${cssUrl}`);
      console.log(`  Status: ${res.status} ${res.statusText}`);
      console.log(`  Content-Type: ${res.headers.get("content-type")}`);
      console.log(`  Size: ${text.length} bytes`);
      console.log(`  Contains Tailwind variables: ${text.includes("--background") || text.includes("var(--")}`);
    }
  } catch (err) {
    console.error("Check failed:", err);
  }
}

check();

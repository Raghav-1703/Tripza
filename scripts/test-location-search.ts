import { searchLocations, resolveLocationText } from "../src/lib/locationSearch";
import { geocode } from "../src/lib/geo";

function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function runLocationTests() {
  console.log("=================================================");
  console.log("  TPOOL LOCATION SEARCH COVERAGE TEST SUITE");
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

  // --- 1. TARGET LOCAL SEARCH TESTS ---
  console.log("--- 1. Required Talegaon Dabhade Landmark Searches ---");

  // 1A. DMart
  const dmartRes = await searchLocations("DMart", { limit: 3 });
  assert(dmartRes.length > 0, "DMart returned search results");
  const dmartTop = dmartRes[0];
  assert(
    dmartTop.name.toLowerCase().includes("dmart"),
    `Top result is DMart: "${dmartTop.name}"`
  );
  const dmartDist = distKm(dmartTop.lat, dmartTop.lon, 18.7296, 73.6708);
  assert(
    dmartDist < 0.1,
    `DMart coordinates [${dmartTop.lat.toFixed(4)}, ${dmartTop.lon.toFixed(4)}] match expected [18.7296, 73.6708] (diff: ${(dmartDist * 1000).toFixed(0)}m)`
  );

  // 1B. Harneshwar Hospital
  const hospRes = await searchLocations("Harneshwar Hospital", { limit: 3 });
  assert(hospRes.length > 0, "Harneshwar Hospital returned search results");
  const hospTop = hospRes[0];
  assert(
    hospTop.name.toLowerCase().includes("harneshwar"),
    `Top result is Harneshwar: "${hospTop.name}"`
  );
  const hospDist = distKm(hospTop.lat, hospTop.lon, 18.7336, 73.6647);
  assert(
    hospDist < 0.1,
    `Harneshwar Hospital coordinates [${hospTop.lat.toFixed(4)}, ${hospTop.lon.toFixed(4)}] match expected [18.7336, 73.6647] (diff: ${(hospDist * 1000).toFixed(0)}m)`
  );

  // 1C. Zudio
  const zudioRes = await searchLocations("Zudio", { limit: 3 });
  assert(zudioRes.length > 0, "Zudio returned search results");
  const zudioTop = zudioRes[0];
  assert(
    zudioTop.name.toLowerCase().includes("zudio"),
    `Top result is Zudio: "${zudioTop.name}"`
  );
  const zudioDist = distKm(zudioTop.lat, zudioTop.lon, 18.7213, 73.6685);
  assert(
    zudioDist < 0.1,
    `Zudio coordinates [${zudioTop.lat.toFixed(4)}, ${zudioTop.lon.toFixed(4)}] match expected [18.7213, 73.6685] (diff: ${(zudioDist * 1000).toFixed(0)}m)`
  );

  // 1D. Star Bazaar
  const starRes = await searchLocations("Star Bazaar", { limit: 3 });
  assert(starRes.length > 0, "Star Bazaar returned search results");
  const starTop = starRes[0];
  assert(
    starTop.name.toLowerCase().includes("star bazaar"),
    `Top result is Star Bazaar: "${starTop.name}"`
  );
  const starDist = distKm(starTop.lat, starTop.lon, 18.7213, 73.6685);
  assert(
    starDist < 0.1,
    `Star Bazaar coordinates [${starTop.lat.toFixed(4)}, ${starTop.lon.toFixed(4)}] match expected [18.7213, 73.6685] (diff: ${(starDist * 1000).toFixed(0)}m)`
  );

  // 1E. Real Dream Home
  const dreamRes = await searchLocations("Real Dream Home", { limit: 3 });
  assert(dreamRes.length > 0, "Real Dream Home returned search results");
  const dreamTop = dreamRes[0];
  assert(
    dreamTop.name.toLowerCase().includes("real dream"),
    `Top result is Real Dream Home: "${dreamTop.name}"`
  );
  const dreamDist = distKm(dreamTop.lat, dreamTop.lon, 18.7297, 73.6792);
  assert(
    dreamDist < 0.1,
    `Real Dream Home coordinates [${dreamTop.lat.toFixed(4)}, ${dreamTop.lon.toFixed(4)}] match expected [18.7297, 73.6792] (diff: ${(dreamDist * 1000).toFixed(0)}m)`
  );

  // 1F. Talegaon Railway Station
  const stationRes = await searchLocations("Talegaon Railway Station", { limit: 3 });
  assert(stationRes.length > 0, "Talegaon Railway Station returned search results");
  const stationTop = stationRes[0];
  assert(
    stationTop.name.toLowerCase().includes("talegaon railway station"),
    `Top result is Talegaon Railway Station: "${stationTop.name}"`
  );
  const stationDist = distKm(stationTop.lat, stationTop.lon, 18.7367, 73.6705);
  assert(
    stationDist < 0.1,
    `Talegaon Railway Station coordinates [${stationTop.lat.toFixed(4)}, ${stationTop.lon.toFixed(4)}] match expected [18.7367, 73.6705] (diff: ${(stationDist * 1000).toFixed(0)}m)`
  );

  // --- 2. PARTIAL NAMES & SPELLING VARIATION TESTS ---
  console.log("\n--- 2. Partial Names & Spelling Variations ---");
  const variations = [
    { query: "d-mart", expected: "DMart" },
    { query: "zudi", expected: "Zudio" },
    { query: "harne", expected: "Harneshwar" },
    { query: "dream home", expected: "Real Dream Home" },
    { query: "station", expected: "Station" },
    { query: "iiit", expected: "IIIT Pune" },
    { query: "dy patil", expected: "D.Y. Patil" },
  ];

  for (const v of variations) {
    const res = await searchLocations(v.query, { limit: 2 });
    assert(res.length > 0, `Search for "${v.query}" returned results`);
    assert(
      res.some((r) => r.name.toLowerCase().includes(v.expected.toLowerCase())),
      `Search for "${v.query}" includes "${v.expected}" in results (found "${res[0]?.name}")`
    );
  }

  // --- 3. REGIONAL & OUT-OF-TOWN DESTINATIONS ---
  console.log("\n--- 3. Regional & Out-of-Town Destinations ---");
  const regionalQueries = [
    { query: "Pune Station", expectedLat: 18.528, expectedLon: 73.873 },
    { query: "Lonavala", expectedLat: 18.750, expectedLon: 73.407 },
    { query: "Hinjewadi", expectedLat: 18.59, expectedLon: 73.73 },
  ];

  for (const rq of regionalQueries) {
    const res = await searchLocations(rq.query, { limit: 3 });
    assert(res.length > 0, `Out-of-town search "${rq.query}" returns valid results`);
    const top = res[0];
    const d = distKm(top.lat, top.lon, rq.expectedLat, rq.expectedLon);
    assert(
      d < 15,
      `Out-of-town search "${rq.query}" resolved near expected region (${d.toFixed(1)} km from [${rq.expectedLat}, ${rq.expectedLon}])`
    );
  }

  // --- 4. BACKEND GEOCODE RESOLVER TESTS ---
  console.log("\n--- 4. Backend Geocode Integration Tests ---");
  const geocodeTargets = [
    { name: "DMart", lat: 18.7296, lon: 73.6708 },
    { name: "Harneshwar Hospital", lat: 18.7336, lon: 73.6647 },
    { name: "Zudio", lat: 18.7213, lon: 73.6685 },
    { name: "Star Bazaar", lat: 18.7213, lon: 73.6685 },
    { name: "Real Dream Home", lat: 18.7297, lon: 73.6792 },
    { name: "Talegaon Railway Station", lat: 18.7367, lon: 73.6705 },
  ];

  for (const gt of geocodeTargets) {
    const resolved = await geocode(gt.name);
    assert(resolved !== null, `geocode("${gt.name}") resolved coordinates`);
    if (resolved) {
      const d = distKm(resolved.lat, resolved.lon, gt.lat, gt.lon);
      assert(
        d < 0.1,
        `geocode("${gt.name}") returned [${resolved.lat.toFixed(4)}, ${resolved.lon.toFixed(4)}] matching target (diff: ${(d * 1000).toFixed(0)}m)`
      );
    }
  }

  console.log("\n=================================================");
  if (allPassed) {
    console.log("  🎉 ALL LOCATION TESTS PASSED SUCCESSFULLY!");
  } else {
    console.error("  ❌ SOME LOCATION TESTS FAILED!");
  }
  console.log("=================================================");
}

runLocationTests().catch((err) => {
  console.error("Location test runner failed:", err);
  process.exit(1);
});

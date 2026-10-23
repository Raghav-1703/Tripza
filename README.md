# Tpool

Tpool is a college-focused ride/car-pooling platform. A person travelling somewhere can publish a ride when they have an available seat, and another person travelling on the same or similar route can discover that ride and book/request a seat. It is designed to be realistic, focused, and simple for college use.

## Important Architecture

The application is a full-stack monolithic web application built on Next.js.
- **Frontend**: Server and Client Components using React, Tailwind CSS, and shadcn/ui.
- **Backend**: Next.js API Routes (Route Handlers) handling business logic.
- **Database**: SQLite database accessed via Prisma ORM.
- **Authentication**: JWT-based session strategy using NextAuth.js Credentials provider.
- **Mapping**: Dynamic Client-side importing of Leaflet to bypass SSR window restrictions, integrated with the free OpenStreetMap Nominatim API.

## Data & API Structure

### Data Models (Prisma/SQLite)
- **User**: Stores user details (`id`, `name`, `email`, `password`, `createdAt`).
- **Ride**: Represents a published ride (`id`, `driverId`, `origin`, `destination`, `departure`, `seats`, `price`, `status`, `currentLat`, `currentLon`, `isLiveSharing`, `locationUpdatedAt`, `createdAt`).
- **Booking**: Represents a requested or confirmed seat (`id`, `rideId`, `userId`, `seats`, `status`, `createdAt`).
- **Message**: Represents a message in a ride's discussion board (`id`, `rideId`, `userId`, `content`, `createdAt`).
- **Rating**: Represents a post-ride rating and review (`id`, `rideId`, `bookingId`, `reviewerId`, `revieweeId`, `rating` [1-5], `review`, `createdAt`).

### APIs
- `POST /api/auth/register` - Creates a new user in the database.
- `/api/auth/[...nextauth]` - NextAuth endpoints for authentication (login, logout, session verification).
- `POST /api/rides` - Creates a new ride attached to the authenticated user (enforces active-ride publishing restrictions).
- `GET /api/rides/[id]/status` - Fetches ride status for passenger window synchronization.
- `PATCH /api/rides/[id]/status` - Driver endpoint to transition ride status (`SCHEDULED` → `ACTIVE` → `COMPLETED`).
- `GET /api/rides/[id]/location` - Authenticated endpoint for authorized participants & admins to fetch live vehicle coordinates.
- `POST /api/rides/[id]/location` - Driver-only authenticated endpoint to publish real-time GPS updates during active rides.
- `DELETE /api/rides/[id]` - Secure endpoint for a driver to cancel their ride and associated bookings.
- `POST /api/bookings` - Requests a seat (`PENDING` status).
- `PATCH /api/bookings/[id]` - Modifies booking state (`CONFIRM`, `REJECT`, `CANCEL`) with safe seat refunding.
- `POST /api/emergency/sos` - Authenticated endpoint for passengers on active rides to trigger emergency SOS alerts with location.
- `GET /api/rides/[id]/messages` - Securely fetches discussion messages for authorized participants.
- `POST /api/rides/[id]/messages` - Allows authorized participants to send messages to the discussion board.
- `POST/GET /api/ratings` - Secure API for submitting and fetching post-ride ratings and reviews.

## Current Routes

- `/` - Landing page with the primary **Find a Ride** search form.
- `/search` - Server Component page displaying dynamic ride search results.
- `/rides/[id]` - Detailed view for a specific ride featuring booking UI, Ride Lifecycle controls, Passenger Window Sync, Live Moving Vehicle Pointer Map, Emergency SOS, Post-Ride Ratings, Secure Chat, and Interactive Maps.
- `/login` - Sign-in page for existing users.
- `/register` - Sign-up page for new users.
- `/dashboard` - Protected dashboard page acting as the centralized management hub with role-specific Driver & Passenger hubs and completed ride rating prompts.
- `/profile` - Protected page showing user account details, emergency contact setup, and community ratings & reviews summary.
- `/rides/create` - Protected form to publish a new ride.

---

## COMPLETED — LIVE MOVING DRIVER POINTER & REAL-TIME LOCATION TRACKING FIX

### Root Cause Analysis
1. **Vehicle Orientation Mismatch**:
   - The map icon previously rendered a side-profile car silhouette (from Lucide icons, facing left/right).
   - In cartographic navigation and Leaflet maps, 0° is North (straight UP). Applying compass heading rotation to a side-profile vehicle caused it to face 90° to 180° perpendicular to the true road travel direction.
2. **Missing Heading Transmission**:
   - `LiveLocationControl.tsx` acquired `heading` from browser GPS coordinates, but omitted it from the `POST /api/rides/[id]/location` request payload.
   - The backend handler did not accept or store `heading`, resulting in recipient subscriber polling receiving `heading: null`.
3. **Discontinuous / Stalling Updates**:
   - Leading-edge throttling in `LiveLocationControl.tsx` dropped any GPS coordinate fixes that fired within 3000ms of a previous fix without queuing a trailing-edge dispatch.
   - In many desktop browsers or when stationary, `navigator.geolocation.watchPosition` stops firing events after the initial acquisition.
4. **Leaflet Pan/Zoom Transform Conflict**:
   - A CSS transition on `.driver-moving-vehicle-icon { transition: transform ... }` was applied to Leaflet's marker container. Leaflet uses `transform: translate3d(...)` for its coordinate positioning. The CSS transition interfered with Leaflet's projection during map panning and zooming, causing the vehicle pointer to drift, lag, or jump away from its true geographic position.

### Solution & Key Changes
1. **Top-Down Vehicle Model & Correct Direction (0° = North)**:
   - Designed a crisp top-down vehicle SVG silhouette in [`RouteMapClient.tsx`](src/components/RouteMapClient.tsx) oriented straight UP (0° North) with front headlights, windshield, side mirrors, and a prominent forward directional beacon.
   - Clockwise CSS rotation (`0°` = North/Up, `90°` = East/Right, `180°` = South/Down, `270°` = West/Left) precisely aligns with standard compass bearing.
   - Implemented shortest-angle continuous rotation path arithmetic (e.g. crossing 350° to 10° smoothly rotates +20° clockwise rather than 340° counter-clockwise).
   - Rotation is applied to an isolated inner `.vehicle-puck-rotator` element, preventing any interference with Leaflet's marker container.
2. **Smooth Coordinate Animation without Marker Duplication**:
   - Built a dedicated `<MovingVehicleMarker>` component inside `RouteMapClient.tsx`.
   - Smoothly interpolates coordinates across update intervals using `requestAnimationFrame` with ease-out cubic deceleration directly calling Leaflet's native `marker.setLatLng()`.
   - Maintains a single stable marker instance throughout the ride lifecycle; never spawns duplicate markers or visual ghosting.
   - Removed the conflicting `.driver-moving-vehicle-icon` CSS transition from [`src/app/globals.css`](src/app/globals.css).
3. **Continuous GPS Transmission & Trailing-Edge Throttling**:
   - Updated [`LiveLocationControl.tsx`](src/components/LiveLocationControl.tsx) to capture all position updates into a queue with trailing-edge dispatch: if updates occur within the 2.5s cadence window, the latest fix is always transmitted once the cooldown expires.
   - Added a periodic fallback interval (`navigator.geolocation.getCurrentPosition`) every 4s alongside `watchPosition` so stationary or slow-moving devices continue sending heartbeats.
   - Sent `heading` and `speed` in the `POST` payload.
4. **Server-Side Telemetry Cache & Bearing Fallback**:
   - In [`src/app/api/rides/[id]/location/route.ts`](src/app/api/rides/[id]/location/route.ts), added a high-performance in-memory `liveTelemetryMap` cache storing transient `heading`, `speed`, and previous coordinates.
   - When device compass heading is unavailable, the server automatically computes forward bearing between consecutive valid GPS coordinates.
   - Retains the previous valid heading when stationary (< 3 meters movement) to prevent erratic compass spinning at traffic stops.
   - Strictly enforces authorization: only the ride's driver can publish; participants and platform admins can view.
5. **Passenger Subscriber & Driver Broadcast Protection**:
   - In [`LiveLocationSubscriber.tsx`](src/components/LiveLocationSubscriber.tsx), prioritized server-returned `data.heading` with local bearing and stationary preservation fallbacks.
   - In [`ActiveRideLocationMap.tsx`](src/components/ActiveRideLocationMap.tsx), prevented subscriber polling from overwriting the driver's fresh local GPS fixes.

### Files Modified
- [`src/app/api/rides/[id]/location/route.ts`](src/app/api/rides/[id]/location/route.ts): Added telemetry caching, bearing calculation, heading/speed payload parsing, stationary heading retention, and strict authorization.
- [`src/components/LiveLocationControl.tsx`](src/components/LiveLocationControl.tsx): Added trailing-edge throttle, fallback interval polling, heading transmission, and lifecycle cleanup.
- [`src/components/LiveLocationSubscriber.tsx`](src/components/LiveLocationSubscriber.tsx): Added server heading consumption, bearing fallback, and stationary orientation preservation.
- [`src/components/RouteMapClient.tsx`](src/components/RouteMapClient.tsx): Added top-down vehicle SVG (0° North), `MovingVehicleMarker` with RAF glide, and shortest-angle rotation.
- [`src/components/ActiveRideLocationMap.tsx`](src/components/ActiveRideLocationMap.tsx): Prevented driver local broadcast from being overwritten by subscriber polling.
- [`src/app/globals.css`](src/app/globals.css): Removed conflicting Leaflet marker CSS transform transition.

### Test Verification Results
- **Directional Bearing Tests**:
  - North: `0.00°` (Expected: ~0° / 360°) — Passed.
  - East: `90.00°` (Expected: ~90°) — Passed.
  - South: `180.00°` (Expected: ~180°) — Passed.
  - West: `270.00°` (Expected: ~270°) — Passed.
  - North-East: `43.47°` (Expected: ~43-46°) — Passed.
- **Shortest Angle Rotation Tests**:
  - Crossing 360° clockwise (350° → 10°): Delta `+20°` — Passed.
  - Crossing 0° counter-clockwise (10° → 350°): Delta `-20°` — Passed.
  - Standard turn (40° → 90°): Delta `+50°` — Passed.
- **Stationary Threshold**: Movement < 3m preserves previous heading angle — Verified.
- **Build & Quality Checks**:
  - `npx tsc --noEmit`: 0 errors.
  - `npm run lint`: 0 errors, 0 warnings.

### Remaining Limitations
- **Hardware Limitations**: Laptops or desktop browsers without dedicated GPS/magnetometer hardware report `heading: null` from the Geolocation API. In such cases, the system seamlessly falls back to calculating bearing from consecutive coordinates once the vehicle moves >= 3 meters.

---

## COMPLETED — RIDE LIFECYCLE, PASSENGER SYNC & SAFETY SYSTEM

### Verified User Flows & Functionality
- **Ride Lifecycle**: `SCHEDULED` → `ACTIVE` → `COMPLETED` (and `CANCELLED`). Controlled strictly by the ride's driver (`▶ Start Ride` and `✓ End Ride`).
- **End Ride Confirmation Modal**: Driver `End Ride` trigger presents confirmation dialog: *"End this ride? This will mark the ride as completed for all passengers."*
- **Passenger Window Synchronization**: Passenger view & dashboard poll status every 4s during active/scheduled rides, automatically re-rendering via Next.js `router.refresh()` when the driver ends the ride in another window.
- **Active Ride Publishing Restriction**: `POST /api/rides` prevents drivers with an `ACTIVE` ride from publishing another ride until current ride is completed or cancelled. Multiple `SCHEDULED` rides remain permitted.
- **Passenger SOS System**: Passengers with confirmed bookings on `ACTIVE` rides can trigger `🚨 SOS / Emergency` with a confirmation modal and optional browser GPS capture (falls back gracefully if location is unavailable/timed out).
- **Emergency Email Notification**: `sendEmergencyEmail()` uses Nodemailer SMTP integration to send real-time emergency alert emails to passenger emergency contacts.
- **Privacy Protection**: Emergency contact details are strictly private to account owners. Public interfaces display only non-sensitive indicators (`🛡️ Emergency contact configured`).

---

## COMPLETED — POST-RIDE RATINGS & REVIEWS SYSTEM

### Verified User Flows & Functionality
- **Completed Ride Rating Eligibility**: Rating submission is permitted ONLY when `ride.status === "COMPLETED"` and the user was a confirmed participant (driver or passenger with confirmed booking).
- **Passenger Rating Driver**: Passengers rate the driver (1–5 stars + optional text review up to 500 characters) directly on the completed ride page or via dashboard prompts.
- **Driver Rating Passengers**: Drivers can rate each individual confirmed passenger on a completed ride.
- **Duplicate Prevention**: Database-level `@@unique([rideId, reviewerId, revieweeId])` and server-side checks ensure each participant can rate each other at most once per completed ride.
- **Immutable Reviews**: Submitted ratings cannot be edited or overwritten.
- **Profile Ratings & Reviews**: User profiles (`/profile`) dynamically display average community rating (`★ X.X / 5`), review count, and a detailed list of received reviews.

---

## COMPLETED — OFFICIAL BRANDING & NAVBAR LOGO INTEGRATION

### Verified User Flows & Functionality
- **Official TPool Logo Asset**: Stored in `public/logo.png`.
- **Responsive Header Branding**: Replaced text branding in `src/components/Navbar.tsx` with a responsive Next.js `Image` component (`alt="TPool"`, priority loaded, maintaining proper aspect ratio).

---

## COMPLETED — RIDE WORKFLOW, BACK NAVIGATION & CHAT STRUCTURE

### Verified User Flows & Functionality
- **Automatic Driver Request Detection**: `DriverRequestSync.tsx` polls `GET /api/bookings` every 4 seconds on the Driver Dashboard to auto-detect incoming passenger requests without full page reloads or memory leaks.
- **Logical Back Navigation**: Integrated `BackButton.tsx` on search results, ride details, publish ride, and verification portal pages.
- **Structured Ride Chat UI**: Re-architected `RideChat.tsx` with a participant header, driver badge indicators, scrollable conversation container with auto-scroll to latest messages, timestamped bubbles, and composer input supporting Enter key submission.

---

## COMPLETED — DYNAMIC POOLING, MULTI-STOP DETOUR ROUTING & LIVE FARE SYNCHRONIZATION

### Discovered Original Rules & Logic
- **Pickup Radius Limits**:
  - `Private Car Pool`: Maximum **0.5 km** (500 meters) perpendicular distance from the driver's route trajectory.
  - `Cab Pool` & `Personal Cab`: Maximum **1.0 km** (1,000 meters) perpendicular distance from the driver's route trajectory.
  - *Source of Truth*: Verified in [`src/app/search/page.tsx:104`](src/app/search/page.tsx#L104) and enforced in [`src/lib/dynamicRouting.ts`](src/lib/dynamicRouting.ts).
- **Direction-Matching Rule**:
  - Passenger pickup projection must precede their drop-off projection along the driver's forward route:
    `pickupInfo.minIndex < dropInfo.minIndex || (pickupInfo.minIndex === dropInfo.minIndex && pickupInfo.minProj.t <= dropInfo.minProj.t)`.
  - Trips travelling in the reverse direction or with drop-offs before pickups are rejected.
  - *Source of Truth*: [`src/app/search/page.tsx:111`](src/app/search/page.tsx#L111) and [`src/lib/geo.ts:111`](src/lib/geo.ts#L111).
- **Vehicle Base Rates**:
  - `Personal Cab`: ₹20 / km
  - `Private Car Pool`: ₹10 / km
  - `Cab Pool`: ₹20 / km
  - *Source of Truth*: [`src/lib/fareCalculator.ts`](src/lib/fareCalculator.ts).
- **Detour Charges**:
  - `pickupDetourFare = (pickupDetourMeters / 1000) * 20` (₹20 / km)
  - `dropDetourFare = (dropDetourMeters / 1000) * 20` (₹20 / km)
  - Applied to `Private Car Pool` and `Cab Pool` (₹0 for `Personal Cab`).
- **Platform Fees & Incentives**:
  - Platform Fee: Flat **3%** of subtotal (`subtotal * 0.03`).
  - Cab Pool Incentive: Flat **₹3** (`poolingIncentive = 3`).
- **Fare Formulas**:
  - `subtotal = mainRouteFare + pickupDetourFare + dropDetourFare + poolingIncentive`
  - `passengerTotal = subtotal + platformFee`
- **Booking Acceptance Workflow**:
  - Passenger submits booking via `POST /api/bookings` with pickup and drop-off coordinates (`status: "PENDING"`, seats held).
  - Driver reviews pending request on `/dashboard` and clicks `CONFIRM` or `REJECT` via `PATCH /api/bookings/[id]`.
  - When confirmed, `recalculateRideRouteAndFares` dynamically reorders all corridor stops, queries Valhalla for multi-stop road route geometry, calculates passenger road segment distances, recalculates passenger fares, and persists the new route geometry and fares.
  - When rejected or cancelled, the booking is removed from the route corridor, seats are restored, and the route/fares are recalculated without the removed passenger.

### Dynamic Routing Engine (`src/lib/dynamicRouting.ts`)
1. **Passenger Corridor Eligibility**:
   - `checkPassengerEligibility`: Evaluates passenger pickup and drop-off points against the driver's route polyline using segment projection.
   - Enforces the 0.5km / 1.0km radius threshold and verifies forward travel direction.
   - Computes initial corridor segment distance and detour fares.
2. **Multi-Stop Detour Recalculation**:
   - `recalculateRideRouteAndFares`: Gathers driver origin, driver destination, and all confirmed passengers' pickup and drop-off points.
   - Projects all passenger stops onto the route and sorts them in sequential order from driver origin to driver destination.
   - Submits sequential multi-stop waypoints to the Valhalla routing API (`costing: "auto"`).
   - Decodes Polyline-6 into GPS coordinates and measures true road distances between each confirmed passenger's pickup and drop-off points.
   - Calculates updated fares using existing vehicle rates and detour formulas.
   - Persists `ride.routeGeometry`, `ride.distance`, `ride.duration`, `ride.routeUpdatedAt`, and `booking.fare` in SQLite.
3. **Fallback & Resilience**:
   - If Valhalla routing fails or returns an error, the engine logs a warning and preserves the last valid route geometry, distance, and existing fares without crashing or corrupting data.

### Automatic Live Updates & Synchronization
1. **Live Status Polling**:
   - `GET /api/rides/[id]/status` returns `routeVersion` (timestamp), `userFare`, `confirmedCount`, `routeGeometry`, and `stops` list.
   - `PassengerWindowSync.tsx` polls every 3.5s. When `routeVersion` or `userFare` changes, it automatically triggers Next.js `router.refresh()` to update ride cards and fare displays without manual page reload.
2. **Live Map Synchronization**:
   - `ActiveRideLocationMap.tsx` and `RouteMapClient.tsx` receive updated `routeGeometry` and `stops` in real-time.
   - Dynamically updates the route polyline and renders distinct pickup (green) and drop-off (red) markers with popups for confirmed stops.
   - Independent vehicle tracking: GPS location broadcast and moving vehicle pointer operate smoothly and independently on their own layer without map resets, duplicate markers, or jitter.

### Files Modified
- [`prisma/schema.prisma`](prisma/schema.prisma): Added `routeGeometry` and `routeUpdatedAt` to `Ride`; added `pickupLocation`, `pickupLat`, `pickupLon`, `dropLocation`, `dropLat`, `dropLon`, and `updatedAt` to `Booking`.
- [`src/lib/dynamicRouting.ts`](src/lib/dynamicRouting.ts): Core dynamic routing engine (eligibility check, waypoint ordering, Valhalla multi-stop routing, road segment distance measurement, fare recalculation, and resilient fallback).
- [`src/app/api/bookings/route.ts`](src/app/api/bookings/route.ts): Geocodes passenger pickup/drop-off, checks corridor eligibility, computes dynamic segment fare, and persists pickup/drop coordinates.
- [`src/app/api/bookings/[id]/route.ts`](src/app/api/bookings/[id]/route.ts): Triggers `recalculateRideRouteAndFares` on driver `CONFIRM`, `REJECT`, or passenger `CANCEL`.
- [`src/app/api/rides/[id]/status/route.ts`](src/app/api/rides/[id]/status/route.ts): Supplies `routeVersion`, `userFare`, `confirmedCount`, `routeGeometry`, and confirmed `stops` for live synchronization.
- [`src/components/RouteMap.tsx`](src/components/RouteMap.tsx) & [`src/components/RouteMapClient.tsx`](src/components/RouteMapClient.tsx): Support `routeGeometry` and `stops` props, rendering persisted detour polyline and color-coded stop markers.
- [`src/components/ActiveRideLocationMap.tsx`](src/components/ActiveRideLocationMap.tsx): Background sync for live detour route polyline and stop markers.
- [`src/components/PassengerWindowSync.tsx`](src/components/PassengerWindowSync.tsx): Detects route updates and fare changes to trigger immediate UI refresh.
- [`src/app/rides/[id]/page.tsx`](src/app/rides/[id]/page.tsx): Supplies route geometry, confirmed stops, and dynamic passenger fares to UI and map components.

### Automated Test Verification Results
- **Dynamic Routing & Fares Test Suite** (`scripts/test-routing-fares.ts`):
  - Forward corridor passenger eligibility: **Passed** (Shivajinagar → Bavdhan, pickup detour 32m, drop detour 7m, fare ₹85.41).
  - Pickup radius limit enforcement: **Passed** (Katraj ~7.88km away rejected).
  - Direction matching validation: **Passed** (Reverse direction rejected with "Passenger travel direction does not match the driver's route direction").
  - Cab Pool 1.0km threshold: **Passed** (102m detour accepted).
  - Vehicle rates, detours, and platform fee formulas:
    - Personal Cab (10km @ ₹20/km + 3% fee): **₹206.00** — **Passed**.
    - Private Car Pool (10km @ ₹10/km + 500m pickup detour + 300m drop detour + 3% fee): **₹119.48** — **Passed**.
    - Cab Pool (10km @ ₹20/km + 500m detour + ₹3 incentive + 3% fee): **₹219.39** — **Passed**.
  - Valhalla multi-stop route recalculation: **Passed** (169 polyline coordinates generated and persisted; route distance measured at 5.65 km).
  - Fallback resilience: **Passed** (Gracefully handles routing failure without data corruption).
- **Booking Acceptance & Route Recalculation Flow** (`scripts/test-booking-flow.ts`):
  - Booking creation with detour pickup and drop-off: **Passed**.
  - Driver `CONFIRM` triggers dynamic multi-stop routing: **Passed**.
  - Route distance updated from 5.65 km to 8.21 km (accounting for detour): **Passed**.
  - Passenger fare updated dynamically to ₹21.75: **Passed**.
  - `routeGeometry` and `routeUpdatedAt` persisted: **Passed**.
- **Code Quality Checks**:
  - TypeScript compiler (`npx tsc --noEmit`): **0 errors**.
  - ESLint (`npm run lint`): **0 errors, 0 warnings**.

### Limitations & Edge Cases
- **Public Valhalla API Rate Limits**: In high-traffic production environments, self-hosting Valhalla or caching frequent route corridor segments is recommended.
- **Extreme Detours**: Passengers with pickup points exceeding 0.5 km (Private Car Pool) or 1.0 km (Cab Pool) are automatically flagged as ineligible to safeguard the driver's travel schedule.

---

## COMPLETED — TALEGAON DABHADE LOCATION SEARCH COVERAGE IMPROVEMENTS

### Root Cause Analysis
Prior to this improvement, local location search in TPool relied exclusively on an uncurated query to the public `photon.komoot.io` OpenStreetMap geocoder. This led to significant coverage and relevance gaps for users in Talegaon Dabhade:
1. **Missing Unmapped / Recent Landmarks in OSM**:
   - Commercial and retail complexes such as **Zudio** and **Star Bazaar** (located in "The Pinnacle", Tukaram Nagar) and newer residential developments such as **Real Dream Home** (Ambi Road, Varale, RERA P52100021993) were absent from OpenStreetMap.
2. **Naming Discrepancies & False Matches in OSM**:
   - In OSM, DMart was indexed as "D Mart Talegaon" (with a space). Searching "DMart" without space resulted in Photon returning matches from Mahlunge or Pune City instead of the local Talegaon branch.
   - Searching "Harneshwar Hospital" yielded no medical POI in OSM (only "Shree Harneshwar Clinic" and "Harneshwar Society" were mapped). Photon frequently matched distant places in Gujarat or Ahmedabad containing similar syllables.
3. **Absence of Geographic Bias**:
   - Raw queries lacked local coordinate biasing (`lat=18.735, lon=73.675`), causing common search queries like "Station" to prioritize railway stations hundreds of kilometers away rather than Talegaon Railway Station.
4. **Third-Party API Fragility**:
   - The public Photon API intermittently experienced connection drops (`ECONNREFUSED` or timeouts), leaving users without autocomplete options or geocoding resolution.

---

### Solution Architecture

#### 1. Curated Real-World Landmark Dataset (`src/data/talegaonLandmarks.ts`)
Created an extensible, verified local registry of real geographic places across Talegaon Dabhade and surrounding regions, complete with real GPS coordinates, categories, and search aliases:
- **Shopping**:
  - `DMart, Talegaon Dabhade` (`18.7296, 73.6708`) — Aliases: `d-mart`, `d mart`, `dmart talegaon`.
  - `Zudio, The Pinnacle` (`18.7213, 73.6685`) — Co-located with Star Bazaar in Tukaram Nagar.
  - `Star Bazaar, The Pinnacle` (`18.7213, 73.6685`) — Co-located with Zudio in Tukaram Nagar.
  - `Reliance Smart Point, Station Road` (`18.7335, 73.6765`).
  - `Talegaon Weekly Market / Mandai` (`18.7365, 73.6845`).
  - `More Supermarket, Jijamata Chowk` (`18.7342, 73.6780`).
- **Hospitals & Healthcare**:
  - `Harneshwar Multispeciality Hospital` (`18.7336, 73.6647`) — Talegaon Station Road.
  - `MIMER Medical College & Dr. B.S.T.R. Hospital` (`18.7352, 73.6751`).
  - `Pawana Hospital, Somatane Phata` (`18.7115, 73.6742`).
  - `Samartha Multispeciality Hospital` (`18.7277, 73.6792`).
  - `Unique Multispeciality Hospital`, `Atharva Hospital`, `Sevadham Hospital`.
- **Residential Areas & Societies**:
  - `Real Dream Home, Ambi Road` (`18.7297, 73.6792`) — Survey No. 72, Varale / Ambi Road.
  - `Naiknavare Neelaya` (`18.7213, 73.6685`).
  - `Namrata Eco City 1 & 2, Varale Road` (`18.7380, 73.6890`).
  - `Harneshwar Society, Station Road` (`18.7340, 73.6650`).
  - `Yashada Splendid Park`, `Lake Paradise`, `Royal Palms`, `Swaraj Nagari`, `Yashwant Nagar`, `Tukaram Nagar`.
- **Transport Hubs & Junctions**:
  - `Talegaon Railway Station` (`18.7367, 73.6705`).
  - `Talegaon ST Bus Stand` (`18.7347, 73.6713`).
  - `Maruti Mandir Chowk` (`18.7339, 73.6745`).
  - `Jijamata Chowk` (`18.7342, 73.6782`).
  - `Limb Phata` (`18.7245, 73.6712`).
  - `Somatane Phata Junction` (`18.7110, 73.6745`).
  - `Talegaon Toll Plaza (Pune-Mumbai Expressway)` (`18.7085, 73.6880`).
  - `Wadgaon Phata` (`18.7450, 73.6450`).
- **Education Institutions**:
  - `IIIT Pune (Indian Institute of Information Technology)` (`18.7659, 73.6848`) — Survey No. 25, Near Bopkhel / MIDC.
  - `D.Y. Patil College of Engineering (Ambi)` (`18.7485, 73.6920`).
  - `NMIET - Nutan Maharashtra Institute of Engineering & Technology` (`18.7325, 73.6610`).
  - `NCER - Nutan College of Engineering and Research` (`18.7330, 73.6605`).
  - `Tolani Maritime Institute (TMI), Induri` (`18.7635, 73.7140`).
  - `Indira College of Pharmacy`, `Mount St. Ann High School`.
- **Landmarks, Temples & Banking**:
  - `Harneshwar Shiv Mandir` (`18.7375, 73.6646`).
  - `Birla Ganpati Temple, Somatane` (`18.7110, 73.6780`).
  - `Talegaon Lake / Dhamne Dam` (`18.7290, 73.6620`).
  - `HP Petrol Pump, Talegaon Chakan Road` (`18.7350, 73.6820`).
  - `Indian Oil Petrol Pump, Station Road` (`18.7330, 73.6670`).
  - `State Bank of India (SBI), Talegaon Branch` (`18.7345, 73.6720`).
  - `Bank of Maharashtra, Maruti Chowk` (`18.7340, 73.6750`).
- **Regional Hubs (Cross-Town Trips)**:
  - `Pune Railway Station` (`18.5284, 73.8739`).
  - `Shivajinagar Station & Bus Stand` (`18.5314, 73.8446`).
  - `Hinjewadi Phase 1 / Rajiv Gandhi Infotech Park` (`18.5913, 73.7389`).
  - `Wakad Chowk` (`18.5987, 73.7634`).
  - `Lonavala Railway Station` (`18.7504, 73.4069`).
  - `Pune International Airport (PNQ)` (`18.5804, 73.9182`).
  - `Mumbai Chhatrapati Shivaji Maharaj International Airport (BOM)` (`19.0968, 72.8744`).

#### 2. Hybrid Multi-Tier Search Engine (`src/lib/locationSearch.ts`)
- **Multi-Tier Matching**:
  1. Exact and normalized prefix matching against landmark names.
  2. Synonym and alias matching (e.g. `d-mart` -> `DMart`, `station` -> `Talegaon Railway Station`).
  3. Tokenized word-boundary matching (e.g. `dream home` -> `Real Dream Home`).
- **Geographically Biased Remote Search**:
  - Injects `lat=18.735&lon=73.675` into Photon OpenStreetMap search queries to bias global results toward the Talegaon/Mawal corridor.
- **High-Availability Remote Fallback**:
  - Wraps Photon requests in an `AbortController` (2.5s timeout).
  - Automatically falls back to OpenStreetMap Nominatim if Photon is unreachable or errors out.
- **Proximity Scoring & Smart Deduplication**:
  - Results are scored using Haversine distance from Talegaon Dabhade's center (+45 points for < 8km, +30 points for < 25km, penalty for > 500km).
  - Deduplicates remote and local results within 300 meters or identical names within 1.5 km, preventing duplicate entries.
- **Instant Geocoding Resolver (`resolveLocationText`)**:
  - Synchronous lookup utility that resolves raw location strings directly to verified coordinates without network overhead.

#### 3. UI and Autocomplete Improvements (`src/components/LocationInput.tsx`)
- Integrated `searchLocations` with debounced input (250ms).
- Added contextual category icons (`ShoppingBag`, `Hospital`, `Building`, `Train`, `GraduationCap`, `MapPin`).
- Displays a prominent `"Talegaon"` badge for all verified local landmarks.
- Displays structured two-line suggestions (Primary Title and Detailed Subtitle/Address).
- Preserves keyboard accessibility (arrow navigation, Enter to select, Escape to close).

#### 4. Backend Geocoding & Map Integration
- Updated [`src/lib/geo.ts`](src/lib/geo.ts): `geocode(query)` evaluates `resolveLocationText` first, providing instantaneous coordinate resolution for rides and bookings created with local landmarks before calling external APIs.
- Updated [`src/components/RouteMapClient.tsx`](src/components/RouteMapClient.tsx): Resolves local landmarks immediately, improving map rendering speed and route drawing accuracy.

---

### Files Modified & Created
- [`src/data/talegaonLandmarks.ts`](src/data/talegaonLandmarks.ts): Curated landmark dataset covering all required categories, coordinates, and aliases.
- [`src/lib/locationSearch.ts`](src/lib/locationSearch.ts): Hybrid search engine with multi-tier matching, geographic bias, Photon + Nominatim fallback, scoring, and deduplication.
- [`src/components/LocationInput.tsx`](src/components/LocationInput.tsx): Autocomplete UI with category icons, local badges, and debounced search.
- [`src/lib/geo.ts`](src/lib/geo.ts): Integrated instant local geocoding resolution.
- [`src/components/RouteMapClient.tsx`](src/components/RouteMapClient.tsx): Client-side map location resolution with local landmark cache.
- [`scripts/test-location-search.ts`](scripts/test-location-search.ts): Automated test suite covering all target landmarks, variations, regional hubs, and backend geocoding.

---

### Test Verification Results
Run automated suite: `npx tsx scripts/test-location-search.ts`

- **1. Required Landmark Searches & Coordinates**:
  - **DMart**: Top result `DMart, Talegaon Dabhade` @ `[18.7296, 73.6708]` (0m error) — **PASS**.
  - **Harneshwar Hospital**: Top result `Harneshwar Multispeciality Hospital` @ `[18.7336, 73.6647]` (0m error) — **PASS**.
  - **Zudio**: Top result `Zudio, The Pinnacle` @ `[18.7213, 73.6685]` (0m error) — **PASS**.
  - **Star Bazaar**: Top result `Star Bazaar, The Pinnacle` @ `[18.7213, 73.6685]` (0m error) — **PASS**.
  - **Real Dream Home**: Top result `Real Dream Home, Ambi Road` @ `[18.7297, 73.6792]` (0m error) — **PASS**.
  - **Talegaon Railway Station**: Top result `Talegaon Railway Station` @ `[18.7367, 73.6705]` (0m error) — **PASS**.
- **2. Partial Names & Variations**:
  - `"d-mart"` matches `DMart` — **PASS**.
  - `"zudi"` matches `Zudio` — **PASS**.
  - `"harne"` matches `Harneshwar Hospital` — **PASS**.
  - `"dream home"` matches `Real Dream Home` — **PASS**.
  - `"station"` matches `Talegaon Railway Station` — **PASS**.
  - `"iiit"` matches `IIIT Pune` — **PASS**.
  - `"dy patil"` matches `D.Y. Patil College of Engineering (Ambi)` — **PASS**.
- **3. Regional & Out-of-Town Destinations**:
  - `"Pune Station"` returns `Pune Railway Station` @ `[18.5284, 73.8739]` — **PASS**.
  - `"Lonavala"` returns `Lonavala Railway Station` @ `[18.7504, 73.4069]` — **PASS**.
  - `"Hinjewadi"` returns `Hinjewadi Phase 1` @ `[18.5913, 73.7389]` — **PASS**.
- **4. Backend `geocode()` Resolution**:
  - All 6 target landmarks resolve directly to exact expected coordinates via `src/lib/geo.ts` — **PASS**.
- **5. Dynamic Routing & Fare Calculation Integrity**:
  - `npx tsx scripts/test-routing-fares.ts` — **ALL PASS** (0 regressions).
- **6. Code Quality**:
  - `npx tsc --noEmit`: **0 errors**.
  - `npm run lint`: **0 errors, 0 warnings**.

---

### Coverage Limitations & Maintenance
- **Data Source Extensibility**: The local dataset in `src/data/talegaonLandmarks.ts` is typed via `TalegaonLandmark`. New residential societies, retail outlets, or clinics in Talegaon can be added by appending a new object with `name`, `aliases`, `category`, `lat`, `lon`, and `subtitle`.
- **Hybrid Balance**: Searching for places outside Talegaon (e.g. "Kothrud", "Bandra", "Hadapsar") query Photon and Nominatim with automatic ranking. When local landmarks match the query, they are given a score boost, ensuring users in Talegaon are never presented with distant duplicates unless explicitly requested.

---

## COMPLETED — DETOUR FARE CALCULATION & SHARED DETOUR ALLOCATION ENGINE

### Root Cause Analysis
Prior to this fix, detour fare calculation and multi-stop rerouting suffered from three critical issues:
1. **Multi-Stop Intermediate Leg Absorption (Price Jumps)**:
   - In `recalculateRideRouteAndFares`, when multiple passengers booked a ride, a passenger's segment distance was calculated by summing all intermediate route legs between their pickup index and drop index.
   - Consequently, if a driver made a 3.8 km detour for Passenger B, Passenger A (traveling along the direct corridor from Talegaon Station to IIIT Pune) was forced to absorb Passenger B's detour distance, causing their fare to jump from ₹65.92 on the search card to ₹115.36 or higher on the dashboard.
2. **Loss of Baseline Reference Route**:
   - When a booking with detours was accepted, `ride.routeGeometry` and `ride.distance` were overwritten with the detoured polyline. When subsequent passengers booked or eligibility was checked, the detour was evaluated against an already-distorted polyline rather than the driver's true origin-to-destination corridor.
3. **Double-Counting Shared Detours & Euclidean Detour Estimation**:
   - Detour distance was previously estimated via perpendicular Euclidean distance rather than actual road distance through the routing provider (Valhalla).
   - If two passengers shared the same off-route location (e.g., both picked up or dropped off at Ambi), both passengers were charged the full detour fee, resulting in the driver collecting double the extra mileage driven.

---

### Discovered Pricing Formulas & Rules Reused
Existing vehicle rates, detour rules, and platform fees were identified from `src/lib/fareCalculator.ts`, `src/lib/dynamicRouting.ts`, and `PROJECT_CONTEXT.md` and reused without altering any values:

- **Base Vehicle Rates**:
  - `Personal Cab`: ₹20 / km
  - `Private Car Pool`: ₹10 / km
  - `Cab Pool`: ₹20 / km
- **Detour Charges**:
  - `pickupDetourFare = (allocatedPickupDetourMeters / 1000) * 20` (₹20 / km)
  - `dropDetourFare = (allocatedDropDetourMeters / 1000) * 20` (₹20 / km)
- **Incentives & Platform Fees**:
  - `Cab Pool` Incentive: ₹3.00 flat credit added to subtotal
  - Platform Fee: Flat 3% calculated on the subtotal: `platformFee = subtotal * 0.03`
  - Total Passenger Fare: `passengerTotal = subtotal + platformFee`

---

### Implementation Details

#### 1. Baseline Route A → B Preservation
- Added `baseRouteGeometry: String?` and `baseDistance: Float?` to the `Ride` model in [`prisma/schema.prisma`](prisma/schema.prisma).
- On ride publication (`POST /api/rides`), the direct A → B route polyline and distance are fetched from Valhalla and permanently recorded in `baseRouteGeometry` and `baseDistance`.
- In `recalculateRideRouteAndFares`, all passenger projections and detours are evaluated strictly against `baseRouteGeometry`. When the route updates with passenger stops, `routeGeometry` reflects the complete multi-stop driving path, while `baseRouteGeometry` remains untouched and identifiable forever.

#### 2. Actual Road Detour Calculation
- Implemented `calculateRoadDetourDistance(point, baselinePolyline)`:
  - If a passenger stop is within 50 meters (0.05 km) of the baseline polyline, it is considered directly on-route (`detourMeters = 0`).
  - If a stop exceeds 50 meters, the routing provider queries Valhalla for the actual road route from the closest baseline corridor road point to the stop (`fetchRoadDistance(nearestBaselinePoint, point)`).
  - Falls back gracefully to projection distance if the routing provider is unreachable.

#### 3. Passenger Normal Segment Separation
- Passenger normal fare is calculated strictly for their own journey segment along the baseline corridor (between baseline entry projection $X_P$ and exit projection $X_D$).
- If both pickup and drop-off are on-route, `fetchRoadDistance(pickup, drop)` calculates the direct road distance.
- Unaffected passengers traveling along their normal corridor pay ₹0 detour fees and are completely insulated from other passengers' detours.

#### 4. Shared Detour Allocation Formula (No Double-Counting)
When multiple passengers share the same off-route detour:
- Off-route stops within a 300-meter (0.3 km) geographic radius are clustered together.
- For each cluster $C$ containing $N_C$ passengers:
  $$\text{AllocatedDetour}(p) = \frac{\max_{s \in C} \text{detourDistance}(s)}{N_C}$$
- Each sharing passenger pays an equal $1/N$ fraction of the detour fee.
- Total detour charges across all passengers equal exactly the actual extra distance driven. No distance is double-counted.

#### 5. Automatic Live Synchronization & Fault Tolerance
- Stored booking fields: `fare` (total), `mainFare` (base segment), `detourFare`, `detourDistance`, and structured `fareBreakdown` JSON.
- `GET /api/rides/[id]/status` delivers `userFare`, `userMainFare`, `userDetourFare`, `userDetourDistance`, and `userFareBreakdown`.
- Background pollers in `PassengerWindowSync.tsx` and `ActiveRideLocationMap.tsx` automatically refresh fares and route polylines without manual reload.
- If Valhalla routing encounters network failure or errors, `recalculateRideRouteAndFares` catches the error and preserves the last valid route and fares without throwing or corrupting the database.

---

### Automated Test Verification Results
Run automated suite: `npx tsx scripts/test-detour-fares.ts`

- **Test 1: Baseline Route Identification & Preservation**:
  - `baseRouteGeometry` and `baseDistance` (7207m) permanently saved on ride — **PASS**.
- **Test 2: On-Route Passenger**:
  - Passenger from Talegaon Station Corridor to IIIT Pune Gate on baseline route:
  - Pickup detour: `0m`, Drop detour: `0m`, Detour fee: `₹0.00` — **PASS**.
  - Normal fare: `₹118.49` (5.75 km @ ₹20/km + 3% fee) — **PASS**.
  - Stored `detourFare` = `₹0.00`, `detourDistance` = `0m` — **PASS**.
- **Test 3: Off-Route Pickup**:
  - Passenger with pickup at Real Dream Home (1548m off-route) to IIIT Pune:
  - Pickup detour: `1548m`, Detour fare: `₹30.96` — **PASS**.
  - Passenger 1 (on-route) detour fare remains `₹0.00` and normal fare remains stable at `₹118.49` with zero leakage — **PASS**.
- **Test 4: Shared Detour Allocation (No Double-Counting)**:
  - Passenger 3 solo drop-off at Ambi: detour `2415m`, detour fare `₹48.30`.
  - When Passenger 4 joins at Ambi (shared cluster $\le 300\text{m}$):
    - Passenger 3 detour distance: `1208m` (halved) — **PASS**.
    - Passenger 4 detour distance: `1208m` (equal share) — **PASS**.
    - Total detour distance charged: `2415m` (exact match to distance driven, NO double-counting) — **PASS**.
    - Passenger 1 (on-route) STILL pays `₹0.00` detour — **PASS**.
- **Test 5: Baseline Route Persistence**:
  - Multi-stop route distance expanded to `13181m` to reflect passenger detours while `baseRouteGeometry` and `baseDistance` remain identical to baseline — **PASS**.
- **Test 6: Routing Failure Fallback**:
  - Invalid ride ID or network failure handled gracefully without throwing or data corruption — **PASS**.
- **Test 7: Regression Suites**:
  - `scripts/test-routing-fares.ts` — **ALL PASS**.
  - `scripts/test-booking-flow.ts` — **ALL PASS**.
- **Test 8: Code Quality**:
  - `npx tsc --noEmit`: **0 errors**.

---

### Files Modified & Created
- [`prisma/schema.prisma`](prisma/schema.prisma): Added `baseRouteGeometry` and `baseDistance` to `Ride`; added `mainFare`, `detourFare`, `detourDistance`, and `fareBreakdown` to `Booking`.
- [`src/lib/dynamicRouting.ts`](src/lib/dynamicRouting.ts): Baseline route preservation, `calculateRoadDetourDistance`, shared detour clustering and equal allocation ($D/N$), normal segment fare separation, and failure fallback.
- [`src/lib/fareCalculator.ts`](src/lib/fareCalculator.ts): Added pickup and drop detour calculation to `Personal Cab` fare model.
- [`src/app/api/rides/route.ts`](src/app/api/rides/route.ts): Prefetches baseline direct route and stores `baseRouteGeometry` and `baseDistance` on ride creation.
- [`src/app/api/bookings/route.ts`](src/app/api/bookings/route.ts): Persists `mainFare`, `detourFare`, `detourDistance`, and `fareBreakdown` on booking creation.
- [`src/app/api/rides/[id]/status/route.ts`](src/app/api/rides/[id]/status/route.ts): Exposes user fare breakdown, main fare, detour fare, and detour distance for live sync.
- [`src/app/rides/[id]/page.tsx`](src/app/rides/[id]/page.tsx): Displays booking fare and detour breakdown in ride details header.
- [`src/app/dashboard/page.tsx`](src/app/dashboard/page.tsx): Updated booking card route title and subtitle; displays detour fee breakdown on passenger booking cards.
- [`src/app/search/page.tsx`](src/app/search/page.tsx): Evaluates route proximity and detours against `baseRouteGeometry` using `calculateRoadDetourDistance`.
- [`scripts/test-detour-fares.ts`](scripts/test-detour-fares.ts): Automated test suite for on-route, off-route pickup, off-route drop-off, shared detours, baseline persistence, and failure fallback.




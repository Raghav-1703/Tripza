# Project Context & Reference — TPool

## 1. Project Overview

**TPool** is a full-stack, college-focused ride-sharing and carpooling web platform. It enables students, faculty, and campus commuters traveling on identical or overlapping transit corridors to discover available rides, offer empty vehicle seats, split travel expenses, coordinate via in-app chat, trigger emergency SOS safety alerts, and rate co-travelers after completed rides.

- **Primary Goal**: Facilitate safe, affordable, and convenient carpooling for college commutes and regional travel (campus, railway/bus hubs, home towns).
- **Target Audience**: College students, faculty, and verified campus commuters.
- **Key Value Proposition**: Lowers travel costs, simplifies proximity-based route matching, enforces role-gated safety controls, and provides post-ride community accountability.
- **Role Separation**: Explicitly separates **DRIVER** responsibilities (publishing rides, starting/ending rides, managing passenger bookings, rating passengers), **PASSENGER** responsibilities (searching rides, reserving seats, configuring safety contacts, uploading student ID verification, triggering SOS alerts, rating drivers), and **ADMIN** responsibilities (managing users, reviewing & approving/rejecting driver and student verification documents with feedback, monitoring rides, inspecting booking disputes, resolving user reports, and monitoring real-time emergency SOS alerts).

---

## 2. Current Tech Stack

| Component | Technology | Description / Usage |
| :--- | :--- | :--- |
| **Frontend Framework** | Next.js 14.2.35 (App Router) | Server & Client Components (`src/app`), including user workflows and Admin Panel (`/admin`) |
| **UI Library & Styling** | Tailwind CSS v3.4.1 + Radix UI | Utility styling with Radix UI dialogs, select, labels, and badges |
| **Icons** | Lucide React v1.42.0 | Standard UI icons throughout the application |
| **Mapping & Geocoding** | Leaflet v1.9.4 & React-Leaflet v4.2.1 | Client-side Leaflet rendering (`RouteMapClient.tsx`) |
| **Place Autocomplete** | Photon API (by Komoot) | Location search autocomplete (`LocationInput.tsx`) |
| **Geocoding Fallback** | OpenStreetMap Nominatim | Address-to-coordinate resolution |
| **Routing Engine** | Valhalla API (`valhalla1.openstreetmap.de`) | Polyline shape decoding (Precision 6) and route distance calculation |
| **Backend Framework** | Next.js API Routes (Route Handlers) | Business logic, verification uploads, and REST endpoints (`src/app/api`) |
| **Database** | SQLite (`prisma/dev.db`) | Relational database storage |
| **ORM** | Prisma ORM v7.10.0 | Database access layer with `@prisma/adapter-libsql` adapter |
| **Authentication** | NextAuth.js v4.24.15 | Credentials provider with JWT session strategy & role verification (`USER`, `ADMIN`) |
| **Password Hashing** | bcryptjs v3.0.3 | Password hashing during registration & authentication verification |
| **Email Service** | Nodemailer v7.0.13 | SMTP integration for real-time emergency contact email notifications (with dev mock fallback) |
| **SMS Notification Service** | Twilio / Generic SMS Gateway Integration | Emergency SMS alerts to safety contacts via `sendEmergencySms()` (`SMS_PROVIDER_API_KEY`, `SMS_PROVIDER_FROM`) |
| **Language** | TypeScript v5 | Static typing across frontend and backend |

---

## 3. Project Architecture

### General Request Flow

```
Browser (User Client / Admin Panel)
    │
    ├── Next.js Server Components (Server Page Rendering & DB Fetching)
    └── Next.js Client Components (React 18, Radix UI, Leaflet, Geolocation, Document Upload)
            │
            ├── NextAuth.js JWT Middleware & Auth (`src/lib/auth.ts`)
            ├── Next.js API Route Handlers (`src/app/api/...`)
            │       ├── Prisma ORM (`@prisma/client` + `@prisma/adapter-libsql`)
            │       └── SQLite Relational Database (`prisma/dev.db`)
            └── External & Background Services
                    ├── Photon API by Komoot (`photon.komoot.io`) - Place Autocomplete
                    ├── OpenStreetMap Nominatim - Reverse/Forward Geocoding
                    ├── Valhalla Routing Engine - Polyline & Route Distance Calculation
                    ├── SMTP Server (Nodemailer) - Real-time Emergency Alert Email Delivery
                    └── SMS Gateway Service - Real-time Emergency SMS Dispatch (`sendEmergencySms`)
```

### Architectural Principles

1. **Monolithic App Router Architecture**: Page views and REST API endpoints reside unified inside `src/app`.
2. **Server-Side Authorization**: Security & role checks are enforced in API handlers using `getServerSession(authOptions)`, not merely by hiding UI elements.
3. **SSR-Safe Dynamic Mapping**: `RouteMap.tsx` dynamically loads Leaflet components with `{ ssr: false }` to avoid SSR `window` reference errors.
4. **Transactional Seat Management**: Booking status transitions and seat counts use `prisma.$transaction` to guarantee capacity integrity.
5. **Spatial Proximity Algorithm**: Search matches passenger pickup/drop points against the driver's polyline shape within a 1.0 km buffer, enforcing correct direction of travel (`startIndex < endIndex`).

---

## 4. Folder Structure

```
tpool/
├── .env.example              # Sample environment variable declarations
├── .eslintrc.json            # ESLint configuration
├── .gitignore                # Git exclusion rules
├── README.md                 # Public documentation and release summary
├── components.json           # Shadcn/ui component configuration
├── next.config.mjs           # Next.js configuration
├── package.json              # Dependencies and scripts
├── prisma.config.ts          # Prisma CLI configuration
├── tailwind.config.ts        # Tailwind CSS styling rules
├── tsconfig.json             # TypeScript compiler settings
├── prisma/
│   ├── dev.db                # SQLite database file
│   └── schema.prisma         # Prisma data models (User, Ride, Booking, Message, EmergencyAlert, Rating, Verification, Report)
├── scripts/
│   └── seed-admin.ts         # Script to seed or promote platform ADMIN accounts (`npm run db:seed`)
├── uploads/
│   └── verifications/        # Private server-side storage for student & driver verification files
└── src/
    ├── app/                  # Next.js App Router pages and API handlers
    │   ├── admin/            # Admin Panel & Moderation Center (`/admin`)
    │   │   ├── analytics/    # Platform metrics & usage analytics
    │   │   ├── bookings/     # Booking oversight & administrative management
    │   │   ├── drivers/      # Driver roster, vehicle details, & license statuses
    │   │   ├── passengers/   # Passenger roster & student verification statuses
    │   │   ├── reports/      # Reported user & incident moderation panel
    │   │   ├── rides/        # Global ride monitoring & lifecycle controls
    │   │   ├── users/        # User directory & account status (suspend/activate)
    │   │   ├── verification/ # Document review queue & inspection viewer (`[id]/page.tsx`)
    │   │   ├── layout.tsx    # Admin layout with sidebar navigation & role authorization
    │   │   └── page.tsx      # Admin dashboard with KPI metrics, alerts, & recent submissions
    │   ├── api/              # API Route Handlers
    │   │   ├── admin/        # Admin management endpoints
    │   │   │   ├── bookings/ # Admin booking management (`route.ts`, `[id]/route.ts`)
    │   │   │   ├── reports/  # Incident reports resolution (`route.ts`, `[id]/route.ts`)
    │   │   │   ├── rides/    # Admin ride controls (`route.ts`, `[id]/route.ts`)
    │   │   │   ├── stats/    # Admin KPI statistics API (`route.ts`)
    │   │   │   ├── users/    # Admin user management & suspension (`route.ts`, `[id]/route.ts`)
    │   │   │   └── verifications/ # Admin verification review queue & approval (`route.ts`, `[id]/route.ts`)
    │   │   ├── auth/         # NextAuth endpoint & user registration API
    │   │   ├── bookings/     # Booking creation & status management APIs
    │   │   ├── emergency/    # Emergency SOS alert API (`sos/route.ts`)
    │   │   ├── ratings/      # Post-ride ratings & directional reviews API (`route.ts`)
    │   │   ├── rides/        # Ride creation, deletion, status controls, & messaging APIs
    │   │   ├── user/         # User profile APIs
    │   │   └── verifications/# User document upload (`upload/route.ts`) & secure file access (`[id]/document/route.ts`)
    │   ├── dashboard/        # Centralized dashboard page with Driver & Passenger sections
    │   ├── login/            # Authentication sign-in page
    │   ├── profile/          # User profile, safety contact setup, & directional reviews page
    │   │   └── verification/ # User-facing document upload portal (`page.tsx`, `VerificationUploadForm.tsx`)
    │   ├── register/         # Account registration page
    │   ├── rides/            # Ride detail & ride creation pages
    │   ├── search/           # Search results page
    │   ├── layout.tsx        # Root layout with Providers & Navbar
    │   └── page.tsx          # Landing page with hero section & SearchForm
    ├── components/           # Reusable UI components
    │   ├── ui/               # Radix UI primitives (button, card, input, badge, label, select)
    │   ├── AdminSidebar.tsx  # Sidebar navigation for the Admin Panel
    │   ├── BackButton.tsx    # Reusable router back navigation button with fallback
    │   ├── BookingButton.tsx # Client CTA for seat reservations with gender rules
    │   ├── CancelBooking.tsx # Client button for passenger booking cancellation
    │   ├── DeleteRide.tsx    # Client button for driver ride deletion
    │   ├── DriverPassengerRatings.tsx # Driver control to rate confirmed passengers
    │   ├── DriverRequestSync.tsx # 4s background poller for driver incoming ride requests
    │   ├── LocationInput.tsx # Autocomplete input fetching from Photon API
    │   ├── ManageBooking.tsx # Driver confirm/reject booking controls
    │   ├── Navbar.tsx        # Top navigation bar with session, verification, & admin links
    │   ├── PassengerWindowSync.tsx # Real-time 4s status polling & window sync component
    │   ├── ProfileSafetyForm.tsx # Emergency contact configuration form
    │   ├── Providers.tsx     # NextAuth SessionProvider wrapper
    │   ├── RatingForm.tsx    # Interactive 1–5 star rating & review selector
    │   ├── RideChat.tsx      # In-app ride discussion board component
    │   ├── RideChatModal.tsx # Compact modal wrapper for in-app ride chat
    │   ├── RideStatusControl.tsx # Driver Start Ride / End Ride controls with modal
    │   ├── RouteMap.tsx      # SSR-safe dynamic map wrapper
    │   ├── RouteMapClient.tsx# Leaflet route polyline & marker map component
    │   ├── SearchForm.tsx    # Ride search input form
    │   └── SosButton.tsx     # Emergency SOS button with GPS capture & modal
    └── lib/                  # Shared utility modules
        ├── auth.ts           # NextAuth configuration and credentials provider logic
        ├── fareCalculator.ts # Distance & detour fare estimation logic
        ├── geo.ts            # Haversine distance, polyline decoding, & spatial math
        ├── notifications.ts  # Nodemailer SMTP emergency email & SMS delivery service
        ├── prisma.ts         # Prisma Client singleton initialization
        └── utils.ts          # Classname merger utility (clsx + tailwind-merge)
```

---

## 5. Authentication and Roles

### Authentication System
- **Registration**: `POST /api/auth/register` validates unique email, hashes password using `bcrypt.hash(password, 10)`, and creates a `User` record with role `USER`.
- **Login**: `signIn("credentials", { email, password })` calls NextAuth `authorize()` in `src/lib/auth.ts`.
- **Session Strategy**: Uses NextAuth JWT sessions (`strategy: "jwt"`). The session callback attaches `token.sub` as `session.user.id`, along with `role`, `userType`, `studentVerificationStatus`, and `driverVerificationStatus`.
- **Server Authorization**: Server pages and API routes inspect `getServerSession(authOptions)` and enforce HTTP 401/403 status codes on unauthorized attempts.
- **Account Suspension Guard**: Suspended accounts (`status === "SUSPENDED"`) are locked out from administrative views and ride management.

### Application Roles
The application defines three distinct operational user roles:

1. **`DRIVER`**:
   - Publishes rides (`POST /api/rides`).
   - Manages incoming booking requests (`CONFIRM` / `REJECT`).
   - Controls ride state transitions (`▶ Start Ride` to `ACTIVE`, `✓ End Ride` to `COMPLETED`).
   - Submits Driving Licence and Vehicle RC verification documents for `Verified Driver` badge.
   - Rates confirmed passengers after ride completion.
2. **`PASSENGER`**:
   - Searches available rides along transit corridors.
   - Requests seat bookings (`PENDING` status) with passenger gender preference.
   - Configures private emergency safety contacts.
   - Submits College / University Student ID verification for `Verified Student` badge.
   - Triggers `🚨 SOS / Emergency` alerts during `ACTIVE` rides (dispatches email and SMS).
   - Rates the driver after ride completion.
3. **`ADMIN`**:
   - Accesses dedicated Admin Panel at `/admin` (linked in Navbar when logged in as Admin).
   - Reviews and approves/rejects driver and passenger verification submissions with feedback.
   - Activates or suspends user accounts.
   - Audits global ride lifecycles, booking states, and fare distributions.
   - Moderates incident reports submitted by community members.
   - Monitors active emergency SOS alerts with real-time location data.
   - Admin account setup is provisioned using `npm run db:seed` (`scripts/seed-admin.ts`).

---

## 6. User Profile and Safety Data

- **Private Safety Data**:
  - `gender`: Stores user gender (`MALE`, `FEMALE`, `OTHER`, `PREFER_NOT_TO_SAY`).
  - `emergencyContactName`, `emergencyContactEmail`, `emergencyContactPhone`: Emergency contact configuration for safety alerts.
- **Privacy Rule**: Emergency contact details are strictly private to the account owner and are **NEVER** exposed on public ride cards, to drivers, to passengers, or on public profiles. Public interfaces display only a non-sensitive indicator (`🛡️ Emergency contact configured`).
- **Identity & Eligibility Verification System**:
  - Accessible via `/profile/verification` (and the `🛡️ Verification` link in Navbar for authenticated users).
  - **Passenger Verification**: Uploads College / University Student ID card (`STUDENT_ID`).
  - **Driver Verification**: Uploads Driving Licence (`DRIVING_LICENCE`) and Vehicle Registration Certificate (`VEHICLE_RC`).
  - **Dual-Role Verification (`BOTH`)**: Displays upload controls for both student ID and driver documentation.
  - **Secure Document Processing**:
    - Handled via `POST /api/verifications/upload` with multipart form data.
    - Enforces allowed MIME types (`image/jpeg`, `image/png`, `application/pdf`) and max 10MB file size limit.
    - Performs server-side binary magic byte verification to prevent spoofed/executable files.
    - Stores files in private server directory (`uploads/verifications/`).
    - Guarded download/inspection endpoint `GET /api/verifications/[id]/document` accessible only to the document owner or an authenticated ADMIN.
  - **Review & Feedback Loop**:
    - Submissions enter `PENDING` status.
    - Admins review documents in the Admin Verification Center (`/admin/verification/[id]`) with inline PDF/image preview.
    - Admins can `APPROVE`, `REJECT`, or request `REUPLOAD_REQUIRED` with a mandatory feedback note.
    - Admin feedback notes are displayed directly in the user's verification portal.
  - **Dynamic Trust Badges**:
    - Users with approved credentials display badges (`✓ Verified Student`, `✓ Verified Driver`) across Search Results, Ride Detail Cards, Dashboard Bookings, and Profile pages.

---

## 7. Gender & Passenger Preference Logic

- **Co-Passenger Preference Rule**: The safety preference is specifically for **OTHER PASSENGERS / CO-PASSENGERS**, NOT the driver's gender.
- **Gender Selection Constraints**:
  - Only female passengers (`gender === "FEMALE"`) can choose `"Prefer Female Passengers"` (`preferredPassengerGender: "FEMALE"`).
  - Male, Other, or Prefer not to say users are locked to `"No Preference"` (`"ANY"`).
  - Backend API (`POST /api/bookings`) rejects invalid female-only requests from non-female accounts.
- **Compatibility Restrictions**:
  - A female passenger with `FEMALE` preference cannot join a ride if a non-female passenger already has an active (`PENDING` or `CONFIRMED`) booking.
  - Non-female passengers cannot join a ride if an active female passenger has a `FEMALE` preference.
  - `CANCELLED` and `REJECTED` bookings do not count as active co-passengers.
  - Driver gender is completely irrelevant to passenger gender preference matching.

---

## 8. Ride Lifecycle

```
SCHEDULED  ──(Driver clicks "Start Ride")──>  ACTIVE  ──(Driver clicks "End Ride")──>  COMPLETED
    │                                            │
    └──(Driver deletes ride)──> CANCELLED <──────┘
```

1. **`SCHEDULED`**:
   - Initial state when published by the driver.
   - Passengers can search, request, confirm, or cancel bookings.
   - Driver can start the ride at any time.
2. **`ACTIVE`**:
   - Driver has started the trip.
   - Passenger active-ride UI enables the `🚨 SOS / Emergency` button.
   - Driver is restricted from publishing additional rides.
3. **`COMPLETED`**:
   - Driver has ended the trip via confirmation modal.
   - SOS button is automatically disabled and removed.
   - Ride moves to history and unlocks post-ride ratings for participants.
4. **`CANCELLED`**:
   - Driver cancelled/deleted the ride; associated bookings are updated and refunded.

---

## 9. Active Ride Restriction

- **Rule**: A driver with an `ACTIVE` ride is blocked from publishing another ride.
- **API Enforcement**: `POST /api/rides` checks if `driverId` currently has a ride with `status === "ACTIVE"`. If true, returns `400 Bad Request`.
- **Scheduled Rides**: Drivers holding multiple `SCHEDULED` rides are permitted to publish additional rides.

---

## 10. Driver Start/End Ride Controls

- **Start Ride (`SCHEDULED` → `ACTIVE`)**:
  - Actionable only by the ride's driver via `RideStatusControl.tsx`.
  - Backend route `PATCH /api/rides/[id]/status` verifies `ride.driverId === session.user.id`.
- **End Ride (`ACTIVE` → `COMPLETED`)**:
  - Actionable only by the ride's driver via `RideStatusControl.tsx`.
  - Triggers a Radix UI confirmation modal: *"End this ride? This will mark the ride as completed for all passengers."*
  - Transitioning to `COMPLETED` closes active ride tracking and enables rating options.

---

## 11. Passenger Window Synchronization

- **Mechanism**: `PassengerWindowSync.tsx` polls `GET /api/rides/[id]/status` every 4 seconds when a ride is `SCHEDULED` or `ACTIVE`.
- **Behavior**: When the driver clicks `✓ End Ride` in Window A, passenger Window B automatically detects the state transition to `COMPLETED` and executes Next.js `router.refresh()`.
- **UI Update**: Passenger UI updates automatically without a manual page reload—hiding the SOS button, updating badges, and rendering the rating form.

---

## 12. Booking and Pooling Management

- **Booking Flow**: Passenger requests seat → `PENDING` booking created → Ride seats decremented → Driver reviews request (`CONFIRM` or `REJECT`) → On `REJECT` or passenger `CANCEL`, seats are automatically refunded.
- **Statuses**: `PENDING`, `CONFIRMED`, `REJECTED`, `CANCELLED`.
- **Atomic Transactions**: `prisma.$transaction` wraps booking status updates and seat adjustments to prevent race conditions.

---

## 13. Fare Calculation System

- **Location**: `src/lib/fareCalculator.ts`.
- **Components**:
  - **Segment Fare**: Pro-rated fare based on passenger distance vs. total route distance.
  - **Detour Fee**: Distance overhead added if pickup/drop requires driver route detour.
  - **Platform Fee**: Nominal platform operating fee.
- **Scope**: Estimates passenger fare in UI and stores total calculated booking fare (`booking.fare`). Digital payment gateway or escrow processing is not integrated (offline/cash settlement assumed).

---

## 14. Search, Routing, and Map Integration

- **Proximity Engine**: `src/app/search/page.tsx` decodes driver route polylines using Valhalla Precision-6 shape decoding and evaluates passenger pickup/drop points against polyline segments using Haversine distance math within a 1.0 km buffer.
- **Autocomplete**: `LocationInput.tsx` queries Komoot Photon API (`photon.komoot.io`).
- **Route Rendering**: `RouteMapClient.tsx` renders OpenStreetMap tiles, driver polyline shapes, and pickup/drop markers via `react-leaflet`.

---

## 15. Live GPS & Emergency SOS System

- **Eligibility**: Available exclusively to passengers holding a `CONFIRMED` booking on an `ACTIVE` ride.
- **Trigger Flow**:
  1. Passenger clicks `🚨 SOS / Emergency` on the active ride page.
  2. Modal opens requesting confirmation.
  3. Client attempts browser GPS capture via `navigator.geolocation.getCurrentPosition` (10s timeout).
  4. Client calls `POST /api/emergency/sos`.
  5. `EmergencyAlert` record created in database with `latitude` and `longitude` (or `null` if GPS unavailable/timed out).
  6. **Email Dispatch**: `sendEmergencyEmail()` triggers Nodemailer SMTP email to the passenger's emergency contact including route details, driver info, and a Google Maps coordinate link.
     - *Dev Fallback*: In local development environments, if external SMTP connectivity fails, mock delivery is logged to console and treated as successful so testing is never blocked.
  7. **SMS Dispatch**: `sendEmergencySms()` prepares and dispatches an emergency SMS alert to the emergency contact's phone number using configured credentials (`SMS_PROVIDER_API_KEY`, `SMS_PROVIDER_FROM`).
  8. **Admin Panel Monitoring**: Active emergency alerts immediately bubble up to the Admin Dashboard (`/admin`) and incident logs with coordinates, timestamps, and passenger details.
- **GPS Failure Resilience**: GPS timeout or permission denial **NEVER** cancels or blocks SOS alert creation, email delivery, or SMS dispatch. The alert proceeds with `locationUnavailable: true`.

---

## 16. Post-Ride Ratings & Reviews System

- **Eligibility**: Permitted ONLY when `ride.status === "COMPLETED"` for confirmed ride participants.
- **Inputs**: 1–5 star integer score + optional 500-character text review.
- **Database Model**: `Rating` model with `@@unique([rideId, reviewerId, revieweeId])` constraint to prevent duplicate ratings.
- **Rating Directions**:
  - **Passenger rating Driver** (`Passenger → Driver`): Rate driver vehicle cleanliness, driving safety, and punctuality.
  - **Driver rating individual confirmed Passengers** (`Driver → Passenger`): Rate passenger behavior and communication.
- **UI Components**:
  - `RatingForm.tsx`: Interactive star rating and text area for passengers on completed ride detail pages and dashboard prompts.
  - `DriverPassengerRatings.tsx`: Driver interface to rate each confirmed passenger on a completed ride.
  - Dashboard CTAs: Completed rides display `★ Rate Driver →` and `★ Rate Passengers →` buttons.

---

## 17. Directional Profile Reviews Display

Profile review displays and average rating calculations are strictly **DIRECTIONAL**:

- **Driver Profile (`userType === "DRIVER"`)**:
  - Renders ONLY reviews received from passengers (`Passenger → Driver`).
  - Label: `"⭐ Reviews from Passengers"`.
  - Average rating calculates strictly from passenger ratings received.
- **Passenger Profile (`userType === "PASSENGER"`)**:
  - Renders ONLY reviews received from drivers (`Driver → Passenger`).
  - Label: `"⭐ Reviews from Drivers"`.
  - Average rating calculates strictly from driver ratings received.
- **Dual Role Profile (`userType === "BOTH"`)**:
  - Renders separate sections for `"Reviews from Passengers"` and `"Reviews from Drivers"`.
- **Exclusion Rule**: Ratings GIVEN by the profile owner to others are **NEVER** displayed on their profile or included in their average rating.

---

## 18. Dashboard Structure

The dashboard (`src/app/dashboard/page.tsx`) provides tailored role-specific management:

- **Top Navigation Bar (`Navbar.tsx`)**:
  - TPool Logo leading to `/`.
  - `🛡️ Verification` link (leading to `/profile/verification` for users) or `Admin Panel` badge (leading to `/admin` for `ADMIN` role).
  - `Dashboard`, `Profile`, and `Logout` actions.
- **Passenger Dashboard Section**:
  - Welcome banner: `Welcome back, <Name> (Passenger / Student Account)`.
  - Prominent "Find a Ride" search bar.
  - Upcoming & Active Bookings card list with real-time status badges (`CONFIRMED`, `PENDING`), driver name, and fare (`₹...`).
  - Past & Cancelled Bookings (with `★ Rate Driver →` prompts for completed rides).
- **Driver Dashboard Section**:
  - Active Ride in Progress banner with status controls.
  - Upcoming & Active Published Rides (with booking request management and `DriverRequestSync.tsx` auto-detection).
  - Past Published Rides (with `★ Rate Passengers →` prompts for completed rides).

---

## 19. Ride Discussion Board (Chat)

- **Access**: Restricted to ride driver and passengers with `CONFIRMED` or `PENDING` bookings (`src/app/api/rides/[id]/messages/route.ts`).
- **Persistence**: Messages stored in `Message` model.
- **Polling**: Lightweight client polling interval to fetch messages.
- **UI Containers**: Structured `RideChat.tsx` embedded directly or opened via compact modal `RideChatModal.tsx`.

---

## 20. Environment Variables

```env
# Database connection string (SQLite file path)
DATABASE_URL="file:./prisma/dev.db"

# NextAuth configuration
NEXTAUTH_SECRET="your-super-secret-jwt-key"
NEXTAUTH_URL="http://localhost:3000"

# SMTP Email Configuration (Nodemailer Emergency Emails)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-gmail-app-password"
EMAIL_FROM="\"TPool Emergency Alert\" <no-reply@tpool.local>"

# Emergency SMS Gateway Configuration
SMS_PROVIDER_API_KEY="your-sms-api-key"
SMS_PROVIDER_FROM="+1234567890"
```

> [!CAUTION]
> **Secrets Security**: Never commit real passwords or API keys to repository files or markdown documents. Use `.env.example` with clean placeholders.

---

## 21. API Endpoints Table

| Method | Endpoint | Auth Required | Role / Requirement | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | No | Public | Registers a new user account with hashed password. |
| `POST/GET`| `/api/auth/[...nextauth]`| Mixed | Public | NextAuth sign-in, sign-out, and session verification endpoints. |
| `POST` | `/api/rides` | Yes | Driver | Publishes a new ride (enforces active ride restriction). |
| `DELETE`| `/api/rides/[id]` | Yes | Driver (Owner) | Deletes a ride and cascades deletion to bookings. |
| `GET` | `/api/rides/[id]/status` | Yes | Participant | Returns current ride status for passenger window sync. |
| `PATCH` | `/api/rides/[id]/status` | Yes | Driver (Owner) | Transitions ride state (`SCHEDULED` → `ACTIVE` → `COMPLETED`). |
| `POST` | `/api/bookings` | Yes | Passenger | Requests a seat (`PENDING` status) with gender preference checks. |
| `PATCH` | `/api/bookings/[id]` | Yes | Driver / Passenger | Driver confirms/rejects; passenger cancels booking. |
| `POST` | `/api/emergency/sos` | Yes | Confirmed Passenger | Creates `EmergencyAlert`, dispatches SMTP email and SMS alert. |
| `POST` | `/api/ratings` | Yes | Confirmed Participant| Submits 1–5 star rating and review for completed rides. |
| `GET` | `/api/ratings` | Yes | Participant | Fetches ratings (supports `type=as_driver` and `type=as_passenger`). |
| `GET` | `/api/rides/[id]/messages` | Yes | Participant | Fetches discussion messages for a ride. |
| `POST` | `/api/rides/[id]/messages` | Yes | Participant | Posts a message to the ride discussion board. |
| `POST` | `/api/verifications/upload` | Yes | User | Uploads student/driver verification document with binary validation. |
| `GET` | `/api/verifications/[id]/document` | Yes | Owner / Admin | Securely streams uploaded verification document preview. |
| `GET` | `/api/admin/stats` | Yes | Admin | Returns system-wide KPI metrics and platform counters. |
| `GET` | `/api/admin/users` | Yes | Admin | Lists platform users with search and role/status filtering. |
| `PATCH` | `/api/admin/users/[id]` | Yes | Admin | Suspends or re-activates user accounts. |
| `GET` | `/api/admin/verifications` | Yes | Admin | Lists verification queue filtered by document type or status. |
| `GET` | `/api/admin/verifications/[id]` | Yes | Admin | Fetches verification detail with user metadata and admin notes. |
| `PATCH`| `/api/admin/verifications/[id]` | Yes | Admin | Approves, rejects, or requests re-upload for verification submission. |
| `GET` | `/api/admin/rides` | Yes | Admin | Monitors all system rides across lifecycle statuses. |
| `DELETE`| `/api/admin/rides/[id]` | Yes | Admin | Administratively cancels a ride and associated bookings. |
| `GET` | `/api/admin/bookings` | Yes | Admin | Audits bookings across statuses and fares. |
| `PATCH` | `/api/admin/bookings/[id]` | Yes | Admin | Modifies or cancels booking records administratively. |
| `GET` | `/api/admin/reports` | Yes | Admin | Lists user reports and incident cases. |
| `POST` | `/api/admin/reports` | Yes | Authenticated User | Submits a report against a user or ride incident. |
| `PATCH` | `/api/admin/reports/[id]` | Yes | Admin | Updates report status (`PENDING`, `RESOLVED`, `DISMISSED`). |

---

## 22. Database Schema (Prisma Models & Enums)

- **`User`**: Accounts (`id`, `name`, `email`, `password`, `role`: `USER`/`ADMIN`, `userType`: `PASSENGER`/`DRIVER`/`BOTH`, `status`: `ACTIVE`/`SUSPENDED`, `gender`, `emergencyContactName`, `emergencyContactEmail`, `emergencyContactPhone`, `studentVerificationStatus`: `NOT_SUBMITTED`/`PENDING`/`APPROVED`/`REJECTED`/`REUPLOAD_REQUIRED`, `driverVerificationStatus`).
- **`Ride`**: Published rides (`id`, `driverId`, `origin`, `destination`, `departure`, `seats`, `price`, `rideType`, `vehicleName`, `distance`, `duration`, `status`: `SCHEDULED`/`ACTIVE`/`COMPLETED`/`CANCELLED`, `currentLat`, `currentLon`, `isLiveSharing`).
- **`Booking`**: Seat reservations (`id`, `rideId`, `userId`, `seats`, `fare`, `status`: `PENDING`/`CONFIRMED`/`CANCELLED`/`REJECTED`, `preferredPassengerGender`: `ANY`/`FEMALE`).
- **`EmergencyAlert`**: SOS incidents (`id`, `userId`, `rideId`, `bookingId`, `status`: `ACTIVE`/`RESOLVED`/`CANCELLED`, `latitude`, `longitude`, `createdAt`, `resolvedAt`).
- **`Rating`**: Post-ride reviews (`id`, `rideId`, `bookingId`, `reviewerId`, `revieweeId`, `rating`, `review`, `createdAt`, `updatedAt`, `@@unique([rideId, reviewerId, revieweeId])`).
- **`Message`**: Ride chat (`id`, `content`, `rideId`, `userId`, `createdAt`).
- **`Verification`**: Document submissions (`id`, `userId`, `documentType`: `STUDENT_ID`/`DRIVING_LICENCE`/`VEHICLE_RC`, `filePath`, `fileName`, `fileType`, `status`: `PENDING`/`APPROVED`/`REJECTED`/`REUPLOAD_REQUIRED`, `rejectionReason`, `submittedAt`, `reviewedAt`, `adminId`).
- **`Report`**: User/incident reports (`id`, `reporterId`, `reportedUserId`, `rideId`, `reason`, `status`: `PENDING`/`RESOLVED`/`DISMISSED`, `createdAt`).

---

## 23. Current Feature Status Inventory

### ✅ COMPLETED
- **NextAuth Authentication & Roles**: Email/password credentials authentication with JWT sessions, bcrypt hashing, and three distinct roles (`PASSENGER`, `DRIVER`, `ADMIN`).
- **Admin Panel & Moderation Center (`/admin`)**:
  - Full admin dashboard with KPI metric cards, recent submissions, and alert feed.
  - 9 integrated admin modules: Dashboard, Users, Drivers, Passengers, Verification, Rides, Bookings, Reports, and Analytics.
  - User suspension & activation controls (`PATCH /api/admin/users/[id]`).
  - Ride lifecycle and booking oversight.
  - Incident report resolution panel (`PATCH /api/admin/reports/[id]`).
- **Student & Driver Document Verification**:
  - User-facing verification portal (`/profile/verification`) with role-specific document submissions.
  - Secure upload handler (`POST /api/verifications/upload`) with MIME and binary magic byte validation (JPG, PNG, PDF up to 10MB).
  - Admin inspection interface (`/admin/verification/[id]`) with inline PDF and image preview.
  - Full decision workflow: `APPROVE`, `REJECT`, `REUPLOAD_REQUIRED` with logged reason.
  - Dynamic verification badges (`✓ Verified Student`, `✓ Verified Driver`) displayed on Search Results, Ride Details, Dashboard, and Profile.
- **Post-Ride Ratings & Reviews System**:
  - Completed ride eligibility constraint (`ride.status === "COMPLETED"`).
  - Passenger rating Driver and Driver rating confirmed Passengers with 1–5 stars and text reviews.
  - Database-level duplicate prevention (`@@unique([rideId, reviewerId, revieweeId])`).
  - Directional profile reviews display & directional average rating calculations.
  - Interactive rating prompt cards on passenger and driver dashboards.
- **Emergency SOS & Multi-Channel Alerts**:
  - Geolocation capture with graceful timeout fallback.
  - Nodemailer SMTP emergency email delivery with Google Maps link and trip details.
  - Dev mock email fallback for seamless local testing.
  - Emergency SMS notification integration (`sendEmergencySms`) via API key configuration.
  - Real-time emergency alert monitoring on Admin Dashboard.
- **Ride Lifecycle & Synchronous State Controls**:
  - `SCHEDULED` → `ACTIVE` → `COMPLETED` driver controls with confirmation modal.
  - 4-second passenger window synchronization updating UI without manual refresh.
  - Active ride publishing lockout for drivers.
- **Proximity Ride Search & Routing**:
  - Valhalla Precision-6 polyline decoding with 1.0 km Haversine corridor buffer.
  - Photon place autocomplete and OpenStreetMap Leaflet map rendering.
- **Transactional Booking Management**:
  - Atomic seat decrements and refunds via `prisma.$transaction`.
  - Passenger gender preference compatibility logic.
- **In-App Ride Chat**:
  - Discussion board accessible only to authorized participants (`RideChat.tsx` and `RideChatModal.tsx`).

### 🟡 PARTIALLY IMPLEMENTED
- **Ride Chat Real-Time Transport**: Polling-based HTTP interval instead of WebSockets / SSE.
- **SMS Gateway Credentials**: `sendEmergencySms` handles payload preparation and delivery logic, but requires production carrier API keys (`SMS_PROVIDER_API_KEY`, `SMS_PROVIDER_FROM`).

### 🔴 NOT IMPLEMENTED / FUTURE ROADMAP
- Digital payment gateways (Razorpay/Stripe) & automated fund escrow.
- Real-time WebSockets / Push Notifications.
- Automated end-to-end test suites (Playwright, Jest).

---

## 24. Future Development Roadmap

### Phase 1 — Core Stabilization & Automated Testing
- Implement automated unit and integration tests (`npm test`).
- Add Zod schema validation to API request payloads.

### Phase 2 — Real-time WebSockets & Push Notifications
- Replace HTTP polling with WebSockets or Server-Sent Events (SSE) for ride chat and status updates.
- Browser push notifications for booking confirmations and emergency alerts.

### Phase 3 — Digital Payments & Escrow
- Razorpay / Stripe payment gateway integration.
- Automated fare escrow and driver payouts upon ride completion.

---

## 25. Important Product Decisions for Future Teammates

1. **Role Separation**: `DRIVER`, `PASSENGER`, and `ADMIN` responsibilities must remain distinct.
2. **Admin Portal**: Admin capabilities are fully operational at `/admin` and must always be guarded server-side by checking `session.user.role === "ADMIN"` and `session.user.status !== "SUSPENDED"`.
3. **Emergency Contact Privacy**: Emergency contact info is strictly private to the account owner and must never be exposed publicly.
4. **Co-Passenger Preference**: Female passenger preference applies strictly to **co-passengers**, never driver gender.
5. **GPS Fallback**: SOS alert creation, email delivery, and SMS dispatch must proceed even if GPS times out or is denied.
6. **Active Ride Lockout**: Drivers holding an `ACTIVE` ride cannot publish new rides until the active ride ends.
7. **Driver-Controlled End Ride**: Ride completion is controlled strictly by the driver via a confirmation modal.
8. **Passenger Window Sync**: Passenger views poll status to update state automatically when a ride is completed.
9. **Post-Ride Ratings**: Ratings are enabled strictly for `COMPLETED` rides and enforce single-rating uniqueness per direction.
10. **Directional Reviews**: Profile review sections and average ratings must remain directional (Driver shows Passenger reviews; Passenger shows Driver reviews).
11. **Verification File Security**: Verification documents must never be served statically through `public/`; they must be served only through the authorized endpoint `GET /api/verifications/[id]/document`.

---

## 26. Data Flow Diagrams

### Ride & SOS Multi-Channel Alert Flow

```
Driver publishes Ride (SCHEDULED)
         │
Passenger requests Seat (PENDING) ──> Driver confirms Seat (CONFIRMED)
         │
Driver clicks "Start Ride" (ACTIVE)
         │
    ┌────┴──────────────────────────────────────────────────────┐
    ▼                                                           ▼
Passenger presses SOS                           Driver clicks "End Ride" (COMPLETED)
    │                                                           │
Capture GPS (or fallback null)                                  ├── Passenger Sync detects COMPLETED
    │                                                           │
Create EmergencyAlert record in DB                              └── Rating options unlocked
    │
    ├── Dispatches Nodemailer Emergency Email
    ├── Dispatches Emergency SMS (sendEmergencySms)
    └── Active alert surfaces on Admin Dashboard (/admin)
```

### Document Verification & Review Flow

```
User visits /profile/verification
         │
Uploads Student ID or Driver Licence / Vehicle RC
         │
POST /api/verifications/upload
(Validates MIME type, file size <= 10MB, and binary magic bytes)
         │
Saves file to uploads/verifications/ & creates Verification record (PENDING)
         │
Admin inspects submission at /admin/verification/[id]
(Streams preview via GET /api/verifications/[id]/document)
         │
    ┌────┴───────────────────────────────────────────┐
    ▼                                                ▼
Admin APPROVES                                  Admin REJECTS / Requests RE-UPLOAD
    │                                                │
Updates User.studentVerificationStatus /             Updates status with required rejectionReason
driverVerificationStatus = "APPROVED"                │
    │                                                Displays feedback note in user portal
Trust Badges rendered in Search & Dashboard
```

---

## 27. Rules for Future Development

1. **Inspect Before Modifying**: Inspect existing components and schema before making structural edits.
2. **Preserve Working Features**: Do not break or rewrite SOS, email/SMS notifications, passenger sync, verification workflows, or ratings.
3. **Enforce Server-Side Authorization**: Validate session IDs and roles on the backend for every sensitive action.
4. **Transactional Database Edits**: Wrap seat count modifications, status changes, and verification approvals in `prisma.$transaction`.
5. **Keep Secrets Secret**: Never commit `.env` files or API credentials.

---

## 28. Setup & Development Instructions

```bash
# 1. Install dependencies
npm install

# 2. Generate Prisma Client
npx prisma generate

# 3. Synchronize database schema
npx prisma db push

# 4. Seed Admin account (Optional)
npm run db:seed
# Or custom admin: npx tsx scripts/seed-admin.ts custom-admin@tpool.com mypassword123

# 5. Start development server
npm run dev

# 6. Run ESLint code quality checks
npm run lint

# 7. Build for production
npm run build
```

Application runs at `http://localhost:3000`.

---

## 29. Recent Major Updates

- **Admin Panel & Moderation Center (`/admin`)**: Built complete administrative control panel with 9 sub-modules (`Dashboard`, `Users`, `Drivers`, `Passengers`, `Verification`, `Rides`, `Bookings`, `Reports`, `Analytics`), role-based layout security, and `npm run db:seed` provisioning.
- **Driver & Student Identity Verification System**: Implemented end-to-end verification portal (`/profile/verification`), secure file upload handler (`POST /api/verifications/upload`) with binary magic byte validation, guarded document streaming, admin review center (`/admin/verification/[id]`), and dynamic trust badges (`✓ Verified Student`, `✓ Verified Driver`) across search results and dashboards.
- **Emergency SOS Multi-Channel Alerting (Email + SMS)**: Added `sendEmergencySms()` integration alongside Nodemailer SMTP emergency email delivery, implemented local dev mock email fallback for resilient offline testing, and connected active alerts to the admin dashboard.
- **Post-Ride Ratings & Reviews System**: Built full post-ride rating mechanism unlocked on `COMPLETED` rides, with directional reviews (Driver → Passenger, Passenger → Driver), duplicate prevention constraint, and dashboard prompts.
- **Automatic Driver Ride Request Sync**: Implemented `DriverRequestSync.tsx` with lightweight 4-second polling to update driver dashboard requests without page reloads.
- **Search Page Ride Filtering**: Enforced database-level filtering (`status: "SCHEDULED"`, `seats: { gt: 0 }`, `departure: { gt: new Date() }`) in `src/app/search/page.tsx` to automatically exclude completed, cancelled, active, and full rides.
- **Compact Route Map Layout & Modal Chat**: Refactored `/rides/[id]` into a 3-column card grid with `h-56 sm:h-64` map container, and integrated `RideChatModal.tsx` and `BackButton.tsx`.
- **Ride Lifecycle & Passenger Sync**: Implemented `SCHEDULED` → `ACTIVE` → `COMPLETED` lifecycle controls with automatic 4-second passenger window synchronization and active ride publishing restrictions.


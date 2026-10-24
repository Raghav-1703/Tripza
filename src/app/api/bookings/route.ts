import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkPassengerEligibility } from "@/lib/dynamicRouting";
import { getBidirectionalBlockedUserIds } from "@/lib/block";
import { validateAndNormalizePhone } from "@/lib/phoneValidation";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user;

    if (!user?.id) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (user.userType !== "PASSENGER" && user.userType !== "BOTH") {
      return NextResponse.json({ message: "Forbidden: Drivers cannot book seats as passengers" }, { status: 403 });
    }

    const userId = user.id;

    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, gender: true, userType: true, phoneNumber: true }
    });

    if (!dbUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    const body = await req.json();
    const { rideId, fare, preferredPassengerGender, passengerOrigin, passengerDestination, passengerPhone } = body;

    // If passenger doesn't have a phone in profile and provides one, validate and save it
    if (!dbUser.phoneNumber && passengerPhone && typeof passengerPhone === "string" && passengerPhone.trim() !== "") {
      const phoneValidation = validateAndNormalizePhone(passengerPhone);
      if (!phoneValidation.isValid) {
        return NextResponse.json({ message: phoneValidation.error || "Invalid phone number" }, { status: 400 });
      }
      await prisma.user.update({
        where: { id: userId },
        data: { phoneNumber: phoneValidation.normalized }
      });
    }

    if (!rideId) {
      return NextResponse.json({ message: "Ride ID is required" }, { status: 400 });
    }

    const requestedGenderPref = (preferredPassengerGender === "FEMALE") ? "FEMALE" : "ANY";

    // Enforce that ONLY female passengers can select FEMALE preference
    if (requestedGenderPref === "FEMALE" && dbUser.gender !== "FEMALE") {
      return NextResponse.json(
        { message: "Female co-passenger preference is only available to female passengers." },
        { status: 403 }
      );
    }

    const validGenderPref = requestedGenderPref;

    // 1. Fetch the ride
    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: { bookings: true }
    });

    if (!ride) {
      return NextResponse.json({ message: "Ride not found" }, { status: 404 });
    }

    // 2. Validate rules
    if (ride.driverId === userId) {
      return NextResponse.json({ message: "You cannot book your own ride" }, { status: 400 });
    }

    if (ride.seats < 1) {
      return NextResponse.json({ message: "No seats available" }, { status: 400 });
    }

    const hasBooked = ride.bookings.some(b => b.userId === userId && b.status !== "CANCELLED" && b.status !== "REJECTED");
    if (hasBooked) {
      return NextResponse.json({ message: "You have already booked this ride" }, { status: 400 });
    }

    // 3. Enforce bidirectional block restrictions (with driver and active passengers)
    const blockedUserIds = await getBidirectionalBlockedUserIds(userId);
    if (blockedUserIds.includes(ride.driverId)) {
      return NextResponse.json(
        { message: "Booking unavailable: You cannot book a ride with a blocked user." },
        { status: 403 }
      );
    }

    // 4. Check female co-passenger preference enforcement on active bookings
    const activeBookings = await prisma.booking.findMany({
      where: {
        rideId,
        status: { in: ["PENDING", "CONFIRMED"] }
      },
      include: {
        user: { select: { gender: true } }
      }
    });

    const hasBlockedCoPassenger = activeBookings.some((b) => blockedUserIds.includes(b.userId));
    if (hasBlockedCoPassenger) {
      return NextResponse.json(
        { message: "Booking unavailable: An active passenger on this ride has a block relationship with you." },
        { status: 403 }
      );
    }

    // Scenario A/B: If active female preference exists on ride, non-female users are rejected
    const activeFemalePref = activeBookings.some(b => b.preferredPassengerGender === "FEMALE");
    if (activeFemalePref && dbUser.gender !== "FEMALE") {
      return NextResponse.json(
        { message: "This ride currently has a female co-passenger preference and is restricted to female passengers." },
        { status: 400 }
      );
    }

    // Scenario D: If female passenger selects FEMALE preference on ride with non-female active passenger
    if (validGenderPref === "FEMALE") {
      const hasNonFemalePassenger = activeBookings.some(b => b.user.gender !== "FEMALE");
      if (hasNonFemalePassenger) {
        return NextResponse.json(
          { message: "This ride already contains a passenger who does not match your selected co-passenger preference." },
          { status: 400 }
        );
      }
    }

    // 4. Validate passenger corridor eligibility and detour radius if custom points provided
    let pickupLocation = passengerOrigin || ride.origin;
    let dropLocation = passengerDestination || ride.destination;
    let pickupLat = ride.originLat;
    let pickupLon = ride.originLon;
    let dropLat = ride.destLat;
    let dropLon = ride.destLon;
    let finalFare = fare ? parseFloat(fare) : (ride.price || 0);

    let eligibility: Awaited<ReturnType<typeof checkPassengerEligibility>> | null = null;

    if (passengerOrigin && passengerDestination && (passengerOrigin !== ride.origin || passengerDestination !== ride.destination)) {
      eligibility = await checkPassengerEligibility({
        rideId,
        passengerOrigin,
        passengerDestination,
      });

      if (!eligibility.eligible) {
        return NextResponse.json(
          { message: eligibility.reason || "You are not eligible for this ride based on route proximity or direction." },
          { status: 400 }
        );
      }

      pickupLocation = passengerOrigin;
      dropLocation = passengerDestination;
      pickupLat = eligibility.passStart?.lat ?? null;
      pickupLon = eligibility.passStart?.lon ?? null;
      dropLat = eligibility.passEnd?.lat ?? null;
      dropLon = eligibility.passEnd?.lon ?? null;
      if (typeof eligibility.fare === "number" && eligibility.fare > 0) {
        finalFare = eligibility.fare;
      }
    }

    const mainFare = eligibility?.mainFare ?? finalFare;
    const detourFare = eligibility?.detourFare ?? 0;
    const detourDistance = eligibility?.detourDistance ?? 0;
    const fareBreakdown = eligibility?.fareBreakdown ? JSON.stringify(eligibility.fareBreakdown) : null;

    // 5. Transaction to book and decrement seats
    const booking = await prisma.$transaction(async (tx) => {
      // Create the booking as PENDING for the driver to review
      const newBooking = await tx.booking.create({
        data: {
          rideId,
          userId,
          seats: 1,
          fare: finalFare,
          mainFare,
          detourFare,
          detourDistance,
          fareBreakdown,
          status: "PENDING",
          preferredPassengerGender: validGenderPref,
          pickupLocation,
          pickupLat,
          pickupLon,
          dropLocation,
          dropLat,
          dropLon,
        }
      });

      // Decrement seats
      await tx.ride.update({
        where: { id: rideId },
        data: {
          seats: {
            decrement: 1
          }
        }
      });

      return newBooking;
    });

    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    console.error("Failed to create booking:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    // Get count and latest booking timestamp for rides published by this driver
    const driverRides = await prisma.ride.findMany({
      where: { driverId: userId, status: { in: ["SCHEDULED", "ACTIVE"] } },
      select: {
        id: true,
        bookings: {
          select: { id: true, status: true, createdAt: true }
        }
      }
    });

    let totalCount = 0;
    let latestTime = 0;

    for (const r of driverRides) {
      totalCount += r.bookings.length;
      for (const b of r.bookings) {
        const t = new Date(b.createdAt).getTime();
        if (t > latestTime) {
          latestTime = t;
        }
      }
    }

    return NextResponse.json({
      count: totalCount,
      latestBookingTime: latestTime,
      ridesCount: driverRides.length
    }, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch driver bookings count:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

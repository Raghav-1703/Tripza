import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { areUsersBlocked } from "@/lib/block";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { rideId, revieweeId, rating, review } = body;

    // 1. Validation
    if (!rideId || !revieweeId || typeof rating !== "number") {
      return NextResponse.json(
        { message: "Missing required fields: rideId, revieweeId, and rating" },
        { status: 400 }
      );
    }

    const parsedRating = Math.floor(rating);
    if (parsedRating < 1 || parsedRating > 5) {
      return NextResponse.json({ message: "Rating must be an integer between 1 and 5" }, { status: 400 });
    }

    if (userId === revieweeId) {
      return NextResponse.json({ message: "You cannot rate yourself" }, { status: 400 });
    }

    // Enforce bidirectional block check
    if (await areUsersBlocked(userId, revieweeId)) {
      return NextResponse.json(
        { message: "Ratings cannot be submitted between blocked users" },
        { status: 403 }
      );
    }

    const trimmedReview = typeof review === "string" ? review.trim() : null;
    if (trimmedReview && trimmedReview.length > 500) {
      return NextResponse.json({ message: "Review text cannot exceed 500 characters" }, { status: 400 });
    }

    // 2. Fetch the ride and confirmed bookings
    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        bookings: {
          where: { status: "CONFIRMED" },
        },
      },
    });

    if (!ride) {
      return NextResponse.json({ message: "Ride not found" }, { status: 404 });
    }

    // 3. Verify ride status is COMPLETED
    if (ride.status !== "COMPLETED") {
      return NextResponse.json(
        { message: "Ratings can only be submitted for completed rides" },
        { status: 400 }
      );
    }

    // 4. Participation & Authorization checks
    const isDriverReviewer = ride.driverId === userId;
    const isPassengerReviewer = ride.bookings.some((b) => b.userId === userId);

    if (!isDriverReviewer && !isPassengerReviewer) {
      return NextResponse.json(
        { message: "Forbidden: You did not participate in this ride" },
        { status: 403 }
      );
    }

    let bookingId: string | null = null;

    if (isPassengerReviewer) {
      // Passenger rating the driver
      if (revieweeId !== ride.driverId) {
        return NextResponse.json(
          { message: "Forbidden: Passengers can only rate the driver of their completed ride" },
          { status: 403 }
        );
      }
      const passengerBooking = ride.bookings.find((b) => b.userId === userId);
      bookingId = passengerBooking?.id || null;
    } else if (isDriverReviewer) {
      // Driver rating a passenger
      const targetPassengerBooking = ride.bookings.find((b) => b.userId === revieweeId);
      if (!targetPassengerBooking) {
        return NextResponse.json(
          { message: "Forbidden: Drivers can only rate passengers with a confirmed booking on their completed ride" },
          { status: 403 }
        );
      }
      bookingId = targetPassengerBooking.id;
    }

    // 5. Check for existing duplicate rating
    const existingRating = await prisma.rating.findUnique({
      where: {
        rideId_reviewerId_revieweeId: {
          rideId,
          reviewerId: userId,
          revieweeId,
        },
      },
    });

    if (existingRating) {
      return NextResponse.json(
        { message: "You have already submitted a rating for this user on this ride" },
        { status: 400 }
      );
    }

    // 6. Create rating
    const newRating = await prisma.rating.create({
      data: {
        rideId,
        bookingId,
        reviewerId: userId,
        revieweeId,
        rating: parsedRating,
        review: trimmedReview || null,
      },
    });

    return NextResponse.json(newRating, { status: 201 });
  } catch (error) {
    console.error("Failed to create rating:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const rideId = searchParams.get("rideId");
    const userId = searchParams.get("userId");
    const type = searchParams.get("type"); // "as_driver" | "as_passenger"

    const whereCondition: {
      rideId?: string;
      revieweeId?: string;
      ride?: { driverId: string | { not: string } };
    } = {};
    if (rideId) whereCondition.rideId = rideId;
    if (userId) {
      whereCondition.revieweeId = userId;
      if (type === "as_driver") {
        whereCondition.ride = { driverId: userId };
      } else if (type === "as_passenger") {
        whereCondition.ride = { driverId: { not: userId } };
      }
    }

    const ratings = await prisma.rating.findMany({
      where: whereCondition,
      include: {
        reviewer: { select: { name: true } },
        reviewee: { select: { name: true } },
        ride: { select: { id: true, origin: true, destination: true, driverId: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(ratings, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch ratings:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

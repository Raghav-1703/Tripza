import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBidirectionalBlockedUserIds } from "@/lib/block";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as { id?: string } | undefined;

    if (!user?.id) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const ride = await prisma.ride.findUnique({
      where: { id: params.id },
      include: { bookings: true }
    });

    if (!ride) {
      return NextResponse.json({ message: "Ride not found" }, { status: 404 });
    }

    const isDriver = ride.driverId === user.id;
    const isPassenger = ride.bookings.some(b => b.userId === user.id && (b.status === "PENDING" || b.status === "CONFIRMED"));

    if (!isDriver && !isPassenger) {
      return NextResponse.json({ message: "Forbidden. You must be a driver or active passenger on this ride." }, { status: 403 });
    }

    const messages = await prisma.message.findMany({
      where: { rideId: ride.id },
      include: { user: { select: { name: true, id: true } } },
      orderBy: { createdAt: 'asc' }
    });

    return NextResponse.json(messages);

  } catch (error) {
    console.error("Failed to fetch messages:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    const user = session?.user as { id?: string } | undefined;

    if (!user?.id) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const ride = await prisma.ride.findUnique({
      where: { id: params.id },
      include: { bookings: true }
    });

    if (!ride) {
      return NextResponse.json({ message: "Ride not found" }, { status: 404 });
    }

    const isDriver = ride.driverId === user.id;
    const isPassenger = ride.bookings.some(b => b.userId === user.id && (b.status === "PENDING" || b.status === "CONFIRMED"));

    if (!isDriver && !isPassenger) {
      return NextResponse.json({ message: "Forbidden. You must be a driver or active passenger on this ride." }, { status: 403 });
    }

    // Enforce bidirectional block check: sender cannot chat if blocked by or having blocked any active participant
    const blockedUserIds = await getBidirectionalBlockedUserIds(user.id);
    const otherParticipantIds = [
      ride.driverId,
      ...ride.bookings.filter(b => b.status === "PENDING" || b.status === "CONFIRMED").map(b => b.userId)
    ].filter(id => id !== user.id);

    if (otherParticipantIds.some(id => blockedUserIds.includes(id))) {
      return NextResponse.json(
        { message: "Messaging unavailable: A participant in this ride has a block relationship with you." },
        { status: 403 }
      );
    }

    const { content } = await req.json();
    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json({ message: "Content cannot be empty" }, { status: 400 });
    }

    const message = await prisma.message.create({
      data: {
        content: content.trim(),
        rideId: ride.id,
        userId: user.id
      },
      include: { user: { select: { name: true, id: true } } }
    });

    return NextResponse.json(message, { status: 201 });

  } catch (error) {
    console.error("Failed to post message:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

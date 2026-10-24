import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { validateAndNormalizePhone, validateContactName } from "@/lib/phoneValidation";
import { buildPublicTrackingUrl } from "@/lib/appUrl";

export const dynamic = "force-dynamic";

/**
 * POST /api/rides/[id]/share
 * Generates a secure, unpredictable trip sharing token for the authenticated driver or passenger.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await Promise.resolve(params);
    const rideId = resolvedParams.id;
    if (!rideId) {
      return NextResponse.json({ message: "Ride ID is required" }, { status: 400 });
    }

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        bookings: {
          where: { userId },
          select: { id: true, status: true },
        },
      },
    });

    if (!ride) {
      return NextResponse.json({ message: "Ride not found" }, { status: 404 });
    }

    // Authorization: User must be driver or confirmed passenger (or pending on scheduled ride)
    const isDriver = ride.driverId === userId;
    const booking = ride.bookings[0];
    const isPassenger = Boolean(booking && (booking.status === "CONFIRMED" || (ride.status === "SCHEDULED" && booking.status === "PENDING")));

    if (!isDriver && !isPassenger) {
      return NextResponse.json(
        { message: "Forbidden: You are not authorized to share this ride" },
        { status: 403 }
      );
    }

    // Lifecycle check: cannot share already completed or cancelled trips
    if (ride.status === "COMPLETED" || ride.status === "CANCELLED") {
      return NextResponse.json(
        { message: `Cannot share a ${ride.status.toLowerCase()} trip` },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    let validatedPhone: string | null = null;
    let validatedName: string | null = null;

    if (body.recipientPhone) {
      const phoneRes = validateAndNormalizePhone(body.recipientPhone);
      if (!phoneRes.isValid) {
        return NextResponse.json({ message: phoneRes.error }, { status: 400 });
      }
      validatedPhone = phoneRes.normalized!;
    }

    if (body.recipientName) {
      const nameRes = validateContactName(body.recipientName);
      if (nameRes.isValid) {
        validatedName = nameRes.normalized!;
      }
    }

    // Generate secure 48-character cryptographic hex token
    const token = crypto.randomBytes(24).toString("hex");

    // Token expires in 24 hours or 4 hours after estimated trip completion
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const shareRecord = await prisma.tripShareToken.create({
      data: {
        token,
        rideId: ride.id,
        userId,
        bookingId: booking?.id || null,
        recipientName: validatedName,
        recipientPhone: validatedPhone,
        expiresAt,
      },
    });

    const { url: shareUrl, error: urlError, isLocalhost } = buildPublicTrackingUrl(token);
    if (urlError) {
      return NextResponse.json({ message: urlError }, { status: 400 });
    }

    const safetyMessage = `I'm sharing my TPool trip with you for safety. You can follow my trip here: ${shareUrl}. This link expires when trip sharing ends.`;

    return NextResponse.json({
      id: shareRecord.id,
      token: shareRecord.token,
      shareUrl,
      safetyMessage,
      expiresAt: shareRecord.expiresAt,
      recipientName: shareRecord.recipientName,
      recipientPhone: shareRecord.recipientPhone,
      isLocalhost,
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to generate trip share token:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/rides/[id]/share
 * Lists share tokens created by the authenticated user for this ride.
 */
export async function GET(
  req: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await Promise.resolve(params);
    const rideId = resolvedParams.id;
    if (!rideId) {
      return NextResponse.json({ message: "Ride ID is required" }, { status: 400 });
    }

    const tokens = await prisma.tripShareToken.findMany({
      where: {
        rideId,
        userId, // Strictly own tokens only
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        token: true,
        recipientName: true,
        recipientPhone: true,
        isRevoked: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    const formatted = tokens.map((t) => {
      const { url } = buildPublicTrackingUrl(t.token);
      return {
        ...t,
        shareUrl: url,
        isExpired: new Date() > t.expiresAt,
      };
    });

    return NextResponse.json(formatted);
  } catch (error) {
    console.error("Failed to fetch share tokens:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/rides/[id]/share?tokenId=... or ?token=...
 * Revokes a trip share token. Strictly enforces that the caller is the owner of the token.
 */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await Promise.resolve(params);
    const rideId = resolvedParams.id;

    const { searchParams } = new URL(req.url);
    const tokenId = searchParams.get("tokenId");
    const tokenStr = searchParams.get("token");

    if (!tokenId && !tokenStr) {
      return NextResponse.json({ message: "tokenId or token is required" }, { status: 400 });
    }

    const shareRecord = await prisma.tripShareToken.findFirst({
      where: {
        rideId,
        OR: [
          ...(tokenId ? [{ id: tokenId }] : []),
          ...(tokenStr ? [{ token: tokenStr }] : []),
        ],
      },
    });

    if (!shareRecord) {
      return NextResponse.json({ message: "Share link not found" }, { status: 404 });
    }

    // Ownership check (IDOR protection)
    if (shareRecord.userId !== userId) {
      return NextResponse.json(
        { message: "Forbidden: You can only revoke share links you created" },
        { status: 403 }
      );
    }

    // Revoke the token
    const updated = await prisma.tripShareToken.update({
      where: { id: shareRecord.id },
      data: { isRevoked: true },
    });

    return NextResponse.json({
      message: "Trip sharing revoked successfully",
      isRevoked: updated.isRevoked,
    });
  } catch (error) {
    console.error("Failed to revoke share token:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

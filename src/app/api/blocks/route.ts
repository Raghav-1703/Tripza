import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { blockUser } from "@/lib/block";

export const dynamic = "force-dynamic";

/**
 * GET /api/blocks
 * Returns the list of users blocked by the authenticated user.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const blocks = await prisma.block.findMany({
      where: { blockerId: userId },
      orderBy: { createdAt: "desc" },
      include: {
        blocked: {
          select: {
            id: true,
            name: true,
            email: true,
            userType: true,
            studentVerificationStatus: true,
            driverVerificationStatus: true,
          },
        },
      },
    });

    return NextResponse.json(blocks);
  } catch (error) {
    console.error("Failed to fetch blocked users:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/blocks
 * Blocks a target user.
 * Body: { blockedId: string }
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { blockedId } = body;

    if (!blockedId || typeof blockedId !== "string" || !blockedId.trim()) {
      return NextResponse.json({ message: "blockedId is required" }, { status: 400 });
    }

    const targetId = blockedId.trim();

    if (userId === targetId) {
      return NextResponse.json({ message: "You cannot block yourself" }, { status: 400 });
    }

    // Verify target user exists
    const targetUser = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, name: true },
    });

    if (!targetUser) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    const block = await blockUser(userId, targetId);

    return NextResponse.json(
      {
        message: "User blocked successfully",
        block,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("Failed to block user:", error);
    const err = error as { message?: string };
    return NextResponse.json(
      { message: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

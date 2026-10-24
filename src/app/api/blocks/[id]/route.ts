import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/blocks/[id]
 * Unblocks a user. The [id] parameter can be either the block record id or the target blocked user id.
 * Strictly enforces that blockerId === authenticated user.
 */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = params;
    if (!id || typeof id !== "string") {
      return NextResponse.json({ message: "Invalid ID" }, { status: 400 });
    }

    // Find block where blockerId === userId AND (id matches block.id OR id matches block.blockedId)
    const block = await prisma.block.findFirst({
      where: {
        blockerId: userId,
        OR: [
          { id },
          { blockedId: id },
        ],
      },
    });

    if (!block) {
      // Either block does not exist, or it belongs to another blocker (IDOR protection)
      return NextResponse.json({ message: "Block record not found" }, { status: 404 });
    }

    await prisma.block.delete({
      where: { id: block.id },
    });

    return NextResponse.json({
      message: "User unblocked successfully",
      unblockedUserId: block.blockedId,
    });
  } catch (error) {
    console.error("Failed to unblock user:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

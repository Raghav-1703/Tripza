import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getBlockRelationship } from "@/lib/block";

export const dynamic = "force-dynamic";

/**
 * GET /api/blocks/check?userId=...
 * Returns the block relationship between the authenticated user and the target userId.
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const currentUserId = session?.user?.id;

    if (!currentUserId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const targetUserId = searchParams.get("userId");

    if (!targetUserId) {
      return NextResponse.json({ message: "userId query parameter is required" }, { status: 400 });
    }

    const relationship = await getBlockRelationship(currentUserId, targetUserId);

    return NextResponse.json(relationship);
  } catch (error) {
    console.error("Failed to check block status:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

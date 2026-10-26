import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { handleEarlyExitSettlement } from "@/lib/payment";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const bookingId = params.id;
    if (!bookingId) {
      return NextResponse.json({ message: "Booking ID is required" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { exitLat, exitLon, exitLocationName } = body;

    const result = await handleEarlyExitSettlement({
      bookingId,
      userId,
      exitLat,
      exitLon,
      exitLocationName,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    const err = error as Error;
    console.error("Early exit settlement failed:", err);
    const msg = err.message || "";
    const statusCode = msg.includes("Forbidden")
      ? 403
      : msg.includes("not found")
      ? 404
      : msg.includes("Only confirmed") || msg.includes("actively in progress")
      ? 400
      : 500;

    return NextResponse.json({ success: false, message: msg || "Failed to process early exit" }, { status: statusCode });
  }
}

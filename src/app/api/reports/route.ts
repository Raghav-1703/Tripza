import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const VALID_REPORT_REASONS = [
  "HARASSMENT",
  "UNSAFE_DRIVING",
  "FAKE_PROFILE",
  "SCAM",
  "INAPPROPRIATE_BEHAVIOR",
  "OTHER",
] as const;

type ReportReasonType = (typeof VALID_REPORT_REASONS)[number];

const REPORT_REASON_LABELS: Record<ReportReasonType, string> = {
  HARASSMENT: "Harassment or verbal abuse",
  UNSAFE_DRIVING: "Unsafe or reckless driving",
  FAKE_PROFILE: "Fake profile or identity misrepresentation",
  SCAM: "Scam, payment fraud, or financial extortion",
  INAPPROPRIATE_BEHAVIOR: "Inappropriate or offensive behavior",
  OTHER: "Other safety or policy concern",
};

/**
 * POST /api/reports
 * Submits a new user/ride safety report.
 * Reporter identity is derived strictly from the authenticated session.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const reporterId = session?.user?.id;

    if (!reporterId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { reportedUserId, rideId, reason, description } = body;

    // Validate reason
    if (!reason || typeof reason !== "string") {
      return NextResponse.json(
        { message: "A valid report reason is required" },
        { status: 400 }
      );
    }

    const normalizedReason = reason.trim().toUpperCase() as ReportReasonType;
    // Allow either the key or custom string if prefixed/matched
    const isValidKey = VALID_REPORT_REASONS.includes(normalizedReason);
    const reasonText = isValidKey ? REPORT_REASON_LABELS[normalizedReason] : reason.trim();

    if (reasonText.length === 0 || reasonText.length > 255) {
      return NextResponse.json(
        { message: "Reason must be between 1 and 255 characters" },
        { status: 400 }
      );
    }

    // Validate reportedUserId
    if (!reportedUserId && !rideId) {
      return NextResponse.json(
        { message: "Either reportedUserId or rideId must be provided" },
        { status: 400 }
      );
    }

    if (reportedUserId) {
      if (typeof reportedUserId !== "string" || !reportedUserId.trim()) {
        return NextResponse.json(
          { message: "Invalid reported user ID" },
          { status: 400 }
        );
      }

      const targetId = reportedUserId.trim();

      // Prevent self-reporting
      if (targetId === reporterId) {
        return NextResponse.json(
          { message: "You cannot report yourself" },
          { status: 400 }
        );
      }

      // Check reported user existence
      const targetUser = await prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true, name: true },
      });

      if (!targetUser) {
        return NextResponse.json(
          { message: "Reported user not found" },
          { status: 404 }
        );
      }
    }

    // Validate rideId if provided
    if (rideId) {
      if (typeof rideId !== "string" || !rideId.trim()) {
        return NextResponse.json(
          { message: "Invalid ride ID" },
          { status: 400 }
        );
      }

      const ride = await prisma.ride.findUnique({
        where: { id: rideId.trim() },
        select: { id: true },
      });

      if (!ride) {
        return NextResponse.json(
          { message: "Referenced ride not found" },
          { status: 404 }
        );
      }
    }

    // Validate optional description
    let cleanDescription: string | null = null;
    if (description !== undefined && description !== null) {
      if (typeof description !== "string") {
        return NextResponse.json(
          { message: "Description must be a string" },
          { status: 400 }
        );
      }
      const trimmed = description.trim();
      if (trimmed.length > 2000) {
        return NextResponse.json(
          { message: "Description cannot exceed 2000 characters" },
          { status: 400 }
        );
      }
      cleanDescription = trimmed.length > 0 ? trimmed : null;
    }

    // Check for existing pending duplicate report by same reporter
    const existingPending = await prisma.report.findFirst({
      where: {
        reporterId,
        reportedUserId: reportedUserId ? reportedUserId.trim() : null,
        rideId: rideId ? rideId.trim() : null,
        status: "PENDING",
      },
    });

    if (existingPending) {
      return NextResponse.json(
        {
          message: "You already have a pending report for this user or ride that is under review",
          reportId: existingPending.id,
        },
        { status: 409 }
      );
    }

    // Create report
    const report = await prisma.report.create({
      data: {
        reporterId,
        reportedUserId: reportedUserId ? reportedUserId.trim() : null,
        rideId: rideId ? rideId.trim() : null,
        reason: reasonText,
        description: cleanDescription,
        status: "PENDING",
      },
      select: {
        id: true,
        reason: true,
        description: true,
        status: true,
        createdAt: true,
        // Confidential: DO NOT expose reporter details or internal moderation logs to reported user
      },
    });

    return NextResponse.json(
      {
        message: "Report submitted successfully and will be reviewed by platform moderation",
        report,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to submit report:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Reject GET requests to /api/reports to protect moderation confidentiality.
 * Only authenticated administrators can view reports via /api/admin/reports.
 */
export async function GET() {
  return NextResponse.json(
    { message: "Method not allowed. Reports are confidential." },
    { status: 405 }
  );
}

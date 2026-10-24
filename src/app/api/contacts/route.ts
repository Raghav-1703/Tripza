import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateAndNormalizePhone, validateContactName } from "@/lib/phoneValidation";

export const dynamic = "force-dynamic";

/**
 * GET /api/contacts
 * Returns the authenticated user's trusted contacts.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const contacts = await prisma.trustedContact.findMany({
      where: { userId },
      orderBy: [{ isEmergency: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json(contacts);
  } catch (error) {
    console.error("Failed to fetch contacts:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/contacts
 * Adds a new contact for the authenticated user.
 */
export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ message: "Invalid request payload" }, { status: 400 });
    }

    const { name, phone, isEmergency } = body;

    const nameValidation = validateContactName(name);
    if (!nameValidation.isValid) {
      return NextResponse.json({ message: nameValidation.error }, { status: 400 });
    }

    const phoneValidation = validateAndNormalizePhone(phone);
    if (!phoneValidation.isValid) {
      return NextResponse.json({ message: phoneValidation.error }, { status: 400 });
    }

    // Check for duplicate phone number for this user
    const existing = await prisma.trustedContact.findUnique({
      where: {
        userId_phone: {
          userId,
          phone: phoneValidation.normalized!,
        },
      },
    });

    let isDuplicate = Boolean(existing);
    if (!isDuplicate && phoneValidation.normalized!.replace(/\D/g, "").length >= 10) {
      const allUserContacts = await prisma.trustedContact.findMany({
        where: { userId },
        select: { id: true, phone: true },
      });
      const inputLast10 = phoneValidation.normalized!.replace(/\D/g, "").slice(-10);
      isDuplicate = allUserContacts.some(
        (c) => c.phone.replace(/\D/g, "").slice(-10) === inputLast10
      );
    }

    if (isDuplicate) {
      return NextResponse.json(
        { message: "A contact with this phone number already exists in your contact list." },
        { status: 409 }
      );
    }

    const newContact = await prisma.trustedContact.create({
      data: {
        userId,
        name: nameValidation.normalized!,
        phone: phoneValidation.normalized!,
        isEmergency: Boolean(isEmergency),
      },
    });

    return NextResponse.json(newContact, { status: 201 });
  } catch (error) {
    console.error("Failed to create contact:", error);
    return NextResponse.json({ message: "Failed to create contact" }, { status: 500 });
  }
}

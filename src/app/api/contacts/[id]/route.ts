import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateAndNormalizePhone, validateContactName } from "@/lib/phoneValidation";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/contacts/[id]
 * Updates a saved contact. Strictly verifies that the authenticated user owns the contact.
 */
export async function PATCH(
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
    const id = resolvedParams.id;
    if (!id) {
      return NextResponse.json({ message: "Contact ID is required" }, { status: 400 });
    }

    const existingContact = await prisma.trustedContact.findUnique({
      where: { id },
    });

    if (!existingContact) {
      return NextResponse.json({ message: "Contact not found" }, { status: 404 });
    }

    // Ownership check (prevent IDOR)
    if (existingContact.userId !== userId) {
      return NextResponse.json({ message: "Forbidden: You do not own this contact" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ message: "Invalid request payload" }, { status: 400 });
    }

    const updateData: { name?: string; phone?: string; isEmergency?: boolean } = {};

    if (body.name !== undefined) {
      const nameValidation = validateContactName(body.name);
      if (!nameValidation.isValid) {
        return NextResponse.json({ message: nameValidation.error }, { status: 400 });
      }
      updateData.name = nameValidation.normalized!;
    }

    if (body.phone !== undefined) {
      const phoneValidation = validateAndNormalizePhone(body.phone);
      if (!phoneValidation.isValid) {
        return NextResponse.json({ message: phoneValidation.error }, { status: 400 });
      }
      const newPhone = phoneValidation.normalized!;

      // If phone changed, verify not duplicate with another contact of this user
      if (newPhone !== existingContact.phone) {
        const exactDuplicate = await prisma.trustedContact.findUnique({
          where: {
            userId_phone: {
              userId,
              phone: newPhone,
            },
          },
        });

        let isDuplicate = Boolean(exactDuplicate && exactDuplicate.id !== id);
        if (!isDuplicate && newPhone.replace(/\D/g, "").length >= 10) {
          const allOtherContacts = await prisma.trustedContact.findMany({
            where: { userId, id: { not: id } },
            select: { id: true, phone: true },
          });
          const inputLast10 = newPhone.replace(/\D/g, "").slice(-10);
          isDuplicate = allOtherContacts.some(
            (c) => c.phone.replace(/\D/g, "").slice(-10) === inputLast10
          );
        }

        if (isDuplicate) {
          return NextResponse.json(
            { message: "Another contact already exists with this phone number" },
            { status: 409 }
          );
        }
      }
      updateData.phone = newPhone;
    }

    if (body.isEmergency !== undefined) {
      updateData.isEmergency = Boolean(body.isEmergency);
    }

    const updatedContact = await prisma.trustedContact.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json(updatedContact);
  } catch (error) {
    console.error("Failed to update contact:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/contacts/[id]
 * Deletes a saved contact. Strictly verifies that the authenticated user owns the contact.
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
    const id = resolvedParams.id;
    if (!id) {
      return NextResponse.json({ message: "Contact ID is required" }, { status: 400 });
    }

    const existingContact = await prisma.trustedContact.findUnique({
      where: { id },
    });

    if (!existingContact) {
      return NextResponse.json({ message: "Contact not found" }, { status: 404 });
    }

    // Ownership check (prevent IDOR)
    if (existingContact.userId !== userId) {
      return NextResponse.json({ message: "Forbidden: You do not own this contact" }, { status: 403 });
    }

    await prisma.trustedContact.delete({
      where: { id },
    });

    return NextResponse.json({ message: "Contact deleted successfully" });
  } catch (error) {
    console.error("Failed to delete contact:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

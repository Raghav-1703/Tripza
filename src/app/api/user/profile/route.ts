import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Gender } from "@prisma/client";
import { validateAndNormalizePhone } from "@/lib/phoneValidation";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        role: true,
        userType: true,
        gender: true,
        emergencyContactName: true,
        emergencyContactEmail: true,
        emergencyContactPhone: true,
        studentVerificationStatus: true,
        driverVerificationStatus: true,
        createdAt: true,
      },
    });

    if (!user) {
      return NextResponse.json({ message: "User not found" }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error("GET user profile error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { phoneNumber, gender, emergencyContactName, emergencyContactEmail, emergencyContactPhone } = await req.json();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^[0-9+\s\-()]{7,20}$/;

    // Validate own phone number if provided
    let normalizedOwnPhone: string | null | undefined = undefined;
    if (phoneNumber !== undefined) {
      if (phoneNumber === null || (typeof phoneNumber === "string" && phoneNumber.trim() === "")) {
        normalizedOwnPhone = null;
      } else {
        const phoneValidation = validateAndNormalizePhone(phoneNumber);
        if (!phoneValidation.isValid) {
          return NextResponse.json({ message: phoneValidation.error }, { status: 400 });
        }
        normalizedOwnPhone = phoneValidation.normalized!;
      }
    }

    // Validate gender if provided
    const validGenders = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"];
    let genderToUpdate: string | undefined = undefined;
    if (gender !== undefined) {
      if (validGenders.includes(gender)) {
        genderToUpdate = gender;
      } else {
        return NextResponse.json({ message: "Invalid gender selection" }, { status: 400 });
      }
    }

    // Validate emergency contact email if provided
    if (emergencyContactEmail && emergencyContactEmail.trim() !== "") {
      if (!emailRegex.test(emergencyContactEmail.trim())) {
        return NextResponse.json({ message: "Invalid emergency contact email format" }, { status: 400 });
      }
    }

    // Validate emergency contact phone if provided
    if (emergencyContactPhone && emergencyContactPhone.trim() !== "") {
      if (!phoneRegex.test(emergencyContactPhone.trim())) {
        return NextResponse.json({ message: "Invalid emergency contact phone number" }, { status: 400 });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(normalizedOwnPhone !== undefined ? { phoneNumber: normalizedOwnPhone } : {}),
        ...(genderToUpdate ? { gender: genderToUpdate as Gender } : {}),
        emergencyContactName: emergencyContactName !== undefined ? (emergencyContactName?.trim() || null) : undefined,
        emergencyContactEmail: emergencyContactEmail !== undefined ? (emergencyContactEmail?.trim()?.toLowerCase() || null) : undefined,
        emergencyContactPhone: emergencyContactPhone !== undefined ? (emergencyContactPhone?.trim() || null) : undefined,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        role: true,
        userType: true,
        gender: true,
        emergencyContactName: true,
        emergencyContactEmail: true,
        emergencyContactPhone: true,
        studentVerificationStatus: true,
        driverVerificationStatus: true,
        createdAt: true,
      },
    });

    return NextResponse.json(updatedUser);
  } catch (error) {
    console.error("PATCH user profile error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateAndNormalizePhone } from "@/lib/phoneValidation";

interface ProfileAccountFormProps {
  initialPhone?: string | null;
  initialGender?: string | null;
}

export default function ProfileAccountForm({
  initialPhone,
  initialGender,
}: ProfileAccountFormProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState(initialPhone || "");
  const [gender, setGender] = useState(initialGender || "PREFER_NOT_TO_SAY");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    let normalizedPhone: string | null = null;
    if (phoneNumber.trim() !== "") {
      const phoneValidation = validateAndNormalizePhone(phoneNumber);
      if (!phoneValidation.isValid) {
        setError(phoneValidation.error!);
        return;
      }
      normalizedPhone = phoneValidation.normalized!;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: normalizedPhone,
          gender,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to update profile details");
      }

      setPhoneNumber(data.phoneNumber || "");
      setGender(data.gender || "PREFER_NOT_TO_SAY");
      setSuccess("Account phone number updated successfully.");
      setIsEditing(false);
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setPhoneNumber(initialPhone || "");
    setGender(initialGender || "PREFER_NOT_TO_SAY");
    setError("");
    setSuccess("");
    setIsEditing(false);
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 rounded-lg text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-lg text-sm">
          {success}
        </div>
      )}

      {!isEditing ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border bg-card">
          <div className="space-y-1">
            <span className="font-semibold text-xs text-muted-foreground uppercase tracking-wider block">
              Your Personal Phone Number
            </span>
            <div className="flex items-center gap-2">
              <span className="text-base sm:text-lg font-mono font-medium">
                {phoneNumber ? `📞 ${phoneNumber}` : "Not provided"}
              </span>
              {!phoneNumber && (
                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  (Add your number for driver/passenger ride coordination)
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground pt-0.5">
              Used strictly for coordination with confirmed trip participants. Never shown publicly or on tracking links.
            </p>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsEditing(true)}
            className="self-start sm:self-auto text-xs"
          >
            {phoneNumber ? "Edit Phone Number" : "+ Add Phone Number"}
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="p-4 rounded-xl border bg-muted/20 space-y-4">
          <div className="flex items-center justify-between border-b pb-2">
            <h4 className="text-sm font-semibold">Update Account Phone Number</h4>
            <span className="text-xs text-muted-foreground">Applies to your profile</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="account-phone" className="text-xs">
                Your Mobile Number (with country code if international)
              </Label>
              <Input
                id="account-phone"
                placeholder="e.g. +91 98765 43210 or 9876543210"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                disabled={isLoading}
                maxLength={30}
                className="font-mono text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Leave empty to remove your phone number.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="account-gender" className="text-xs">Gender Preference</Label>
              <select
                id="account-gender"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                disabled={isLoading}
                className="w-full h-10 px-3 py-2 text-sm bg-background border rounded-md focus:outline-hidden focus:ring-2 focus:ring-primary"
              >
                <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                <option value="FEMALE">Female</option>
                <option value="MALE">Male</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              disabled={isLoading}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isLoading} className="text-xs">
              {isLoading ? "Saving..." : "Save Phone Number"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface BookingButtonProps {
  rideId: string;
  disabledReason?: string;
  fare?: number;
  passengerOrigin?: string;
  passengerDestination?: string;
  userGender?: string | null;
  userPhone?: string | null;
}

export default function BookingButton({ 
  rideId, 
  disabledReason,
  fare,
  passengerOrigin,
  passengerDestination,
  userGender,
  userPhone,
}: BookingButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [preferredPassengerGender, setPreferredPassengerGender] = useState<"ANY" | "FEMALE">("ANY");
  const [phoneInput, setPhoneInput] = useState("");
  const [error, setError] = useState("");

  const isFemalePassenger = userGender === "FEMALE";

  const handleBook = async () => {
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          rideId,
          fare,
          passengerOrigin,
          passengerDestination,
          preferredPassengerGender: isFemalePassenger ? preferredPassengerGender : "ANY",
          passengerPhone: phoneInput.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Booking failed");
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred");
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {!disabledReason && (
        <>
          {userPhone ? (
            <div className="bg-muted/40 p-3 rounded-lg border flex items-center justify-between text-xs">
              <div>
                <span className="font-semibold text-foreground block">Contact Phone Number</span>
                <span className="text-muted-foreground text-[11px]">Shared with driver upon booking confirmation</span>
              </div>
              <span className="font-mono font-medium text-foreground bg-background px-2.5 py-1 rounded border">
                📞 {userPhone}
              </span>
            </div>
          ) : (
            <div className="bg-muted/40 p-3 rounded-lg border space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <label htmlFor="booking-phone" className="font-semibold text-foreground">
                  Phone Number (optional)
                </label>
                <span className="text-[11px] text-muted-foreground">For driver pickup coordination</span>
              </div>
              <input
                id="booking-phone"
                type="tel"
                placeholder="e.g. +91 98765 43210"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                className="w-full h-8 px-2.5 text-xs font-mono rounded border bg-background"
              />
              <p className="text-[10px] text-muted-foreground">
                Optionally provide your phone number. Shared only with your driver if confirmed.
              </p>
            </div>
          )}

          <div className="bg-muted/40 p-4 rounded-lg border space-y-2">
            <label className="text-sm font-semibold text-foreground flex items-center justify-between">
              <span>Seat Sharing Preference</span>
              <span className="text-xs font-normal text-muted-foreground">For co-passengers</span>
            </label>
          
          {isFemalePassenger ? (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <label 
                className={`flex items-center justify-center p-2.5 rounded-md border text-xs font-medium cursor-pointer transition-all ${
                  preferredPassengerGender === "ANY" 
                    ? "bg-primary text-primary-foreground border-primary shadow-sm" 
                    : "bg-background text-muted-foreground border-input hover:bg-muted"
                }`}
              >
                <input 
                  type="radio" 
                  name="preference" 
                  value="ANY" 
                  checked={preferredPassengerGender === "ANY"} 
                  onChange={() => setPreferredPassengerGender("ANY")} 
                  className="sr-only"
                />
                ○ No Preference
              </label>
              <label 
                className={`flex items-center justify-center p-2.5 rounded-md border text-xs font-medium cursor-pointer transition-all ${
                  preferredPassengerGender === "FEMALE" 
                    ? "bg-primary text-primary-foreground border-primary shadow-sm" 
                    : "bg-background text-muted-foreground border-input hover:bg-muted"
                }`}
              >
                <input 
                  type="radio" 
                  name="preference" 
                  value="FEMALE" 
                  checked={preferredPassengerGender === "FEMALE"} 
                  onChange={() => setPreferredPassengerGender("FEMALE")} 
                  className="sr-only"
                />
                ♀ Prefer Female Passengers
              </label>
            </div>
          ) : (
            <div className="pt-1">
              <div className="flex items-center p-2.5 rounded-md border bg-background text-xs font-medium text-muted-foreground">
                <span className="text-primary font-semibold mr-1.5">○</span> No Preference (Default)
              </div>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground pt-1">
            This indicates your preference for other passengers sharing the ride. The driver&apos;s gender is not affected by this selection.
          </p>
        </div>
      </>
    )}

      <Button 
        className="w-full" 
        onClick={handleBook} 
        disabled={!!disabledReason || isLoading}
        size="lg"
      >
        {isLoading ? "Booking..." : disabledReason || "Book Seat"}
      </Button>
      {error && <p className="text-sm text-destructive text-center font-medium">{error}</p>}
    </div>
  );
}

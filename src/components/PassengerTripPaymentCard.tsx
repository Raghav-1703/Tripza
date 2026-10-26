"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import PaymentCheckout from "@/components/PaymentCheckout";
import { CheckCircle2, AlertCircle, MapPin, Sparkles } from "lucide-react";

interface PassengerTripPaymentCardProps {
  rideId?: string;
  rideStatus: "SCHEDULED" | "ACTIVE" | "COMPLETED" | "CANCELLED";
  bookingId: string;
  fare: number;
  previousFare?: number | null;
  fareVersion?: number | null;
  fareUpdatedAt?: Date | string | null;
  fareChangeReason?: string | null;
  payment?: {
    id: string;
    status: string;
    amount: number;
    amountPaid?: number | null;
    finalFare?: number | null;
    outstandingBalance?: number | null;
    refundAmount?: number | null;
    paymentMethod?: string | null;
  } | null;
  userName?: string;
  userEmail?: string;
  userPhone?: string;
}

export default function PassengerTripPaymentCard({
  rideStatus,
  bookingId,
  fare,
  previousFare,
  fareChangeReason,
  payment,
  userName,
  userEmail,
  userPhone,
}: PassengerTripPaymentCardProps) {
  const router = useRouter();
  const [showCheckout, setShowCheckout] = useState(false);
  const [showEarlyExitModal, setShowEarlyExitModal] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [earlyExitMessage, setEarlyExitMessage] = useState("");
  const [error, setError] = useState("");

  const amountPaid = typeof payment?.amountPaid === "number" && payment.amountPaid > 0
    ? payment.amountPaid
    : (payment?.status === "SUCCEEDED" ? payment.amount : 0);

  const outstandingBalance = typeof payment?.outstandingBalance === "number"
    ? payment.outstandingBalance
    : (payment?.status === "SUCCEEDED" ? 0 : fare);

  const isOverpaid = amountPaid > fare;
  const refundCredit = isOverpaid ? Math.round((amountPaid - fare) * 100) / 100 : (payment?.refundAmount ?? 0);

  const isFullyPaid = outstandingBalance === 0 && amountPaid > 0;
  const isPartiallyPaid = amountPaid > 0 && outstandingBalance > 0;
  const isPaymentDue = outstandingBalance > 0;

  const hasFareRevision = typeof previousFare === "number" && previousFare > 0 && Math.abs(fare - previousFare) > 0.01;
  const isFareReduced = hasFareRevision && fare < previousFare;
  const fareDifference = hasFareRevision ? Math.abs(previousFare - fare) : 0;

  // Determine user-friendly state
  let statusBadgeVariant: "default" | "secondary" | "destructive" | "outline" = "outline";
  let statusBadgeLabel = "Payment Due";
  let badgeColorClass = "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border-amber-300";

  if (isFullyPaid) {
    statusBadgeVariant = "default";
    statusBadgeLabel = "Paid";
    badgeColorClass = "bg-emerald-600 hover:bg-emerald-600 text-white font-semibold";
  } else if (isPartiallyPaid) {
    statusBadgeLabel = "Partially Paid";
    badgeColorClass = "bg-amber-600 hover:bg-amber-600 text-white font-semibold";
  } else if (payment?.status === "PROCESSING") {
    statusBadgeLabel = "Payment Processing";
    badgeColorClass = "bg-sky-600 hover:bg-sky-600 text-white animate-pulse";
  } else if (payment?.status === "FAILED") {
    statusBadgeVariant = "destructive";
    statusBadgeLabel = "Payment Failed";
    badgeColorClass = "bg-rose-600 hover:bg-rose-600 text-white";
  } else if (rideStatus === "COMPLETED" && isPaymentDue) {
    statusBadgeLabel = "Payment Due (Trip Ended)";
    badgeColorClass = "bg-rose-600 hover:bg-rose-600 text-white font-bold animate-pulse";
  }

  const handleEarlyExit = async () => {
    setIsExiting(true);
    setError("");
    setEarlyExitMessage("");

    try {
      let exitLat: number | null = null;
      let exitLon: number | null = null;

      if (typeof window !== "undefined" && "geolocation" in navigator) {
        try {
          const pos = await new Promise<GeolocationPosition | null>((resolve) => {
            navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
              enableHighAccuracy: true,
              timeout: 4000,
              maximumAge: 5000,
            });
          });
          if (pos && typeof pos.coords.latitude === "number" && typeof pos.coords.longitude === "number") {
            exitLat = pos.coords.latitude;
            exitLon = pos.coords.longitude;
          }
        } catch {
          // Fall back gracefully to vehicle position if browser GPS times out
        }
      }

      const res = await fetch(`/api/bookings/${bookingId}/early-exit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exitLocationName: "Early Drop-off (En route)",
          exitLat,
          exitLon,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to record early exit");
      }

      setEarlyExitMessage(data.message);
      setShowEarlyExitModal(false);
      router.refresh();
    } catch (err: unknown) {
      const e = err as Error;
      setError(e.message || "Failed to process early exit");
    } finally {
      setIsExiting(false);
    }
  };

  return (
    <div className={`rounded-xl border p-5 shadow-sm space-y-4 ${
      rideStatus === "COMPLETED" && isPaymentDue
        ? "bg-rose-50/50 dark:bg-rose-950/20 border-rose-300 dark:border-rose-900"
        : "bg-card text-card-foreground"
    }`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-base tracking-tight">
              {rideStatus === "COMPLETED" ? "🏁 Destination Reached & Settlement" : "💳 Ride Fare & Payment Status"}
            </h3>
            <Badge variant={statusBadgeVariant} className={`text-[11px] px-2 py-0.5 ${badgeColorClass}`}>
              {statusBadgeLabel}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {rideStatus === "COMPLETED"
              ? "Your ride is completed. Final trip fare settlement is displayed below."
              : "Payment is normally due when you reach your destination. You can also pay early if desired."}
          </p>
        </div>
        <div className="text-right">
          <span className="text-2xl font-black text-foreground">
            ₹{outstandingBalance > 0 ? outstandingBalance.toFixed(2) : amountPaid.toFixed(2)}
          </span>
          <span className="block text-[10px] text-muted-foreground uppercase font-semibold">
            {outstandingBalance > 0 ? (amountPaid > 0 ? "Remaining Balance Due" : "Payment Due") : "Settled Total"}
          </span>
        </div>
      </div>

      {/* Dynamic Fare Recalculation Notification Banner */}
      {hasFareRevision && isFareReduced && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-2.5">
          <Sparkles className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-bold text-emerald-700 dark:text-emerald-300">
              🟢 Fare Reduced: ₹{previousFare!.toFixed(2)} → ₹{fare.toFixed(2)} (You Saved ₹{fareDifference.toFixed(2)})
            </p>
            <p className="text-[11px] opacity-90">
              {fareChangeReason || "A co-passenger joined and shared the detour corridor, reducing your personal fare."}
            </p>
          </div>
        </div>
      )}

      {hasFareRevision && !isFareReduced && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-bold text-amber-700 dark:text-amber-300">
              ℹ️ Fare Adjusted: ₹{previousFare!.toFixed(2)} → ₹{fare.toFixed(2)} (+₹{fareDifference.toFixed(2)})
            </p>
            <p className="text-[11px] opacity-90">
              {fareChangeReason || "Route and detour updated for your trip."}
            </p>
          </div>
        </div>
      )}

      {/* Overpayment / Refund Credit Notification */}
      {refundCredit > 0 && (
        <div className="p-3 bg-sky-500/10 border border-sky-500/30 rounded-lg text-xs text-sky-800 dark:text-sky-300 flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-sky-600 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-bold text-sky-700 dark:text-sky-300">
              ✨ Refund / Credit Due: ₹{refundCredit.toFixed(2)}
            </p>
            <p className="text-[11px] opacity-90">
              You paid ₹{amountPaid.toFixed(2)} earlier. Because a co-passenger joined and reduced your detour overhead, your final fare is ₹{fare.toFixed(2)}. An automatic refund credit of ₹{refundCredit.toFixed(2)} has been recorded.
            </p>
          </div>
        </div>
      )}

      {earlyExitMessage && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{earlyExitMessage}</span>
        </div>
      )}

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-xs text-destructive flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Fare Breakdown & Paid Amount Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="bg-muted/40 p-2.5 rounded-lg border">
          <span className="text-muted-foreground block text-[11px]">
            {rideStatus === "COMPLETED" ? "Final Verified Fare" : "Dynamic Route Fare"}
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="font-bold text-sm text-foreground">₹{fare.toFixed(2)}</span>
            {hasFareRevision && isFareReduced && (
              <span className="text-[10px] text-muted-foreground line-through">
                ₹{previousFare!.toFixed(2)}
              </span>
            )}
          </div>
        </div>
        <div className="bg-muted/40 p-2.5 rounded-lg border">
          <span className="text-muted-foreground block text-[11px]">Amount Paid</span>
          <span className={`font-bold text-sm ${amountPaid > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
            ₹{amountPaid.toFixed(2)}
          </span>
        </div>
        <div className="bg-muted/40 p-2.5 rounded-lg border">
          <span className="text-muted-foreground block text-[11px]">Outstanding Balance</span>
          <span className={`font-bold text-sm ${outstandingBalance > 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}>
            ₹{outstandingBalance.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Fully Paid State */}
      {isFullyPaid && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <p className="font-semibold">Trip Fully Paid (₹{amountPaid.toFixed(2)})</p>
              <p className="text-[11px] opacity-90">
                Payment verified via {payment?.paymentMethod || "Razorpay"}. No balance owed. Safe travels!
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] bg-background">
            ✓ Complete
          </Badge>
        </div>
      )}

      {/* Outstanding Balance or Unpaid State */}
      {isPaymentDue && !showCheckout && (
        <div className="space-y-3 pt-1">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/30 p-3 rounded-lg border">
            <div className="text-xs space-y-0.5">
              <span className="font-semibold text-foreground flex items-center gap-1.5">
                {rideStatus === "COMPLETED" ? (
                  <>🏁 Destination Reached: Payment Due</>
                ) : isPartiallyPaid ? (
                  <>⚠️ Outstanding Balance Due</>
                ) : (
                  <>🕒 Normal Due Time: End of Trip</>
                )}
              </span>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {rideStatus === "COMPLETED"
                  ? "Trip has ended. Please settle your final fare of ₹" + outstandingBalance.toFixed(2) + " via UPI, QR, or Card."
                  : isPartiallyPaid
                  ? "You paid ₹" + amountPaid.toFixed(2) + " earlier. Route updates have adjusted the remaining balance to ₹" + outstandingBalance.toFixed(2) + "."
                  : "Payment is due upon reaching your destination. You can also choose to pay now if you want to settle early."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setShowCheckout(true)}
                className={`font-semibold text-xs h-9 px-4 shrink-0 ${
                  rideStatus === "COMPLETED"
                    ? "bg-rose-600 hover:bg-rose-700 text-white animate-pulse"
                    : "bg-emerald-600 hover:bg-emerald-700 text-white"
                }`}
              >
                {rideStatus === "COMPLETED"
                  ? `Pay Final ₹${outstandingBalance.toFixed(2)}`
                  : isPartiallyPaid
                  ? `Pay Balance ₹${outstandingBalance.toFixed(2)}`
                  : `Pay Now (₹${outstandingBalance.toFixed(2)})`}
              </Button>
            </div>
          </div>

          {/* Early Exit Option (Available when ride is actively in progress) */}
          {rideStatus === "ACTIVE" && (
            <div className="flex items-center justify-between pt-2 border-t text-xs">
              <span className="text-muted-foreground text-[11px]">
                Need to leave before your original drop-off point?
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowEarlyExitModal(true)}
                className="text-xs h-7 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/40"
              >
                <MapPin className="w-3 h-3 mr-1" /> Exit Ride Early
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Embedded Checkout Component when active */}
      {showCheckout && (
        <div className="pt-2">
          <PaymentCheckout
            bookingId={bookingId}
            amount={fare}
            outstandingBalance={outstandingBalance}
            customButtonLabel={
              rideStatus === "COMPLETED"
                ? `Pay Final Fare: ₹${outstandingBalance.toFixed(2)}`
                : isPartiallyPaid
                ? `Pay Outstanding Balance: ₹${outstandingBalance.toFixed(2)}`
                : `Pay Early: ₹${outstandingBalance.toFixed(2)}`
            }
            prePaymentNotice={
              rideStatus === "COMPLETED"
                ? "Trip is completed. Settle your final verified fare securely."
                : "Paying early locks in your current fare. If your destination or route changes before arrival, any difference will be settled at destination."
            }
            userName={userName}
            userEmail={userEmail}
            userPhone={userPhone}
            onPaymentSuccess={() => {
              setShowCheckout(false);
              router.refresh();
            }}
            onClose={() => setShowCheckout(false)}
          />
        </div>
      )}

      {/* Early Exit Confirmation Modal */}
      {showEarlyExitModal && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 text-foreground animate-in fade-in duration-200">
          <div className="bg-background rounded-xl border shadow-2xl max-w-md w-full p-6 space-y-4 text-left relative z-[110]">
            <div className="space-y-1">
              <h3 className="text-base font-bold flex items-center gap-2">
                <MapPin className="w-4 h-4 text-amber-600" /> Leave Ride Early?
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                This will end your segment at the vehicle&apos;s current road location. Your fare will be dynamically recalculated based on actual distance travelled.
              </p>
            </div>

            <div className="bg-muted/40 p-3 rounded-lg border text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Original Fare:</span>
                <span className="font-semibold">₹{fare.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Amount Already Paid:</span>
                <span className="font-semibold text-emerald-600">₹{amountPaid.toFixed(2)}</span>
              </div>
              <p className="text-[10px] text-muted-foreground pt-1 border-t italic">
                If your recalculated fare is lower than what you paid, the difference will be automatically refunded. If higher, only the balance will be due.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowEarlyExitModal(false)}
                disabled={isExiting}
                className="text-xs"
              >
                Keep Original Destination
              </Button>
              <Button
                size="sm"
                className="bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs"
                onClick={handleEarlyExit}
                disabled={isExiting}
              >
                {isExiting ? "Calculating..." : "Confirm Early Exit"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

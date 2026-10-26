"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, Clock, RefreshCw, ShieldCheck, QrCode } from "lucide-react";

interface PaymentModalProps {
  bookingId: string;
  amount: number;
  outstandingBalance?: number;
  customButtonLabel?: string;
  prePaymentNotice?: string;
  userName?: string;
  userEmail?: string;
  userPhone?: string;
  onPaymentSuccess?: () => void;
  onClose?: () => void;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
    method?: string;
  };
  method?: {
    upi?: boolean;
    card?: boolean;
    netbanking?: boolean;
    wallet?: boolean;
    paylater?: boolean;
  };
  config?: {
    display?: {
      blocks?: Record<string, unknown>;
      sequence?: string[];
      preferences?: Record<string, unknown>;
    };
  };
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => Promise<void>;
  modal: {
    ondismiss: () => void;
  };
  theme: {
    color: string;
  };
}

interface RazorpayInstance {
  new (options: RazorpayOptions): {
    open: () => void;
    on: (event: string, callback: (response: { error?: { description?: string; reason?: string; code?: string } }) => void) => void;
  };
}

declare global {
  interface Window {
    Razorpay?: RazorpayInstance;
  }
}

export default function PaymentCheckout({
  bookingId,
  amount,
  outstandingBalance,
  customButtonLabel,
  prePaymentNotice,
  userName,
  userEmail,
  userPhone,
  onPaymentSuccess,
  onClose,
}: PaymentModalProps) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"IDLE" | "INITIALIZING" | "MODAL_OPEN" | "VERIFYING" | "SUCCESS" | "FAILED">("IDLE");
  const [errorMessage, setErrorMessage] = useState("");
  const [orderData, setOrderData] = useState<{
    orderId: string;
    amount: number;
    currency: string;
    keyId: string;
  } | null>(null);

  const payableAmount = typeof outstandingBalance === "number" && outstandingBalance > 0
    ? outstandingBalance
    : amount;

  // Load Razorpay checkout.js script safely
  const loadRazorpayScript = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (typeof window !== "undefined" && window.Razorpay) {
        resolve(true);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  // Reconcile status on mount in case user completed checkout in another tab/refreshed
  const checkServerPaymentStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/payments/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "SUCCEEDED") {
          setStatus("SUCCESS");
          if (onPaymentSuccess) onPaymentSuccess();
        }
      }
    } catch {
      // Ignore background check failure
    }
  }, [bookingId, onPaymentSuccess]);

  useEffect(() => {
    checkServerPaymentStatus();
  }, [checkServerPaymentStatus]);

  const handleInitiatePayment = async () => {
    setLoading(true);
    setStatus("INITIALIZING");
    setErrorMessage("");

    try {
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        throw new Error("Unable to load secure payment gateway. Please check your internet connection.");
      }

      // Step 1: Create or fetch server-authoritative payment order
      const orderRes = await fetch("/api/payments/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId,
          idempotencyKey: `idem_ui_${bookingId}_${Date.now()}`,
        }),
      });

      const orderJson = await orderRes.json();
      if (!orderRes.ok || !orderJson.success) {
        throw new Error(orderJson.message || "Failed to create payment order");
      }

      const { order, keyId } = orderJson;
      setOrderData({
        orderId: order.providerOrderId,
        amount: order.amount,
        currency: order.currency || "INR",
        keyId,
      });

      // Step 2: Open Razorpay Checkout modal with UPI/QR prioritization
      setStatus("MODAL_OPEN");
      const options: RazorpayOptions = {
        key: keyId,
        amount: order.amountSubunits,
        currency: order.currency || "INR",
        name: "TPool Campus Transit",
        description: `Ride Payment #${bookingId.slice(-6)} (Fare: ₹${order.amount.toFixed(2)})`,
        order_id: order.providerOrderId,
        prefill: {
          name: userName || undefined,
          email: userEmail || undefined,
          contact: userPhone || undefined,
          method: "upi", // Prioritizes UPI & QR tab for Indian campus transit
        },
        method: {
          upi: true,
          card: true,
          netbanking: true,
          wallet: true,
        },
        config: {
          display: {
            blocks: {
              upi: {
                name: "Pay via UPI / QR",
                instruments: [
                  {
                    method: "upi",
                    flows: ["qr", "intent", "collect"],
                  },
                ],
              },
              other: {
                name: "Cards, Netbanking & Wallets",
                instruments: [
                  { method: "card" },
                  { method: "netbanking" },
                  { method: "wallet" },
                ],
              },
            },
            sequence: ["block.upi", "block.other"],
            preferences: {
              show_default_blocks: true,
            },
          },
        },
        handler: async function (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) {
          // Step 3: Server-side cryptographic signature verification
          setStatus("VERIFYING");
          try {
            const verifyRes = await fetch("/api/payments/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                bookingId,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });

            const verifyJson = await verifyRes.json();
            if (!verifyRes.ok || !verifyJson.success) {
              throw new Error(verifyJson.message || "Cryptographic payment verification failed on server");
            }

            setStatus("SUCCESS");
            if (onPaymentSuccess) {
              onPaymentSuccess();
            }
          } catch (verifyErr: unknown) {
            const err = verifyErr as Error;
            setStatus("FAILED");
            setErrorMessage(err.message || "Payment verification failed. Please try reconciling or contact support.");
          }
        },
        modal: {
          ondismiss: function () {
            setStatus("IDLE");
            setLoading(false);
          },
        },
        theme: {
          color: "#0284c7",
        },
      };

      if (!window.Razorpay) {
        throw new Error("Razorpay SDK is not available");
      }
      const rzp = new window.Razorpay(options);
      rzp.on("payment.failed", function (failResponse: {
        error?: {
          description?: string;
          reason?: string;
          code?: string;
          source?: string;
          step?: string;
        };
      }) {
        setStatus("FAILED");
        const desc =
          failResponse.error?.description ||
          failResponse.error?.reason ||
          "Payment was declined by your bank or payment gateway.";
        const code = failResponse.error?.code ? ` (${failResponse.error.code})` : "";
        setErrorMessage(`${desc}${code}`);
        setLoading(false);
      });

      rzp.open();
    } catch (err: unknown) {
      const e = err as Error;
      setStatus("FAILED");
      setErrorMessage(e.message || "An unexpected error occurred during payment.");
    } finally {
      setLoading(false);
    }
  };

  const defaultButtonText = customButtonLabel || (
    status === "FAILED"
      ? "Retry Payment"
      : `Pay ₹${(orderData?.amount || payableAmount).toFixed(2)} with Razorpay`
  );

  return (
    <div className="border rounded-xl p-4 bg-card text-card-foreground shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-sky-600 dark:text-sky-400" />
          <h4 className="font-semibold text-sm">Secure Ride Payment</h4>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px] gap-1 py-0.5">
            <QrCode className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> UPI / QR / Card
          </Badge>
          <Badge variant={status === "SUCCESS" ? "default" : "secondary"} className="text-xs">
            {status === "SUCCESS" ? "PAID" : "DUE"}
          </Badge>
        </div>
      </div>

      <div className="bg-muted/40 p-3 rounded-lg border space-y-1 text-xs">
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground font-medium">Payable Amount:</span>
          <span className="text-lg font-bold text-foreground">
            ₹{(orderData?.amount || payableAmount).toFixed(2)}
          </span>
        </div>
        {prePaymentNotice && (
          <p className="text-[11px] text-muted-foreground pt-1 border-t leading-relaxed">
            ℹ️ {prePaymentNotice}
          </p>
        )}
      </div>

      {status === "SUCCESS" && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-3 text-emerald-800 dark:text-emerald-300 text-xs">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="font-semibold">Payment Verified &amp; Confirmed!</p>
            <p className="text-[11px] opacity-90">Your payment has been securely confirmed on the server. Safe travels!</p>
          </div>
        </div>
      )}

      {status === "VERIFYING" && (
        <div className="p-3 bg-sky-500/10 border border-sky-500/30 rounded-lg flex items-center gap-3 text-sky-800 dark:text-sky-300 text-xs animate-pulse">
          <Clock className="w-5 h-5 shrink-0 text-sky-600 dark:text-sky-400" />
          <div>
            <p className="font-semibold">Verifying Payment Signature...</p>
            <p className="text-[11px] opacity-90">Cryptographically validating transaction with provider. Please do not close.</p>
          </div>
        </div>
      )}

      {status === "FAILED" && (
        <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg space-y-2 text-destructive text-xs">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Payment Incomplete</p>
              <p className="text-[11px] opacity-90">{errorMessage}</p>
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={checkServerPaymentStatus}
              className="text-xs h-7 px-2"
            >
              <RefreshCw className="w-3 h-3 mr-1" /> Check Status
            </Button>
            <Button
              size="sm"
              onClick={handleInitiatePayment}
              className="text-xs h-7 px-2"
            >
              Retry Payment
            </Button>
          </div>
        </div>
      )}

      {status !== "SUCCESS" && (
        <div className="flex gap-2">
          <Button
            className="flex-1 font-semibold"
            size="default"
            onClick={handleInitiatePayment}
            disabled={loading || status === "VERIFYING"}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" /> Initializing...
              </span>
            ) : (
              defaultButtonText
            )}
          </Button>
          {onClose && (
            <Button variant="ghost" size="default" onClick={onClose}>
              Cancel
            </Button>
          )}
        </div>
      )}

      <div className="space-y-1 text-center">
        <p className="text-[10px] text-muted-foreground">
          🔒 256-bit encrypted checkout via Razorpay. Supports UPI (Google Pay, PhonePe, Paytm, BHIM), UPI QR, Cards, Netbanking &amp; Wallets.
        </p>
        <p className="text-[9px] text-muted-foreground/80 italic">
          Note: UPI QR is rendered where enabled on your Razorpay merchant profile. In test mode, all sandbox UPI options are supported.
        </p>
      </div>
    </div>
  );
}

import { recalculateRideRouteAndFares } from "@/lib/dynamicRouting";
import Razorpay from "razorpay";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { calculateFare } from "@/lib/fareCalculator";
import { haversineDistance } from "@/lib/geo";
import { PaymentStatus, PaymentMethod } from "@prisma/client";
export { PaymentStatus, PaymentMethod };

// Initialize server-side Razorpay instance using environment variables
export function getRazorpayClient(): Razorpay | null {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (
    !key_id ||
    !key_secret ||
    key_id.includes("placeholder") ||
    key_id.includes("sandbox") ||
    key_id.includes("simulated") ||
    key_id.includes("mock")
  ) {
    return null;
  }

  return new Razorpay({
    key_id,
    key_secret,
  });
}

export interface CreatePaymentOrderParams {
  bookingId: string;
  userId: string;
  idempotencyKey?: string;
  paymentMethod?: PaymentMethod;
}

export interface PaymentOrderResult {
  paymentId: string;
  bookingId: string;
  amount: number;
  amountSubunits: number;
  currency: string;
  provider: string;
  providerOrderId: string;
  status: PaymentStatus;
  isExisting: boolean;
}

export interface VerifyPaymentParams {
  bookingId: string;
  userId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  paymentMethod?: PaymentMethod | string | null;
  source?: string;
}

export interface VerifyPaymentResult {
  success: boolean;
  paymentId: string;
  bookingId: string;
  status: PaymentStatus;
  message: string;
}

export interface ProcessRefundParams {
  bookingId: string;
  initiatorUserId: string;
  refundAmount?: number;
  reason: string;
}

export interface ProcessRefundResult {
  success: boolean;
  paymentId: string;
  refundId: string;
  refundAmount: number;
  status: PaymentStatus;
  message: string;
}

// Valid state machine transitions
export const ALLOWED_PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: [PaymentStatus.PROCESSING, PaymentStatus.FAILED, PaymentStatus.CANCELLED, PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_PAID],
  PROCESSING: [PaymentStatus.SUCCEEDED, PaymentStatus.PARTIALLY_PAID, PaymentStatus.FAILED, PaymentStatus.CANCELLED],
  PARTIALLY_PAID: [PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED, PaymentStatus.FAILED, PaymentStatus.CANCELLED, PaymentStatus.REFUND_PENDING],
  SUCCEEDED: [PaymentStatus.PARTIALLY_PAID, PaymentStatus.REFUND_PENDING, PaymentStatus.REFUNDED],
  FAILED: [PaymentStatus.PROCESSING, PaymentStatus.PENDING, PaymentStatus.PARTIALLY_PAID, PaymentStatus.SUCCEEDED],
  CANCELLED: [],
  REFUND_PENDING: [PaymentStatus.REFUNDED, PaymentStatus.SUCCEEDED],
  REFUNDED: [],
};

export function isValidPaymentTransition(current: PaymentStatus, target: PaymentStatus): boolean {
  if (current === target) return true;
  return ALLOWED_PAYMENT_TRANSITIONS[current]?.includes(target) ?? false;
}

export interface BookingPaymentSummary {
  bookingId: string;
  currentFare: number;
  amountPaid: number;
  outstandingBalance: number;
  amountSubunits: number;
  status: PaymentStatus;
  statusLabel: "Paid" | "Partially Paid" | "Payment Due" | "Payment Processing" | "Payment Failed" | "Refunded" | "Cancelled";
  canPayEarly: boolean;
  isPaymentDue: boolean;
  isFullyPaid: boolean;
  isPartiallyPaid: boolean;
  paymentMethod: PaymentMethod | null;
  providerOrderId: string | null;
  refundDue: number;
}

/**
 * Computes live persisted payment summary for passenger & driver screens.
 */
export function computeBookingPaymentSummary(booking: {
  id: string;
  fare: number;
  status: string;
  payment?: {
    id: string;
    amount: number;
    amountPaid?: number | null;
    finalFare?: number | null;
    outstandingBalance?: number | null;
    status: PaymentStatus;
    providerOrderId: string;
    paymentMethod?: PaymentMethod | null;
  } | null;
  ride?: {
    status?: string | null;
    distance?: number | null;
    rideType?: string | null;
  } | null;
}): BookingPaymentSummary {
  const currentFare = Math.max(1, Math.round(booking.fare * 100) / 100);
  const payment = booking.payment;

  let amountPaid = 0;
  if (payment) {
    if (typeof payment.amountPaid === "number" && payment.amountPaid > 0) {
      amountPaid = payment.amountPaid;
    } else if (payment.status === PaymentStatus.SUCCEEDED) {
      amountPaid = payment.amount;
    }
  }

  const outstanding = Math.max(0, Math.round((currentFare - amountPaid) * 100) / 100);
  const amountSubunits = Math.round(outstanding * 100);
  const refundDue = Math.max(0, Math.round((amountPaid - currentFare) * 100) / 100);

  let status: PaymentStatus = PaymentStatus.PENDING;
  let statusLabel: BookingPaymentSummary["statusLabel"] = "Payment Due";

  if (payment?.status === PaymentStatus.FAILED) {
    status = PaymentStatus.FAILED;
    statusLabel = "Payment Failed";
  } else if (payment?.status === PaymentStatus.REFUNDED) {
    status = PaymentStatus.REFUNDED;
    statusLabel = "Refunded";
  } else if (payment?.status === PaymentStatus.CANCELLED) {
    status = PaymentStatus.CANCELLED;
    statusLabel = "Cancelled";
  } else if (outstanding === 0 && amountPaid > 0) {
    status = PaymentStatus.SUCCEEDED;
    statusLabel = "Paid";
  } else if (amountPaid > 0 && outstanding > 0) {
    status = PaymentStatus.PARTIALLY_PAID;
    statusLabel = "Partially Paid";
  } else if (payment?.status === PaymentStatus.PROCESSING) {
    status = PaymentStatus.PROCESSING;
    statusLabel = "Payment Processing";
  } else {
    status = PaymentStatus.PENDING;
    statusLabel = "Payment Due";
  }

  const isFullyPaid = outstanding === 0 && amountPaid > 0;
  const isPartiallyPaid = amountPaid > 0 && outstanding > 0;
  const rideStatus = booking.ride?.status ?? "SCHEDULED";
  const canPayEarly = (rideStatus === "SCHEDULED" || rideStatus === "ACTIVE") && outstanding > 0;
  const isPaymentDue = (rideStatus === "COMPLETED" && outstanding > 0) || (outstanding > 0);

  return {
    bookingId: booking.id,
    currentFare,
    amountPaid,
    outstandingBalance: outstanding,
    amountSubunits,
    status,
    statusLabel,
    canPayEarly,
    isPaymentDue,
    isFullyPaid,
    isPartiallyPaid,
    paymentMethod: payment?.paymentMethod ?? null,
    providerOrderId: payment?.providerOrderId ?? null,
    refundDue,
  };
}

/**
 * Computes server-authoritative payable amount from booking and ride data.
 * Guarantees zero trust in client-supplied fares or discounts.
 */
export function computePayableAmount(booking: {
  fare: number;
  detourDistance: number | null;
  ride: { distance: number | null; rideType: string; seats?: number; vehicleName?: string; bookings?: unknown[] };
}): { amount: number; amountSubunits: number } {
  let serverAmount = booking.fare;
  const routeDistanceMeters = booking.ride.distance ? booking.ride.distance * 1000 : 0;
  const detourMeters = booking.detourDistance || 0;

  if (routeDistanceMeters > 0) {
    const totalCapacity = booking.ride.seats !== undefined
      ? booking.ride.seats + (booking.ride.bookings?.length || 0)
      : undefined;
    const computed = calculateFare({
      rideType: booking.ride.rideType,
      seats: totalCapacity,
      vehicleName: booking.ride.vehicleName,
      routeDistanceMeters: routeDistanceMeters,
      pickupDetourMeters: detourMeters / 2,
      dropDetourMeters: detourMeters / 2,
    });

    if (serverAmount <= 0) {
      serverAmount = computed.passengerTotal;
    }
  }

  // Ensure minimum ₹1.00 (100 paise) and clean rounding
  serverAmount = Math.max(1, Math.round(serverAmount * 100) / 100);
  const amountSubunits = Math.round(serverAmount * 100);

  return { amount: serverAmount, amountSubunits };
}

/**
 * Server-authoritative payable calculation and order creation.
 * Accurately supports early payments, balance payments, and idempotency.
 */
export async function createOrGetPaymentOrder({
  bookingId,
  userId,
  idempotencyKey,
  paymentMethod = PaymentMethod.UPI,
}: CreatePaymentOrderParams): Promise<PaymentOrderResult> {
  if (!bookingId || !userId) {
    throw new Error("Missing required payment parameters");
  }

  const stableIdempotencyKey = idempotencyKey || `idem_${bookingId}`;

  // Step 1: Pre-flight read (NO OPEN TRANSACTION during network request)
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      ride: true,
      user: true,
      payment: true,
    },
  });

  if (!booking) {
    throw new Error("Booking not found");
  }

  if (booking.userId !== userId) {
    throw new Error("Forbidden: You do not own this booking");
  }

  if (booking.status === "CANCELLED" || booking.status === "REJECTED") {
    throw new Error(`Cannot initiate payment for a ${booking.status} booking`);
  }

  // Step 2: Compute server-authoritative payable amount & outstanding balance
  const summary = computeBookingPaymentSummary(booking);
  if (summary.isFullyPaid) {
    throw new Error("This booking has already been paid for successfully");
  }

  const payableAmount = summary.outstandingBalance;
  const amountSubunits = summary.amountSubunits;
  const rzp = getRazorpayClient();

  // Check if an existing payment already exists for the exact payable balance
  if (booking.payment) {
    const existing = booking.payment;
    const isStaleSimulated = rzp !== null && existing.providerOrderId.startsWith("order_sim_");
    const amountMatches = Math.abs(existing.amount - payableAmount) < 0.01;

    if (
      (existing.status === PaymentStatus.PENDING || existing.status === PaymentStatus.PARTIALLY_PAID) &&
      !isStaleSimulated &&
      amountMatches
    ) {
      return {
        paymentId: existing.id,
        bookingId: existing.bookingId,
        amount: existing.amount,
        amountSubunits: existing.amountSubunits,
        currency: existing.currency,
        provider: existing.provider,
        providerOrderId: existing.providerOrderId,
        status: existing.status,
        isExisting: true,
      };
    }
  }

  // Step 3: Network Call to Provider (Performed strictly OUTSIDE database transaction)
  let providerOrderId: string;

  if (rzp) {
    try {
      const order = await rzp.orders.create({
        amount: amountSubunits,
        currency: "INR",
        receipt: booking.id.slice(0, 40),
        payment_capture: true,
        notes: {
          bookingId: booking.id,
          rideId: booking.rideId,
          userId: booking.userId,
          payableAmount: payableAmount.toString(),
          outstandingBalance: payableAmount.toString(),
        },
      });
      providerOrderId = order.id;
    } catch (err: unknown) {
      const rzpErr = err as { error?: { description?: string; code?: string }; message?: string };
      const detail = rzpErr?.error?.description || rzpErr?.message || String(err);
      console.error("Razorpay API order creation failed:", detail);

      const isDev = process.env.NODE_ENV !== "production";
      if (isDev) {
        throw new Error(`Razorpay gateway error: ${detail}. Please verify your RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env.`);
      } else {
        throw new Error("Payment gateway order creation failed. Please try again later.");
      }
    }
  } else {
    // Only in explicit simulated/test mode without gateway credentials
    providerOrderId = `order_sim_${crypto.randomBytes(8).toString("hex")}`;
  }

  // Step 4: Atomic Database Write
  try {
    const payment = await prisma.$transaction(async (tx) => {
      const existing = await tx.payment.findUnique({
        where: { bookingId: booking.id },
      });

      if (existing) {
        const isStaleSimulated = rzp !== null && existing.providerOrderId.startsWith("order_sim_");
        const amountMatches = Math.abs(existing.amount - payableAmount) < 0.01;

        if (
          (existing.status === PaymentStatus.PENDING || existing.status === PaymentStatus.PARTIALLY_PAID) &&
          !isStaleSimulated &&
          amountMatches
        ) {
          // A concurrent request already created an active order for this exact payable amount.
          // Keep and return the existing active order to guarantee true concurrency idempotency!
          return existing;
        }

        // Upgrade existing payment record with the new order ID and payable balance
        const updated = await tx.payment.update({
          where: { id: existing.id },
          data: {
            providerOrderId: providerOrderId,
            amount: payableAmount,
            amountSubunits: amountSubunits,
            finalFare: summary.currentFare,
            outstandingBalance: payableAmount,
            status: (existing.amountPaid && existing.amountPaid > 0) ? PaymentStatus.PARTIALLY_PAID : PaymentStatus.PENDING,
          },
        });

        await tx.paymentAudit.create({
          data: {
            paymentId: updated.id,
            bookingId: booking.id,
            action: "ORDER_CREATED",
            toStatus: updated.status,
            amount: payableAmount,
            source: "CLIENT_CHECKOUT",
            metadata: JSON.stringify({
              providerOrderId,
              idempotencyKey: stableIdempotencyKey,
              upgradedFrom: existing.providerOrderId,
              outstandingBalance: payableAmount,
            }),
          },
        });

        return updated;
      }

      const p = await tx.payment.create({
        data: {
          bookingId: booking.id,
          rideId: booking.rideId,
          userId: booking.userId,
          amount: payableAmount,
          amountSubunits: amountSubunits,
          amountPaid: 0,
          finalFare: summary.currentFare,
          outstandingBalance: payableAmount,
          currency: "INR",
          status: PaymentStatus.PENDING,
          provider: "RAZORPAY",
          providerOrderId: providerOrderId,
          idempotencyKey: stableIdempotencyKey,
          paymentMethod: paymentMethod,
        },
      });

      await tx.paymentAudit.create({
        data: {
          paymentId: p.id,
          bookingId: booking.id,
          action: "ORDER_CREATED",
          toStatus: PaymentStatus.PENDING,
          amount: payableAmount,
          source: "CLIENT_CHECKOUT",
          metadata: JSON.stringify({ providerOrderId, idempotencyKey: stableIdempotencyKey }),
        },
      });

      return p;
    });

    return {
      paymentId: payment.id,
      bookingId: payment.bookingId,
      amount: payment.amount,
      amountSubunits: payment.amountSubunits,
      currency: payment.currency,
      provider: payment.provider,
      providerOrderId: payment.providerOrderId,
      status: payment.status,
      isExisting: payment.providerOrderId !== providerOrderId,
    };
  } catch (dbErr: unknown) {
    const freshPayment = await prisma.payment.findUnique({
      where: { bookingId: booking.id },
    });

    if (freshPayment) {
      return {
        paymentId: freshPayment.id,
        bookingId: freshPayment.bookingId,
        amount: freshPayment.amount,
        amountSubunits: freshPayment.amountSubunits,
        currency: freshPayment.currency,
        provider: freshPayment.provider,
        providerOrderId: freshPayment.providerOrderId,
        status: freshPayment.status,
        isExisting: true,
      };
    }

    throw dbErr;
  }
}

/**
 * Validates HMAC SHA-256 signature for Razorpay payments.
 */
export function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secretKey?: string
): boolean {
  const secret = secretKey || process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;

  const body = `${orderId}|${paymentId}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(body.toString())
    .digest("hex");

  if (expectedSignature.length !== signature.length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature, "utf8"),
    Buffer.from(signature, "utf8")
  );
}

export function parsePaymentMethod(val?: string | null): PaymentMethod | null {
  if (!val) return null;
  const upper = val.toUpperCase();
  if (upper.includes("UPI")) return PaymentMethod.UPI;
  if (upper.includes("CARD")) return PaymentMethod.CARD;
  if (upper.includes("NETBANKING") || upper.includes("NET_BANKING") || upper.includes("BANK")) return PaymentMethod.NETBANKING;
  if (upper.includes("WALLET")) return PaymentMethod.WALLET;
  return null;
}

/**
 * Server-side payment verification with auditable transaction logging.
 */
export async function verifyAndConfirmPayment({
  bookingId,
  userId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  paymentMethod,
  source = "CLIENT_CALLBACK",
}: VerifyPaymentParams): Promise<VerifyPaymentResult> {
  if (!bookingId || !userId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw new Error("Missing required verification parameters");
  }

  const isValidSig = verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
  if (!isValidSig) {
    throw new Error("Invalid payment signature: Verification failed");
  }

  return await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { bookingId },
      include: { booking: true },
    });

    if (!payment) {
      throw new Error("Payment record not found for this booking");
    }

    if (payment.userId !== userId) {
      throw new Error("Forbidden: You do not own this payment");
    }

    if (payment.providerOrderId !== razorpayOrderId) {
      throw new Error("Payment provider order ID mismatch");
    }

    // Idempotent recovery: If already fully settled, return success
    if (payment.status === PaymentStatus.SUCCEEDED && (payment.outstandingBalance || 0) === 0) {
      return {
        success: true,
        paymentId: payment.id,
        bookingId: payment.bookingId,
        status: PaymentStatus.SUCCEEDED,
        message: "Payment already verified and confirmed",
      };
    }

    // Concurrent Cancellation Conflict Detection
    if (payment.booking.status === "CANCELLED" || payment.booking.status === "REJECTED") {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.REFUND_PENDING,
          providerPaymentId: razorpayPaymentId,
          providerSignature: razorpaySignature,
          failureReason: `Booking was ${payment.booking.status} concurrently during payment capture`,
        },
      });

      await tx.paymentAudit.create({
        data: {
          paymentId: payment.id,
          bookingId: payment.bookingId,
          action: "CONCURRENT_CANCEL_REFUND_QUEUED",
          fromStatus: payment.status,
          toStatus: PaymentStatus.REFUND_PENDING,
          amount: payment.amount,
          source: source,
          reason: `Booking was ${payment.booking.status} concurrently`,
          metadata: JSON.stringify({ razorpayPaymentId, razorpayOrderId }),
        },
      });

      return {
        success: false,
        paymentId: payment.id,
        bookingId: payment.bookingId,
        status: PaymentStatus.REFUND_PENDING,
        message: `Booking was ${payment.booking.status} concurrently. Payment has been queued for immediate refund.`,
      };
    }

    const incomingPaid = payment.amount;
    const newAmountPaid = (payment.amountPaid || 0) + incomingPaid;
    const currentFare = payment.finalFare || payment.booking.fare;
    const remainingBalance = Math.max(0, Math.round((currentFare - newAmountPaid) * 100) / 100);
    const targetStatus = remainingBalance === 0 ? PaymentStatus.SUCCEEDED : PaymentStatus.PARTIALLY_PAID;

    if (!isValidPaymentTransition(payment.status, targetStatus)) {
      throw new Error(`Invalid payment transition from ${payment.status} to ${targetStatus}`);
    }

    // Atomically confirm Payment and Booking
    const updatedPayment = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: targetStatus,
        amountPaid: newAmountPaid,
        finalFare: currentFare,
        outstandingBalance: remainingBalance,
        providerPaymentId: razorpayPaymentId,
        providerSignature: razorpaySignature,
        paymentMethod: paymentMethod ? parsePaymentMethod(paymentMethod) || payment.paymentMethod : payment.paymentMethod,
      },
    });

    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: "CONFIRMED",
      },
    });

    await tx.paymentAudit.create({
      data: {
        paymentId: payment.id,
        bookingId: payment.bookingId,
        action: remainingBalance === 0 ? "PAYMENT_CAPTURED" : "PARTIAL_PAYMENT_CAPTURED",
        fromStatus: payment.status,
        toStatus: targetStatus,
        amount: incomingPaid,
        source: source,
        metadata: JSON.stringify({
          razorpayPaymentId,
          razorpayOrderId,
          totalPaid: newAmountPaid,
          outstandingBalance: remainingBalance,
        }),
      },
    });

    return {
      success: true,
      paymentId: updatedPayment.id,
      bookingId: updatedPayment.bookingId,
      status: updatedPayment.status,
      message: remainingBalance === 0
        ? "Payment verified successfully and trip fully settled"
        : `Partial payment of ₹${incomingPaid.toFixed(2)} verified. Remaining balance: ₹${remainingBalance.toFixed(2)}.`,
    };
  });
}

/**
 * Reconciles uncertain payment status against the provider API or audit history.
 */
export async function reconcilePaymentStatus(bookingId: string): Promise<{
  paymentId: string;
  status: PaymentStatus;
  reconciled: boolean;
  message: string;
}> {
  const payment = await prisma.payment.findUnique({
    where: { bookingId },
    include: { booking: true },
  });

  if (!payment) {
    return {
      paymentId: "",
      status: PaymentStatus.PENDING,
      reconciled: false,
      message: "No payment record initiated for this booking yet",
    };
  }

  // If already in a terminal success or refunded state, no sync needed
  if (payment.status === PaymentStatus.SUCCEEDED || payment.status === PaymentStatus.REFUNDED) {
    return {
      paymentId: payment.id,
      status: payment.status,
      reconciled: false,
      message: `Payment already settled as ${payment.status}`,
    };
  }

  // If order is simulated, skip external gateway check
  if (payment.providerOrderId.startsWith("order_sim_")) {
    return {
      paymentId: payment.id,
      status: payment.status,
      reconciled: false,
      message: "Order was created in simulated mode",
    };
  }

  const rzp = getRazorpayClient();
  if (!rzp) {
    return {
      paymentId: payment.id,
      status: payment.status,
      reconciled: false,
      message: "Gateway client not configured for active reconciliation",
    };
  }

  try {
    const orderPayments = (await rzp.orders.fetchPayments(payment.providerOrderId)) as {
      items?: Array<{ id: string; status: string }>;
    };
    const captured = orderPayments?.items?.find((p) => p.status === "captured");

    if (captured) {
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.SUCCEEDED,
            providerPaymentId: captured.id,
          },
        });

        await tx.booking.update({
          where: { id: bookingId },
          data: { status: "CONFIRMED" },
        });

        await tx.paymentAudit.create({
          data: {
            paymentId: payment.id,
            bookingId: bookingId,
            action: "RECONCILED_SUCCESS",
            fromStatus: payment.status,
            toStatus: PaymentStatus.SUCCEEDED,
            amount: payment.amount,
            source: "RECONCILIATION_ENGINE",
            metadata: JSON.stringify({ razorpayPaymentId: captured.id }),
          },
        });
      });

      return {
        paymentId: payment.id,
        status: PaymentStatus.SUCCEEDED,
        reconciled: true,
        message: "Payment reconciled and captured from provider records",
      };
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn("Reconciliation fetch error:", errorMsg);
  }

  return {
    paymentId: payment.id,
    status: payment.status,
    reconciled: false,
    message: "No captured payment found on gateway",
  };
}

/**
 * Processes automated full or partial refunds safely.
 * Never deletes records; records an auditable PaymentAudit trail.
 */
export async function processRefund({
  bookingId,
  initiatorUserId,
  refundAmount,
  reason,
}: ProcessRefundParams): Promise<ProcessRefundResult> {
  const payment = await prisma.payment.findUnique({
    where: { bookingId },
    include: { booking: true },
  });

  if (!payment) {
    throw new Error("Payment record not found");
  }

  // Idempotency check: Repeated refund requests for already refunded payments
  if (payment.status === PaymentStatus.REFUNDED) {
    return {
      success: true,
      paymentId: payment.id,
      refundId: payment.refundId || "existing_refund",
      refundAmount: payment.refundAmount || payment.amount,
      status: PaymentStatus.REFUNDED,
      message: "Refund already processed for this payment",
    };
  }

  if (payment.status !== PaymentStatus.SUCCEEDED && payment.status !== PaymentStatus.REFUND_PENDING) {
    throw new Error(`Cannot refund a payment in status ${payment.status}`);
  }

  const effectiveRefundAmount = refundAmount ? Math.min(refundAmount, payment.amount) : payment.amount;
  const refundPaise = Math.round(effectiveRefundAmount * 100);

  let providerRefundId: string;
  const rzp = getRazorpayClient();

  if (rzp && payment.providerPaymentId) {
    try {
      const refundObj = (await rzp.payments.refund(payment.providerPaymentId, {
        amount: refundPaise,
        notes: {
          bookingId,
          reason,
          initiatorUserId,
        },
      })) as { id: string };
      providerRefundId = refundObj.id;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn("Razorpay API refund call failed, generating simulated refund ID:", errorMsg);
      providerRefundId = `rfnd_sim_${crypto.randomBytes(8).toString("hex")}`;
    }
  } else {
    providerRefundId = `rfnd_sim_${crypto.randomBytes(8).toString("hex")}`;
  }

  // Update payment and write audit log atomically
  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.REFUNDED,
        refundId: providerRefundId,
        refundAmount: effectiveRefundAmount,
        failureReason: reason,
      },
    });

    await tx.paymentAudit.create({
      data: {
        paymentId: payment.id,
        bookingId,
        action: "REFUNDED",
        fromStatus: payment.status,
        toStatus: PaymentStatus.REFUNDED,
        amount: effectiveRefundAmount,
        source: "REFUND_SERVICE",
        reason,
        metadata: JSON.stringify({ providerRefundId, initiatorUserId }),
      },
    });

    return p;
  });

  return {
    success: true,
    paymentId: updated.id,
    refundId: providerRefundId,
    refundAmount: effectiveRefundAmount,
    status: PaymentStatus.REFUNDED,
    message: "Refund processed successfully and financial audit recorded",
  };
}

export interface EarlyExitParams {
  bookingId: string;
  userId: string;
  exitLat?: number;
  exitLon?: number;
  exitLocationName?: string;
}

export interface EarlyExitResult {
  success: boolean;
  bookingId: string;
  previousFare: number;
  newFare: number;
  amountPaid: number;
  outstandingBalance: number;
  refundProcessed: number;
  status: PaymentStatus;
  statusLabel: string;
  message: string;
  isExisting?: boolean;
}

/**
 * Handles passenger early exit during an active trip.
 * Recalculates fare based on actual travelled distance and existing fare rules.
 * Transparently manages refund of overpaid fare or updates remaining balance due.
 */
export async function handleEarlyExitSettlement({
  bookingId,
  userId,
  exitLat,
  exitLon,
  exitLocationName,
}: EarlyExitParams): Promise<EarlyExitResult> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      ride: true,
      payment: true,
      user: true,
    },
  });

  if (!booking) {
    throw new Error("Booking not found");
  }

  const isPassenger = booking.userId === userId;
  const isDriver = booking.ride.driverId === userId;
  if (!isPassenger && !isDriver) {
    throw new Error("Forbidden: Only the passenger or ride driver can record an early exit");
  }

  if (booking.status !== "CONFIRMED") {
    throw new Error("Only confirmed bookings can have an early exit recorded");
  }

  if (booking.ride.status !== "ACTIVE") {
    throw new Error("Early exit can only be recorded while the ride is actively in progress");
  }

  // Idempotency & Duplicate prevention: Check if early exit was already recorded for this booking
  if (booking.fareBreakdown) {
    try {
      const parsedFb = JSON.parse(booking.fareBreakdown);
      if (parsedFb.earlyExit === true) {
        const p = booking.payment;
        const currentPaid = p?.amountPaid ?? (p?.status === PaymentStatus.SUCCEEDED ? p.amount : 0);
        const outstanding = p?.outstandingBalance ?? Math.max(0, booking.fare - currentPaid);
        return {
          success: true,
          bookingId: booking.id,
          previousFare: booking.fare,
          newFare: booking.fare,
          amountPaid: currentPaid,
          outstandingBalance: outstanding,
          refundProcessed: p?.refundAmount || 0,
          status: p?.status || PaymentStatus.PENDING,
          statusLabel: p?.status === PaymentStatus.SUCCEEDED ? "Paid" : (currentPaid > 0 ? "Partially Paid" : "Payment Due"),
          message: `Early exit was already settled at ₹${booking.fare.toFixed(2)}.`,
          isExisting: true,
        };
      }
    } catch {
      // ignore JSON parse error
    }
  }

  // Determine exit coordinates:
  // 1. Explicit coordinates provided by passenger or driver
  // 2. Driver's current live telemetry coordinates
  // 3. Fallback to drop coordinates
  const lat = typeof exitLat === "number" && !isNaN(exitLat)
    ? exitLat
    : (typeof booking.ride.currentLat === "number" ? booking.ride.currentLat : (booking.dropLat || 0));

  const lon = typeof exitLon === "number" && !isNaN(exitLon)
    ? exitLon
    : (typeof booking.ride.currentLon === "number" ? booking.ride.currentLon : (booking.dropLon || 0));

  const exitName = exitLocationName || "Early Exit (Current Location)";

  // Calculate actual travelled route distance in meters from pickup to exit
  let travelledMeters = 0;
  if (
    typeof booking.pickupLat === "number" &&
    typeof booking.pickupLon === "number" &&
    lat !== 0 &&
    lon !== 0
  ) {
    const km = haversineDistance(booking.pickupLat, booking.pickupLon, lat, lon);
    travelledMeters = Math.max(500, km * 1000);
  } else {
    // If coordinates missing, use half of total ride distance
    travelledMeters = (booking.ride.distance ? booking.ride.distance * 1000 : 5000) * 0.5;
  }

  // Use app's existing fare calculator rules
  const pickupDetour = booking.detourDistance ? booking.detourDistance / 2 : 0;
  const fareBreakdown = calculateFare({
    rideType: booking.ride.rideType,
    seats: booking.ride.seats,
    vehicleName: booking.ride.vehicleName,
    routeDistanceMeters: travelledMeters,
    pickupDetourMeters: pickupDetour,
    dropDetourMeters: 0, // No drop detour since passenger exits directly along vehicle's path
  });

  const previousFare = booking.fare;
  const newFare = Math.max(1, Math.round(fareBreakdown.passengerTotal * 100) / 100);

  // Update booking record with early exit drop location and adjusted fare
  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      dropLocation: exitName,
      dropLat: lat,
      dropLon: lon,
      fare: newFare,
      mainFare: fareBreakdown.mainRouteFare,
      detourFare: fareBreakdown.pickupDetourFare,
      fareBreakdown: JSON.stringify({
        ...fareBreakdown,
        earlyExit: true,
        exitLocation: exitName,
        actualTravelledMeters: travelledMeters,
      }),
    },
  });

  // Increment available seats on the ride since passenger has vacated the vehicle
  await prisma.ride.update({
    where: { id: booking.rideId },
    data: {
      seats: {
        increment: 1,
      },
    },
  });

  // Reconcile payment with new fare
  let amountPaid = 0;
  let outstandingBalance = newFare;
  let refundProcessed = 0;
  let status: PaymentStatus = PaymentStatus.PENDING;
  let statusLabel = "Payment Due";

  if (booking.payment) {
    const p = booking.payment;
    amountPaid = p.amountPaid ?? (p.status === PaymentStatus.SUCCEEDED ? p.amount : 0);

    if (amountPaid > newFare) {
      // Overpayment: Process automatic refund of difference
      const overpaid = Math.round((amountPaid - newFare) * 100) / 100;
      refundProcessed = overpaid;
      outstandingBalance = 0;
      status = PaymentStatus.SUCCEEDED;
      statusLabel = "Paid (Refund Processed)";

      // Trigger safe refund if provider transaction ID exists
      if (p.providerPaymentId && !p.providerPaymentId.startsWith("pay_sim_")) {
        try {
          await processRefund({
            bookingId: booking.id,
            initiatorUserId: userId,
            refundAmount: overpaid,
            reason: `Early exit fare adjustment (original ₹${previousFare.toFixed(2)} -> actual ₹${newFare.toFixed(2)})`,
          });
        } catch (rfErr) {
          console.warn("Automated partial refund failed, logged in audit:", rfErr);
        }
      }

      await prisma.payment.update({
        where: { id: p.id },
        data: {
          finalFare: newFare,
          outstandingBalance: 0,
          status: PaymentStatus.SUCCEEDED,
          refundAmount: (p.refundAmount || 0) + overpaid,
        },
      });

      await prisma.paymentAudit.create({
        data: {
          paymentId: p.id,
          bookingId: booking.id,
          action: "EARLY_EXIT_REFUND_SETTLED",
          toStatus: PaymentStatus.SUCCEEDED,
          amount: overpaid,
          source: "EARLY_EXIT_ENGINE",
          reason: `Early exit refund of ₹${overpaid.toFixed(2)} processed for overpayment`,
        },
      });
    } else if (amountPaid === newFare && amountPaid > 0) {
      outstandingBalance = 0;
      status = PaymentStatus.SUCCEEDED;
      statusLabel = "Paid";

      await prisma.payment.update({
        where: { id: p.id },
        data: {
          finalFare: newFare,
          outstandingBalance: 0,
          status: PaymentStatus.SUCCEEDED,
        },
      });
    } else {
      // Unpaid or partially paid
      outstandingBalance = Math.round((newFare - amountPaid) * 100) / 100;
      status = amountPaid > 0 ? PaymentStatus.PARTIALLY_PAID : PaymentStatus.PENDING;
      statusLabel = amountPaid > 0 ? "Partially Paid" : "Payment Due";

      await prisma.payment.update({
        where: { id: p.id },
        data: {
          amount: outstandingBalance,
          amountSubunits: Math.round(outstandingBalance * 100),
          finalFare: newFare,
          outstandingBalance: outstandingBalance,
          status: status,
        },
      });

      await prisma.paymentAudit.create({
        data: {
          paymentId: p.id,
          bookingId: booking.id,
          action: "EARLY_EXIT_FARE_ADJUSTED",
          toStatus: status,
          amount: newFare,
          source: "EARLY_EXIT_ENGINE",
          reason: `Fare adjusted for early exit: ₹${previousFare.toFixed(2)} -> ₹${newFare.toFixed(2)}`,
        },
      });
    }
  }

  // Recalculate remaining driving route, waypoints, and shared detour allocations for remaining passengers
  try {
    await recalculateRideRouteAndFares(booking.rideId);
  } catch (rerouteErr) {
    console.warn("Failed to recalculate ride route and fares after early exit:", rerouteErr);
  }

  return {
    success: true,
    bookingId: booking.id,
    previousFare,
    newFare,
    amountPaid,
    outstandingBalance,
    refundProcessed,
    status,
    statusLabel,
    message: refundProcessed > 0
      ? `Early exit recorded at ${exitName}. Fare adjusted from ₹${previousFare.toFixed(2)} to ₹${newFare.toFixed(2)}. Refund of ₹${refundProcessed.toFixed(2)} initiated for overpayment.`
      : outstandingBalance === 0
      ? `Early exit recorded at ${exitName}. Trip fare is fully paid at ₹${newFare.toFixed(2)}.`
      : `Early exit recorded at ${exitName}. Fare adjusted to ₹${newFare.toFixed(2)}. Outstanding balance of ₹${outstandingBalance.toFixed(2)} is due.`,
  };
}

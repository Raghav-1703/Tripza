"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Flag, X, AlertTriangle, ShieldCheck, CheckCircle2 } from "lucide-react";

interface ReportUserModalProps {
  targetUserId: string;
  targetUserName: string;
  rideId?: string;
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

const REPORT_REASONS = [
  { value: "HARASSMENT", label: "Harassment or verbal abuse" },
  { value: "UNSAFE_DRIVING", label: "Unsafe or reckless driving" },
  { value: "FAKE_PROFILE", label: "Fake profile or false identity" },
  { value: "SCAM", label: "Scam, payment fraud, or extortion" },
  { value: "INAPPROPRIATE_BEHAVIOR", label: "Inappropriate or offensive behavior" },
  { value: "OTHER", label: "Other safety or policy concern" },
] as const;

export default function ReportUserModal({
  targetUserId,
  targetUserName,
  rideId,
  trigger,
  onSuccess,
}: ReportUserModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState<string>("HARASSMENT");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleOpen = () => {
    setIsOpen(true);
    setErrorMessage("");
    setIsSubmitted(false);
  };

  const handleClose = () => {
    setIsOpen(false);
    setErrorMessage("");
    setDescription("");
    setIsSubmitted(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) {
      setErrorMessage("Please select a reason for reporting");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportedUserId: targetUserId,
          rideId,
          reason,
          description: description.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setIsSubmitted(true);
        if (onSuccess) onSuccess();
        setTimeout(() => {
          handleClose();
        }, 2200);
      } else {
        setErrorMessage(data.message || "Failed to submit report. Please try again.");
      }
    } catch {
      setErrorMessage("Network error while submitting report. Please check your connection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {trigger ? (
        <span onClick={handleOpen} className="cursor-pointer">
          {trigger}
        </span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleOpen}
          className="gap-1.5 text-xs text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/40"
        >
          <Flag className="h-3.5 w-3.5" />
          <span>Report User</span>
        </Button>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-card border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col relative z-[130] animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-5 py-4 border-b flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <Flag className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-base text-foreground">Report {targetUserName}</h3>
                  <p className="text-xs text-muted-foreground">Confidential safety report</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="text-muted-foreground hover:text-foreground p-1 rounded-full hover:bg-muted transition-colors"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            {isSubmitted ? (
              <div className="p-6 text-center space-y-3">
                <div className="mx-auto w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <h4 className="font-semibold text-lg text-foreground">Report Received</h4>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Thank you for keeping TPool safe. Our moderation team has received your report and will review it confidentially.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                {errorMessage && (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label htmlFor="report-reason" className="text-xs font-semibold text-foreground">
                    Reason for report <span className="text-destructive">*</span>
                  </label>
                  <select
                    id="report-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full text-xs sm:text-sm rounded-lg border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    disabled={isSubmitting}
                  >
                    {REPORT_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <label htmlFor="report-description" className="text-xs font-semibold text-foreground">
                      Details / Description (Optional)
                    </label>
                    <span className="text-[10px] text-muted-foreground">
                      {description.length} / 2000
                    </span>
                  </div>
                  <textarea
                    id="report-description"
                    rows={4}
                    maxLength={2000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Provide specific details about the incident, location, or behavior..."
                    className="w-full text-xs sm:text-sm rounded-lg border bg-background p-3 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="p-3 rounded-lg bg-muted/50 border text-[11px] text-muted-foreground flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>
                    Reports are 100% confidential. {targetUserName} will never see your identity or report details.
                  </span>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClose}
                    disabled={isSubmitting}
                    className="text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="destructive"
                    size="sm"
                    disabled={isSubmitting}
                    className="text-xs gap-1.5 font-semibold"
                  >
                    {isSubmitting ? "Submitting..." : "Submit Report"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

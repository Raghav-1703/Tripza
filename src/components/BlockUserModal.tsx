"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Ban, ShieldAlert, X, AlertTriangle, CheckCircle2, UserCheck } from "lucide-react";

interface BlockUserModalProps {
  targetUserId: string;
  targetUserName: string;
  initialIsBlocked?: boolean;
  trigger?: React.ReactNode;
  onStatusChange?: (isBlocked: boolean) => void;
}

export default function BlockUserModal({
  targetUserId,
  targetUserName,
  initialIsBlocked = false,
  trigger,
  onStatusChange,
}: BlockUserModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isBlocked, setIsBlocked] = useState(initialIsBlocked);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const handleOpen = () => {
    setIsOpen(true);
    setErrorMessage("");
    setSuccessMessage("");
  };

  const handleClose = () => {
    setIsOpen(false);
    setErrorMessage("");
    setSuccessMessage("");
  };

  const handleToggleBlock = async () => {
    setIsLoading(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      if (isBlocked) {
        // Unblock
        const res = await fetch(`/api/blocks/${encodeURIComponent(targetUserId)}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (res.ok) {
          setIsBlocked(false);
          setSuccessMessage(`${targetUserName} has been unblocked.`);
          if (onStatusChange) onStatusChange(false);
          setTimeout(() => handleClose(), 1500);
        } else {
          setErrorMessage(data.message || "Failed to unblock user");
        }
      } else {
        // Block
        const res = await fetch("/api/blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blockedId: targetUserId }),
        });
        const data = await res.json();
        if (res.ok) {
          setIsBlocked(true);
          setSuccessMessage(`${targetUserName} has been blocked.`);
          if (onStatusChange) onStatusChange(true);
          setTimeout(() => handleClose(), 1500);
        } else {
          setErrorMessage(data.message || "Failed to block user");
        }
      }
    } catch {
      setErrorMessage("Network error. Please try again.");
    } finally {
      setIsLoading(false);
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
          className={`gap-1.5 text-xs ${
            isBlocked
              ? "text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
              : "text-destructive border-destructive/30 hover:bg-destructive/10"
          }`}
        >
          {isBlocked ? (
            <>
              <UserCheck className="h-3.5 w-3.5" />
              <span>Unblock User</span>
            </>
          ) : (
            <>
              <Ban className="h-3.5 w-3.5" />
              <span>Block User</span>
            </>
          )}
        </Button>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-card border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col relative z-[130] animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="px-5 py-4 border-b flex items-center justify-between bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div
                  className={`p-2 rounded-lg ${
                    isBlocked
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {isBlocked ? <UserCheck className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                </div>
                <div>
                  <h3 className="font-semibold text-base text-foreground">
                    {isBlocked ? `Unblock ${targetUserName}?` : `Block ${targetUserName}?`}
                  </h3>
                  <p className="text-xs text-muted-foreground">User safety &amp; interaction limits</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={isLoading}
                className="text-muted-foreground hover:text-foreground p-1 rounded-full hover:bg-muted transition-colors"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4">
              {errorMessage && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {successMessage ? (
                <div className="p-4 text-center space-y-2">
                  <div className="mx-auto w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-medium text-foreground">{successMessage}</p>
                </div>
              ) : (
                <>
                  {isBlocked ? (
                    <div className="space-y-3 text-xs text-muted-foreground">
                      <p>
                        Unblocking <strong className="text-foreground">{targetUserName}</strong> will allow you both to see each other&apos;s rides in search results, coordinate future bookings, and chat on shared rides.
                      </p>
                      <p className="p-3 rounded-lg bg-muted/50 border text-[11px]">
                        Note: Unblocking does not delete any previous safety reports or alter platform moderation records.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3 text-xs text-muted-foreground">
                      <p>
                        Are you sure you want to block <strong className="text-foreground">{targetUserName}</strong>?
                      </p>
                      <div className="space-y-2 rounded-lg bg-muted/40 border p-3">
                        <div className="flex items-start gap-2">
                          <ShieldAlert className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                          <div className="space-y-1">
                            <p className="font-semibold text-foreground text-xs">What happens when you block:</p>
                            <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                              <li>Neither of you can book rides published by the other.</li>
                              <li>You cannot send messages to each other in ride chats.</li>
                              <li>Rides from both users will be excluded from search &amp; matching.</li>
                              <li>Existing completed ride histories and ratings remain preserved safely.</li>
                            </ul>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-2 border-t">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleClose}
                      disabled={isLoading}
                      className="text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant={isBlocked ? "default" : "destructive"}
                      size="sm"
                      onClick={handleToggleBlock}
                      disabled={isLoading}
                      className="text-xs font-semibold gap-1.5"
                    >
                      {isLoading
                        ? "Processing..."
                        : isBlocked
                        ? "Confirm Unblock"
                        : "Confirm Block"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

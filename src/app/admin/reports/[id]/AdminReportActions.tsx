"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ShieldAlert, CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import Link from "next/link";

export function AdminReportActions({
  reportId,
  reportedUserId,
  reportedUserName,
  reportedUserStatus,
}: {
  reportId: string;
  reportedUserId?: string;
  reportedUserName?: string;
  reportedUserStatus?: "ACTIVE" | "SUSPENDED";
}) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [userStatus, setUserStatus] = useState<"ACTIVE" | "SUSPENDED" | undefined>(reportedUserStatus);

  const handleUpdateReport = async (status: "RESOLVED" | "DISMISSED") => {
    setIsLoading(true);
    try {
      await fetch(`/api/admin/reports/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      router.refresh();
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleUserSuspension = async () => {
    if (!reportedUserId) return;
    const newStatus = userStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    const confirmPrompt =
      userStatus === "ACTIVE"
        ? `Are you sure you want to suspend / block ${reportedUserName || "this user"} platform-wide? They will be immediately blocked from logging in, driving, or booking rides.`
        : `Reactivate ${reportedUserName || "this user"}?`;

    if (!window.confirm(confirmPrompt)) return;

    setIsLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${reportedUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setUserStatus(newStatus);
        router.refresh();
      } else {
        const err = await res.json();
        alert(err.message || "Failed to update user status");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          className="bg-green-600 hover:bg-green-700 text-white font-semibold text-xs gap-1.5"
          size="sm"
          disabled={isLoading}
          onClick={() => handleUpdateReport("RESOLVED")}
        >
          <CheckCircle2 className="h-4 w-4" />
          Mark Resolved
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isLoading}
          onClick={() => handleUpdateReport("DISMISSED")}
          className="text-xs gap-1.5"
        >
          <XCircle className="h-4 w-4" />
          Dismiss Report
        </Button>
      </div>

      {reportedUserId && (
        <div className="flex items-center gap-2 pt-3 sm:pt-0 border-t sm:border-t-0 flex-wrap">
          <Button
            variant={userStatus === "ACTIVE" ? "destructive" : "default"}
            size="sm"
            disabled={isLoading}
            onClick={handleToggleUserSuspension}
            className="text-xs font-semibold gap-1.5"
          >
            <ShieldAlert className="h-4 w-4" />
            {userStatus === "ACTIVE"
              ? `Suspend / Block ${reportedUserName || "User"}`
              : `Reactivate ${reportedUserName || "User"}`}
          </Button>
          <Link
            href={`/admin/users/${reportedUserId}`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline px-2 py-1 font-medium"
          >
            View User Profile
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

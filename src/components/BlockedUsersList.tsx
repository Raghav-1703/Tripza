"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserX, UserCheck, AlertTriangle, RefreshCw } from "lucide-react";

interface BlockedUser {
  id: string;
  createdAt: string;
  blocked: {
    id: string;
    name: string;
    email: string;
    userType: string;
    studentVerificationStatus: string;
    driverVerificationStatus: string;
  };
}

export default function BlockedUsersList() {
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  const fetchBlockedUsers = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const res = await fetch("/api/blocks");
      if (res.ok) {
        const data = await res.json();
        setBlockedUsers(data);
      } else {
        const err = await res.json();
        setErrorMessage(err.message || "Failed to load blocked users");
      }
    } catch {
      setErrorMessage("Network error while loading blocked users");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBlockedUsers();
  }, [fetchBlockedUsers]);

  const handleUnblock = async (blockedId: string, name: string) => {
    const confirm = window.confirm(`Are you sure you want to unblock ${name}?`);
    if (!confirm) return;

    setUnblockingId(blockedId);
    try {
      const res = await fetch(`/api/blocks/${encodeURIComponent(blockedId)}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setBlockedUsers((prev) => prev.filter((b) => b.blocked.id !== blockedId));
      } else {
        const err = await res.json();
        alert(err.message || "Failed to unblock user");
      }
    } catch {
      alert("Network error while unblocking user");
    } finally {
      setUnblockingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <UserX className="h-4 w-4 text-destructive" />
            <span>Blocked Users ({blockedUsers.length})</span>
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Users you have blocked cannot book your rides, chat with you, or match with you in search.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={fetchBlockedUsers}
          disabled={isLoading}
          className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
          aria-label="Refresh blocked list"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {errorMessage && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {isLoading ? (
        <div className="p-6 text-center text-xs text-muted-foreground animate-pulse border rounded-xl bg-muted/20">
          Loading blocked users...
        </div>
      ) : blockedUsers.length === 0 ? (
        <div className="p-6 text-center border rounded-xl bg-muted/10 space-y-1">
          <p className="text-xs font-medium text-foreground">No blocked users</p>
          <p className="text-[11px] text-muted-foreground">
            You have not blocked any drivers or passengers.
          </p>
        </div>
      ) : (
        <div className="divide-y border rounded-xl overflow-hidden bg-card">
          {blockedUsers.map((item) => (
            <div
              key={item.id}
              className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm text-foreground">{item.blocked.name}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {item.blocked.userType}
                  </Badge>
                  {item.blocked.driverVerificationStatus === "APPROVED" && (
                    <Badge variant="default" className="bg-blue-600 text-[10px] px-1.5 py-0">
                      Verified Driver
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{item.blocked.email}</p>
                <p className="text-[10px] text-muted-foreground">
                  Blocked on {new Date(item.createdAt).toLocaleDateString()}
                </p>
              </div>

              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleUnblock(item.blocked.id, item.blocked.name)}
                  disabled={unblockingId === item.blocked.id}
                  className="gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 w-full sm:w-auto"
                >
                  <UserCheck className="h-3.5 w-3.5" />
                  <span>{unblockingId === item.blocked.id ? "Unblocking..." : "Unblock"}</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

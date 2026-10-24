"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { validateAndNormalizePhone, validateContactName } from "@/lib/phoneValidation";

interface Contact {
  id: string;
  name: string;
  phone: string;
  isEmergency: boolean;
}

interface ShareTokenItem {
  id: string;
  token: string;
  shareUrl: string;
  recipientName: string | null;
  recipientPhone: string | null;
  isRevoked: boolean;
  isExpired: boolean;
  createdAt: string;
}

interface ShareTripModalProps {
  rideId: string;
  rideStatus: string;
}

export default function ShareTripModal({ rideId, rideStatus }: ShareTripModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<"saved" | "manual">("saved");
  const [savedContacts, setSavedContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string>("");

  // Manual one-time inputs
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  // Action states
  const [generating, setGenerating] = useState(false);
  const [generatedResult, setGeneratedResult] = useState<{
    shareUrl: string;
    safetyMessage: string;
    smsUri: string;
    recipientPhone: string;
    isLocalhost?: boolean;
  } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active links list
  const [activeTokens, setActiveTokens] = useState<ShareTokenItem[]>([]);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const loadContacts = useCallback(async () => {
    try {
      setLoadingContacts(true);
      const res = await fetch("/api/contacts");
      if (res.ok) {
        const data = await res.json();
        setSavedContacts(Array.isArray(data) ? data : []);
        if (data.length > 0 && !selectedContactId) {
          setSelectedContactId(data[0].id);
        }
      }
    } catch {
      // Fallback silently if contacts fail to load
    } finally {
      setLoadingContacts(false);
    }
  }, [selectedContactId]);

  const loadActiveTokens = useCallback(async () => {
    try {
      const res = await fetch(`/api/rides/${rideId}/share`);
      if (res.ok) {
        const data = await res.json();
        setActiveTokens(Array.isArray(data) ? data : []);
      }
    } catch {
      // Fallback silently
    }
  }, [rideId]);

  useEffect(() => {
    if (isOpen) {
      loadContacts();
      loadActiveTokens();
      setError(null);
      setGeneratedResult(null);
    }
  }, [isOpen, loadContacts, loadActiveTokens]);

  const handleGenerateAndShare = async () => {
    setError(null);
    let targetPhone = "";
    let targetName = "";

    if (mode === "saved") {
      const contact = savedContacts.find((c) => c.id === selectedContactId);
      if (!contact) {
        setError("Please select a saved contact, or switch to one-time phone entry.");
        return;
      }
      targetPhone = contact.phone;
      targetName = contact.name;
    } else {
      const phoneValidation = validateAndNormalizePhone(manualPhone);
      if (!phoneValidation.isValid) {
        setError(phoneValidation.error!);
        return;
      }
      targetPhone = phoneValidation.normalized!;

      if (manualName.trim()) {
        const nameValidation = validateContactName(manualName);
        if (!nameValidation.isValid) {
          setError(nameValidation.error!);
          return;
        }
        targetName = nameValidation.normalized!;
      }
    }

    try {
      setGenerating(true);
      const res = await fetch(`/api/rides/${rideId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientPhone: targetPhone,
          recipientName: targetName || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Failed to generate tracking link");
        return;
      }

      const cleanPhone = targetPhone.replace(/[\s\-\(\)]/g, "");
      const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
      // iOS prefers '&body=', Android & RFC 5724 prefer '?body='
      const smsUri = isIOS
        ? `sms:${cleanPhone}&body=${encodeURIComponent(data.safetyMessage)}`
        : `sms:${cleanPhone}?body=${encodeURIComponent(data.safetyMessage)}`;

      setGeneratedResult({
        shareUrl: data.shareUrl,
        safetyMessage: data.safetyMessage,
        smsUri,
        recipientPhone: targetPhone,
        isLocalhost: data.isLocalhost,
      });

      // Reload active tokens list
      loadActiveTokens();

      // Trigger native SMS handoff
      if (typeof window !== "undefined") {
        window.location.href = smsUri;
      }
    } catch {
      setError("Network error while creating trip share link.");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyLink = async () => {
    if (!generatedResult) return;
    try {
      await navigator.clipboard.writeText(generatedResult.shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      setError("Unable to copy to clipboard automatically. Please copy the link manually.");
    }
  };

  const handleCopyMessage = async () => {
    if (!generatedResult) return;
    try {
      await navigator.clipboard.writeText(generatedResult.safetyMessage);
      setCopiedMsg(true);
      setTimeout(() => setCopiedMsg(false), 2500);
    } catch {
      setError("Unable to copy to clipboard automatically.");
    }
  };

  const handleWebShare = async () => {
    if (!generatedResult || !navigator.share) return;
    try {
      await navigator.share({
        title: "TPool Live Trip Sharing",
        text: generatedResult.safetyMessage,
        url: generatedResult.shareUrl,
      });
    } catch {
      // User cancelled share dialog
    }
  };

  const handleRevokeToken = async (tokenId: string) => {
    if (!confirm("Are you sure you want to revoke this tracking link? The viewer will immediately lose access to live trip updates.")) {
      return;
    }

    try {
      setRevokingId(tokenId);
      const res = await fetch(`/api/rides/${rideId}/share?tokenId=${tokenId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setActiveTokens((prev) =>
          prev.map((t) => (t.id === tokenId ? { ...t, isRevoked: true } : t))
        );
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.message || "Failed to revoke share link");
      }
    } catch {
      alert("Network error revoking share link");
    } finally {
      setRevokingId(null);
    }
  };

  if (rideStatus === "COMPLETED" || rideStatus === "CANCELLED") {
    return null;
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 border-emerald-500/40 hover:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-medium"
      >
        <span>🛡️</span>
        <span>Share Trip (SMS)</span>
      </Button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-card text-card-foreground border shadow-xl rounded-2xl max-w-lg w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150 my-8">
            <div className="flex items-start justify-between border-b pb-4">
              <div>
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <span>🛡️ Share Trip for Safety</span>
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Share a secure, live GPS tracking link with your loved ones via native SMS for free.
                </p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-muted-foreground hover:text-foreground text-lg p-1"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 rounded-lg text-xs">
                {error}
              </div>
            )}

            {/* Recipient Mode Tabs */}
            <div className="flex border rounded-lg overflow-hidden p-1 bg-muted/40 text-xs font-medium">
              <button
                type="button"
                onClick={() => { setMode("saved"); setGeneratedResult(null); }}
                className={`flex-1 py-1.5 rounded-md transition-colors ${
                  mode === "saved" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Saved Contacts ({savedContacts.length})
              </button>
              <button
                type="button"
                onClick={() => { setMode("manual"); setGeneratedResult(null); }}
                className={`flex-1 py-1.5 rounded-md transition-colors ${
                  mode === "manual" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                One-Time Phone Number
              </button>
            </div>

            {mode === "saved" ? (
              <div className="space-y-3">
                {loadingContacts ? (
                  <div className="text-xs text-muted-foreground py-2">Loading contacts...</div>
                ) : savedContacts.length === 0 ? (
                  <div className="p-4 border rounded-xl bg-muted/20 text-center space-y-2 text-xs">
                    <p className="text-muted-foreground">You don&apos;t have any saved contacts yet.</p>
                    <p className="text-[11px] text-muted-foreground">
                      Switch to &quot;One-Time Phone Number&quot; above or save contacts in your Profile.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {savedContacts.map((c) => (
                      <label
                        key={c.id}
                        className={`flex items-center justify-between p-3 border rounded-xl cursor-pointer text-xs transition-colors ${
                          selectedContactId === c.id
                            ? "border-primary bg-primary/5 shadow-2xs"
                            : "hover:bg-muted/30"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="radio"
                            name="selectedContact"
                            checked={selectedContactId === c.id}
                            onChange={() => setSelectedContactId(c.id)}
                            className="text-primary focus:ring-primary h-4 w-4"
                          />
                          <div>
                            <div className="font-semibold text-foreground flex items-center gap-1.5">
                              {c.name}
                              {c.isEmergency && (
                                <Badge variant="outline" className="border-red-500/30 text-red-600 text-[9px] px-1 py-0">
                                  Emergency
                                </Badge>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground font-mono">{c.phone}</div>
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="manual-name" className="text-xs">Recipient Name (Optional)</Label>
                  <Input
                    id="manual-name"
                    placeholder="e.g. Mom or David"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    className="h-8 text-xs"
                    maxLength={100}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="manual-phone" className="text-xs">Recipient Phone Number</Label>
                  <Input
                    id="manual-phone"
                    placeholder="e.g. +91 9876543210 or 9876543210"
                    value={manualPhone}
                    onChange={(e) => setManualPhone(e.target.value)}
                    className="h-8 text-xs font-mono"
                    maxLength={30}
                    required
                  />
                </div>
              </div>
            )}

            {/* Generated Result & SMS Handoff Panel */}
            {generatedResult && (
              <div className="p-4 rounded-xl border-2 border-emerald-500/40 bg-emerald-500/5 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                    <span>✓</span> Tracking Link Generated
                  </span>
                  <a
                    href={generatedResult.smsUri}
                    className="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-2.5 py-1 rounded-md text-xs shadow-xs"
                  >
                    <span>💬 Open SMS App</span>
                  </a>
                </div>

                <div className="bg-background/80 p-2.5 rounded-lg border font-mono text-[11px] break-all select-all text-muted-foreground">
                  {generatedResult.shareUrl}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCopyLink}
                    className="h-7 text-xs flex-1"
                  >
                    {copiedLink ? "✓ Link Copied!" : "📋 Copy Link"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleCopyMessage}
                    className="h-7 text-xs flex-1"
                  >
                    {copiedMsg ? "✓ Text Copied!" : "📋 Copy Message"}
                  </Button>
                  {typeof navigator !== "undefined" && "share" in navigator && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleWebShare}
                      className="h-7 text-xs"
                    >
                      🔗 Web Share
                    </Button>
                  )}
                </div>

                <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">
                  <strong className="text-foreground">Important:</strong> TPool triggered your device&apos;s native messaging application with the safety text prefilled. Please review and tap <strong>Send</strong> in your SMS app. (TPool charges zero SMS fees; standard mobile carrier SMS rates apply).
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-between items-center pt-2 border-t">
              <span className="text-[11px] text-muted-foreground">
                Zero SMS fees • Native SMS handoff
              </span>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsOpen(false)}
                  className="text-xs"
                >
                  Close
                </Button>
                <Button
                  size="sm"
                  onClick={handleGenerateAndShare}
                  disabled={generating || (mode === "saved" && savedContacts.length === 0)}
                  className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {generating ? "Generating..." : "Generate & Open SMS"}
                </Button>
              </div>
            </div>

            {/* Active Shared Links Section */}
            {activeTokens.length > 0 && (
              <div className="border-t pt-4 space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Active Share Links for this Ride ({activeTokens.length})
                </h4>
                <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                  {activeTokens.map((t) => (
                    <div
                      key={t.id}
                      className="p-2.5 rounded-lg border bg-muted/20 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="space-y-0.5 truncate">
                        <div className="font-medium truncate">
                          {t.recipientName || "Contact"} {t.recipientPhone && `(${t.recipientPhone})`}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px]">
                          {t.isRevoked ? (
                            <Badge variant="outline" className="border-red-500/30 text-red-600 py-0 text-[9px]">
                              Revoked
                            </Badge>
                          ) : t.isExpired ? (
                            <Badge variant="outline" className="text-muted-foreground py-0 text-[9px]">
                              Expired
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 py-0 text-[9px]">
                              Active
                            </Badge>
                          )}
                          <span className="text-muted-foreground">
                            Created {new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>

                      {!t.isRevoked && !t.isExpired && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleRevokeToken(t.id)}
                          disabled={revokingId === t.id}
                          className="text-[11px] h-7 text-destructive hover:bg-destructive/10"
                        >
                          {revokingId === t.id ? "Revoking..." : "Revoke Access"}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

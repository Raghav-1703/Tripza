"use client";

import { useState, useEffect } from "react";
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
  createdAt: string;
}

export default function ContactManagement() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form states for adding
  const [name, setName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [isEmergency, setIsEmergency] = useState<boolean>(false);

  // Form states for editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [editPhone, setEditPhone] = useState<string>("");
  const [editIsEmergency, setEditIsEmergency] = useState<boolean>(false);
  const [editSubmitting, setEditSubmitting] = useState<boolean>(false);

  // Web Contact Picker API availability
  const [hasContactPicker, setHasContactPicker] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== "undefined" && "contacts" in navigator && "ContactsManager" in window) {
      setHasContactPicker(true);
    }
    fetchContacts();
  }, []);

  const fetchContacts = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/contacts");
      if (!res.ok) {
        throw new Error("Failed to load contacts");
      }
      const data = await res.json();
      setContacts(Array.isArray(data) ? data : []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error fetching contacts";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handlePickFromDevice = async () => {
    setError(null);
    try {
      if (!("contacts" in navigator) || !("ContactsManager" in window)) {
        setError("Device contact picker is not supported on this browser or platform.");
        return;
      }

      // @ts-expect-error Web Contact Picker API is experimental
      const selected = await navigator.contacts.select(["name", "tel"], { multiple: false });
      if (selected && selected.length > 0) {
        const contact = selected[0];
        if (contact.name && contact.name.length > 0) {
          setName(contact.name[0]);
        }
        if (contact.tel && contact.tel.length > 0) {
          setPhone(contact.tel[0]);
        }
        setSuccess("Contact details imported from device. Review and save below.");
      }
    } catch (err: unknown) {
      // User cancelled or permission denied
      if (err instanceof Error && err.name === "AbortError") {
        return; // Normal cancellation
      }
      setError("Unable to access device contacts. You can enter details manually.");
    }
  };

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const nameValidation = validateContactName(name);
    if (!nameValidation.isValid) {
      setError(nameValidation.error!);
      return;
    }

    const phoneValidation = validateAndNormalizePhone(phone);
    if (!phoneValidation.isValid) {
      setError(phoneValidation.error!);
      return;
    }

    try {
      setSubmitting(true);
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameValidation.normalized,
          phone: phoneValidation.normalized,
          isEmergency,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Failed to add contact");
        return;
      }

      setSuccess(`Contact "${data.name}" added successfully.`);
      setName("");
      setPhone("");
      setIsEmergency(false);
      setContacts((prev) => [data, ...prev]);
    } catch {
      setError("Network or server failure while saving contact.");
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (c: Contact) => {
    setEditingId(c.id);
    setEditName(c.name);
    setEditPhone(c.phone);
    setEditIsEmergency(c.isEmergency);
    setError(null);
    setSuccess(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditPhone("");
    setEditIsEmergency(false);
  };

  const handleUpdateContact = async (id: string) => {
    setError(null);
    setSuccess(null);

    const nameValidation = validateContactName(editName);
    if (!nameValidation.isValid) {
      setError(nameValidation.error!);
      return;
    }

    const phoneValidation = validateAndNormalizePhone(editPhone);
    if (!phoneValidation.isValid) {
      setError(phoneValidation.error!);
      return;
    }

    try {
      setEditSubmitting(true);
      const res = await fetch(`/api/contacts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameValidation.normalized,
          phone: phoneValidation.normalized,
          isEmergency: editIsEmergency,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Failed to update contact");
        return;
      }

      setSuccess(`Contact "${data.name}" updated successfully.`);
      setContacts((prev) => prev.map((c) => (c.id === id ? data : c)));
      cancelEdit();
    } catch {
      setError("Network error updating contact.");
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDeleteContact = async (id: string, contactName: string) => {
    if (!confirm(`Are you sure you want to remove "${contactName}" from your trusted contacts?`)) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/contacts/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || "Failed to delete contact");
        return;
      }

      setSuccess(`Contact "${contactName}" removed.`);
      setContacts((prev) => prev.filter((c) => c.id !== id));
      if (editingId === id) {
        cancelEdit();
      }
    } catch {
      setError("Network error deleting contact.");
    }
  };

  return (
    <div className="space-y-6">
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

      {/* Add New Contact Form */}
      <form onSubmit={handleAddContact} className="p-4 rounded-xl border bg-muted/20 space-y-4">
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2">
          <h3 className="text-base font-semibold">Add Trusted or Emergency Contact</h3>
          {hasContactPicker && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePickFromDevice}
              className="text-xs self-start sm:self-auto"
            >
              📱 Pick from Device Contacts
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="contact-name" className="text-xs">Full Name</Label>
            <Input
              id="contact-name"
              placeholder="e.g. Sarah Jenkins"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              maxLength={100}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact-phone" className="text-xs">Phone Number (with country code if international)</Label>
            <Input
              id="contact-phone"
              placeholder="e.g. +91 9876543210 or 9876543210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={submitting}
              maxLength={30}
              required
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isEmergency}
              onChange={(e) => setIsEmergency(e.target.checked)}
              disabled={submitting}
              className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4"
            />
            <span className="font-medium text-foreground">Mark as Emergency Contact</span>
          </label>

          <Button type="submit" disabled={submitting} size="sm">
            {submitting ? "Saving..." : "Save Contact"}
          </Button>
        </div>
      </form>

      {/* Contacts List */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold">Saved Contacts ({contacts.length})</h3>

        {loading ? (
          <div className="text-sm text-muted-foreground py-4">Loading contacts...</div>
        ) : contacts.length === 0 ? (
          <div className="p-6 text-center border rounded-xl bg-card text-muted-foreground text-sm">
            <p>No saved contacts yet.</p>
            <p className="text-xs mt-1">Add trusted contacts above to quickly share live ride tracking links via SMS.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {contacts.map((c) => (
              <div
                key={c.id}
                className="p-3.5 border rounded-xl bg-card flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                {editingId === c.id ? (
                  <div className="w-full space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Name"
                        disabled={editSubmitting}
                        maxLength={100}
                      />
                      <Input
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        placeholder="Phone"
                        disabled={editSubmitting}
                        maxLength={30}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editIsEmergency}
                          onChange={(e) => setEditIsEmergency(e.target.checked)}
                          disabled={editSubmitting}
                          className="rounded h-4 w-4 text-primary"
                        />
                        Emergency Contact
                      </label>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={cancelEdit}
                          disabled={editSubmitting}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleUpdateContact(c.id)}
                          disabled={editSubmitting}
                        >
                          {editSubmitting ? "Updating..." : "Save Changes"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{c.name}</span>
                        {c.isEmergency && (
                          <Badge variant="outline" className="border-red-500/30 text-red-600 dark:text-red-400 text-[11px] bg-red-500/10">
                            🚨 Emergency Contact
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1 font-mono">
                        📞 {c.phone}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(c)}
                        className="text-xs h-8"
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteContact(c.id, c.name)}
                        className="text-xs h-8 text-destructive hover:bg-destructive/10"
                      >
                        Delete
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

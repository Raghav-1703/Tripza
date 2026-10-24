"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Send, MessageSquare, ShieldCheck, X, Flag, Ban } from "lucide-react";
import ReportUserModal from "@/components/ReportUserModal";
import BlockUserModal from "@/components/BlockUserModal";

interface Message {
  id: string;
  content: string;
  createdAt: string;
  user: { name: string; id: string };
}

interface RideChatProps {
  rideId: string;
  currentUserId: string;
  driverName?: string;
  driverId?: string;
  onClose?: () => void;
}

export default function RideChat({ rideId, currentUserId, driverName, driverId, onClose }: RideChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/rides/${rideId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      } else {
        const err = await res.json();
        setError(err.message || "Failed to load messages");
      }
    } catch {
      setError("Network error");
    } finally {
      setIsLoading(false);
    }
  }, [rideId]);

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 4000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages.length]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || isSending) return;

    setIsSending(true);
    try {
      const res = await fetch(`/api/rides/${rideId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed })
      });
      if (res.ok) {
        const newMsg = await res.json();
        setMessages(prev => [...prev, newMsg]);
        setContent("");
        setTimeout(() => scrollToBottom("smooth"), 50);
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (error) {
    return (
      <div className="text-destructive text-sm p-4 border rounded-xl bg-destructive/5 border-destructive/20">
        {error}
      </div>
    );
  }

  const isCurrentUserDriver = currentUserId === driverId;

  return (
    <div className="flex flex-col border rounded-xl overflow-hidden h-[460px] bg-card text-card-foreground shadow-sm">
      {/* CHAT HEADER */}
      <div className="bg-card px-4 sm:px-5 py-3.5 border-b flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10 text-primary">
            <MessageSquare className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm sm:text-base text-foreground">Ride Discussion</h3>
              <Badge variant="outline" className="text-[10px] px-2 py-0.5 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5">
                Participant Chat
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Driver: <strong className="text-foreground font-medium">{driverName || "Assigned Driver"}</strong></span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[11px] hidden sm:inline-flex">
            {isCurrentUserDriver ? "Your Role: Driver" : "Your Role: Passenger"}
          </Badge>
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label="Close Chat"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* MESSAGE AREA */}
      <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-muted/20">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground animate-pulse">Loading discussion...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-8 text-center space-y-2">
            <div className="p-3 rounded-full bg-muted text-muted-foreground/50">
              <MessageSquare className="h-6 w-6" />
            </div>
            <h4 className="text-sm font-semibold text-foreground">No messages yet</h4>
            <p className="text-xs text-muted-foreground max-w-xs">
              Coordinate pickup spots, timing, or ask questions with your ride participants.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe = msg.user.id === currentUserId;
            const isDriverMsg = driverId ? msg.user.id === driverId : false;

            return (
              <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {!isMe && (
                  <div className="text-[11px] font-semibold text-foreground/80 mb-1 ml-1 flex items-center gap-1.5 flex-wrap">
                    <span>{msg.user.name}</span>
                    {isDriverMsg && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 border-blue-500/50 text-blue-600 dark:text-blue-400 bg-blue-500/10 flex items-center gap-0.5">
                        <ShieldCheck className="h-2.5 w-2.5" />
                        Driver
                      </Badge>
                    )}
                    <div className="flex items-center gap-1 ml-1.5 opacity-60 hover:opacity-100 transition-opacity">
                      <ReportUserModal
                        targetUserId={msg.user.id}
                        targetUserName={msg.user.name}
                        rideId={rideId}
                        trigger={
                          <span
                            className="p-0.5 hover:text-amber-600 dark:hover:text-amber-400 cursor-pointer inline-flex items-center"
                            title={`Report ${msg.user.name}`}
                          >
                            <Flag className="h-3 w-3" />
                          </span>
                        }
                      />
                      <BlockUserModal
                        targetUserId={msg.user.id}
                        targetUserName={msg.user.name}
                        trigger={
                          <span
                            className="p-0.5 hover:text-destructive cursor-pointer inline-flex items-center"
                            title={`Block ${msg.user.name}`}
                          >
                            <Ban className="h-3 w-3" />
                          </span>
                        }
                      />
                    </div>
                  </div>
                )}
                
                <div
                  className={`px-4 py-2.5 text-sm max-w-[85%] sm:max-w-[75%] break-words shadow-xs ${
                    isMe
                      ? 'bg-primary text-primary-foreground rounded-2xl rounded-tr-xs'
                      : 'bg-card border text-card-foreground rounded-2xl rounded-tl-xs'
                  }`}
                >
                  {msg.content}
                </div>

                <span className="text-[10px] text-muted-foreground mt-1 px-1 opacity-75">
                  {isMe ? 'You • ' : ''}
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* MESSAGE COMPOSER */}
      <form onSubmit={handleSend} className="p-3 sm:p-4 border-t bg-card flex items-center gap-2">
        <Input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message to ride participants..."
          className="flex-1 bg-background"
          disabled={isSending}
        />
        <Button 
          type="submit" 
          disabled={isSending || !content.trim()} 
          className="gap-1.5 px-4 font-semibold shrink-0"
        >
          <Send className="h-4 w-4" />
          <span className="hidden sm:inline">Send</span>
        </Button>
      </form>
    </div>
  );
}

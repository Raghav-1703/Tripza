/**
 * Utility for resolving and validating the single explicit public application origin (APP_URL).
 * Strictly avoids trusting arbitrary client headers (host/origin) for public share links.
 * Enforces HTTPS in production and eliminates silent localhost fallbacks.
 */

export interface PublicOriginResult {
  origin: string;
  error?: string;
  isLocalhost: boolean;
}

export function getPublicAppOrigin(): PublicOriginResult {
  // Single explicit configuration variable: APP_URL (with NEXT_PUBLIC_APP_URL as alias)
  // Strictly no silent fallback to NEXTAUTH_URL or hardcoded localhost!
  const configured = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;

  if (!configured || typeof configured !== "string" || !configured.trim()) {
    return {
      origin: "",
      isLocalhost: false,
      error:
        "Public application URL is not configured. Please set APP_URL in your .env file (e.g., APP_URL=http://localhost:3000 for local development, APP_URL=http://192.168.x.x:3000 for LAN testing, or APP_URL=https://yourdomain.com for production).",
    };
  }

  const trimmed = configured.trim().replace(/\/+$/, "");

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      origin: "",
      isLocalhost: false,
      error: `Invalid application URL format: "${trimmed}". Must be a valid absolute URL with protocol (e.g., http://localhost:3000, http://192.168.1.10:3000, or https://yourdomain.com).`,
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      origin: "",
      isLocalhost: false,
      error: `Invalid protocol "${parsed.protocol}" in application URL. Only http:// and https:// are permitted.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocalhost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local");

  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    if (parsed.protocol !== "https:") {
      return {
        origin: "",
        isLocalhost,
        error:
          "In production, APP_URL must use HTTPS. Insecure HTTP URLs cannot be used for public trip sharing.",
      };
    }
    if (isLocalhost) {
      return {
        origin: "",
        isLocalhost: true,
        error:
          "In production, APP_URL cannot be localhost or loopback address. Set APP_URL to your deployed public HTTPS domain.",
      };
    }
  }

  return {
    origin: parsed.origin,
    isLocalhost,
  };
}

export function buildPublicTrackingUrl(token: string): { url: string; error?: string; isLocalhost: boolean } {
  if (!token || typeof token !== "string" || !token.trim()) {
    return { url: "", error: "Tracking token is required", isLocalhost: false };
  }

  const { origin, error, isLocalhost } = getPublicAppOrigin();
  if (error || !origin) {
    return { url: "", error, isLocalhost: false };
  }

  const cleanToken = encodeURIComponent(token.trim());
  return {
    url: `${origin}/track/${cleanToken}`,
    isLocalhost,
  };
}

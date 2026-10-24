/**
 * Phone number validation and sanitization utility for TPool Contact Management & Trip Sharing.
 */

export interface PhoneValidationResult {
  isValid: boolean;
  normalized?: string;
  error?: string;
}

export function validateAndNormalizePhone(phoneInput: unknown): PhoneValidationResult {
  if (typeof phoneInput !== "string") {
    return { isValid: false, error: "Phone number is required and must be text" };
  }

  const trimmed = phoneInput.trim();
  if (!trimmed) {
    return { isValid: false, error: "Phone number cannot be empty" };
  }

  if (trimmed.length > 30) {
    return { isValid: false, error: "Phone number exceeds maximum length of 30 characters" };
  }

  // Remove common format characters: spaces, hyphens, parentheses, dots
  let stripped = trimmed.replace(/[\s\-\(\)\.]/g, "");

  // If 10 digits starting with 6-9 (standard mobile), normalize to +91 default country code
  if (/^[6-9][0-9]{9}$/.test(stripped)) {
    stripped = `+91${stripped}`;
  } else if (/^0[6-9][0-9]{9}$/.test(stripped)) {
    stripped = `+91${stripped.slice(1)}`;
  } else if (/^91[6-9][0-9]{9}$/.test(stripped)) {
    stripped = `+${stripped}`;
  }

  // Check if stripped number has unexpected non-digit characters (except leading '+')
  const validPattern = /^\+?[0-9]{7,15}$/;
  if (!validPattern.test(stripped)) {
    return {
      isValid: false,
      error: "Invalid phone number format. Must contain 7 to 15 digits with optional country code (+).",
    };
  }

  return {
    isValid: true,
    normalized: stripped,
  };
}

export function validateContactName(nameInput: unknown): { isValid: boolean; normalized?: string; error?: string } {
  if (typeof nameInput !== "string") {
    return { isValid: false, error: "Contact name is required and must be text" };
  }

  const trimmed = nameInput.trim();
  if (!trimmed) {
    return { isValid: false, error: "Contact name cannot be empty" };
  }

  if (trimmed.length > 100) {
    return { isValid: false, error: "Contact name cannot exceed 100 characters" };
  }

  // Basic sanitization against HTML / dangerous injection
  if (/[<>{}]/.test(trimmed)) {
    return { isValid: false, error: "Contact name contains invalid characters" };
  }

  return {
    isValid: true,
    normalized: trimmed,
  };
}

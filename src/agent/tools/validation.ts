/**
 * Input validation helpers for Agent tools.
 * All tool inputs come from LLM responses (untrusted).
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SYMBOL_PATTERN = /^[A-Z]{1,5}$/;

export function validateDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return null;
  }
  return value;
}

export function validateSymbol(value: unknown): string | null {
  if (typeof value !== "string" || !SYMBOL_PATTERN.test(value)) {
    return null;
  }
  return value;
}

export function validateString(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

export function validateNumber(
  value: unknown,
  fallback: number,
): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

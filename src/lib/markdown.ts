/**
 * Sanitize a string for safe inclusion in a markdown table cell.
 * Strips newlines and replaces pipe characters to prevent table breakage.
 */
export function sanitizeCell(value: string): string {
  return value.replace(/\|/g, "｜").replace(/\n/g, " ").trim();
}

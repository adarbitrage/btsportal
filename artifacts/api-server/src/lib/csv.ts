/**
 * RFC 4180-style escaping for a single CSV field. Values containing commas,
 * double quotes, or any kind of newline are wrapped in quotes, and embedded
 * quotes are doubled. Null/undefined become empty fields and Date instances
 * are serialized as ISO strings.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

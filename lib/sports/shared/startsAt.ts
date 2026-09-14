/** A feed's start time as ISO, or `null` when it is missing or carries no time of day (a bare date is not a start). */
export function toStartsAt(value: string | null | undefined): string | null {
  if (!value || !value.includes('T')) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

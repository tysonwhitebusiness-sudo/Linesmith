/**
 * Innings pitched — carried as OUTS, written as whole.thirds only at render (R2).
 *
 * MLB writes 6⅓ innings as "6.1" and 6⅔ as "6.2". That is not a decimal:
 * summing "5.2" and "6.2" as numbers gives 11.4, a figure that cannot exist,
 * where the real total is 12⅓ = "12.1". The G2 audit found IP totalled that way
 * (plan finding "G2 IP summed as decimals"). So arithmetic happens on outs, and
 * the notation is produced only for display.
 *
 * One module, because three parsers had grown up separately
 * (`statsapi.parseInningsPitched`, `adapter.outsFromInningsPitched`, and an
 * unused `eloModel.inningsPitchedToOuts`), each with its own idea of what a
 * malformed value means.
 */

/** "6.1" → 19. `null` for anything that is not whole.thirds notation, including "6.3" and fractional numbers. */
export function inningsPitchedToOuts(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const m = String(raw).trim().match(/^(\d+)(?:\.([0-2]))?$/);
  if (!m) return null;
  return Number(m[1]) * 3 + (m[2] ? Number(m[2]) : 0);
}

/** 37 → "12.1". The only place the notation is produced. */
export function formatInningsPitched(outs: number): string {
  const whole = Math.floor(outs / 3);
  return `${whole}.${outs - whole * 3}`;
}

/** 19 outs → 6.333… — real innings, for rates such as ERA or innings per start. */
export function outsToInnings(outs: number): number {
  return outs / 3;
}

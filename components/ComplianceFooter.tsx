/**
 * Phase 4.10 — the compliance strings `docs/audit-phase-5.md` recorded as
 * MISSING ENTIRELY. Grepping the whole tree for "not financial advice",
 * "privacy policy", "gambling problem", "1-800-GAMBLER" and "jurisdiction"
 * returned nothing before this file existed.
 *
 * This blocks anything user-facing on EITHER board, which is why it is built
 * once, here, and mounted in the root layout rather than per page. A page that
 * forgets to include it is the failure this placement removes.
 *
 * WHY THE WORDING IS WHAT IT IS. The stats board's whole claim is "we think
 * this player has the most value" — an opinion, stated as one. The disclaimer
 * has to match that and not overreach into language that implies a betting
 * product we have not shipped and, on current evidence, have not earned: no
 * model in this project has beaten a closing line (Phase 2 tennis t=+20.68,
 * Phase 3 soccer t=+3.05, 4.4 NHL games t=+5.07, 4.7 NHL props t=+3.03).
 * Claiming otherwise in a footer would be the same category error the two-bar
 * split exists to prevent, running the other way.
 */
import Link from 'next/link';

export default function ComplianceFooter() {
  return (
    <footer
      role="contentinfo"
      className="mt-12 border-t border-line bg-card px-4 py-6 text-[11px] leading-relaxed text-ink-muted sm:px-6"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
      <p className="text-ink-secondary">
        <strong>Not financial or betting advice.</strong> Linesmith publishes
        statistical projections and rankings. They are estimates, not
        predictions of what will happen, and nothing here is a recommendation
        to place a wager or a claim that any wager is profitable.
      </p>
      <p>
        Projections are built from historical performance and are wrong
        routinely. Past results do not indicate future outcomes.
      </p>
      <p>
        <strong>Availability.</strong> Sports wagering is legal only in some
        jurisdictions and is restricted by age. Linesmith does not accept
        wagers, hold funds, or take positions, and it is your responsibility to
        know the law where you are.
      </p>
      <p>
        If gambling is causing you harm, call{' '}
        <a href="tel:1-800-522-4700" className="underline underline-offset-2 hover:text-ink">1-800-GAMBLER</a> (US, 24/7, free and
        confidential).
      </p>
      <p className="pt-1">
        <Link href="/privacy" className="underline underline-offset-2 hover:text-ink">
          Privacy
        </Link>
      </p>
      </div>
    </footer>
  );
}

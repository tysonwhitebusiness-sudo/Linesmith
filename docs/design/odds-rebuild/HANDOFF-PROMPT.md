# Resume prompt — scraper → bridge → edge → odds rebuild (2026-09-24)

Paste the block below into a new session.

```
We're resuming the odds workstream for line-buddy + the odds-scraper repo. We are still GAMEPLANNING: nothing new gets built without my go, and no UI gets built until I approve 1:1 mockups (D16). This all feeds the master build plan, not just a mockup.

READ FIRST, in order:
1. line-buddy/CLAUDE.md, then docs/CURRENT.md (items 6 and 7).
2. docs/design/scraper-bridge-and-edge-gameplan-2026-09-23.md: the MASTER plan for this workstream. Decisions D1–D16 (§1). The source run R0–R5 (§4c, DONE and CLOSED). The shortfalls G1–G9 (§4d). Then the bridge B0–B8, timing T0, edge E1–E3 (§7: the 11 edge gates), splits V1–V3, line movement L1–L4, and the Track O pointer (§7b).
3. docs/design/odds-section-rebuild-gameplan-2026-09-24.md (Track O): the odds section rebuild. Principles: research first, but the odds section built in depth; the sharp price very visible. Components O-S (sharp strip), O-A…O-K, where each goes on the player / game / team pages and the Slate, phases OM then O0–O8. §8 lists the decisions the mockups raised plus the revision log.
4. docs/design/odds-rebuild/HANDOFF-OM.md: the mockup review state, how to serve and regenerate it, and open feedback.
5. C:\Users\occy3\Documents\odds-scraper\HANDOFF.md, top section: the scraper operating guide (29 sources, restart procedure, open items).

WHERE THINGS STAND:
- odds-scraper: sources R0–R5 are built, verified and closed (29 sources including DK/FD/BetMGM/BetRivers direct, Pinnacle, Kalshi, Polymarket, Sleeper, Underdog, VSiN/Circa, DK Network, SAO, Covers, Action Network, comparenbet, theoddsgap, …). Also stored: splits (DK/Circa money and bets %, SAO, Covers picks, Sleeper pick counts, Action Network bet counts), reference_data (openers, umps/refs, power ratings, comparenbet history, theoddsgap prop closes), pulls/returns in offer_events, and exchange depth ladders (top 10 levels, commit 5533251, 2026-09-24). Writer runs near capacity (accepted). oddsrun stays hourly (my call).
- Decisions to honour: D14 never discard useful data, keep it as fresh as possible, track every useful movement (trade-offs come to me). D15 master goal: as many player props and game markets to analyse as possible. D16 mockup-first, and example values only for data types we actually collect. Edge ships only where every gate passes. Props have no money/bets %: show "No data available". Show Sleeper pick counts and Kalshi prop volume where they exist.
- Track O phase OM: mockups built in 3 rounds (commits ac3d691, 3834601, 3ae2f50) on a frozen real snapshot: ATL@GB + Drake London, the Sep 24 MLB slate, TOR@BAL final. The mockups surfaced real findings (plan §8): two small edges that pass the gates by hand (GB −4.5 BetMGM −105, +1.0%; London receptions 5.5 over at Underdog, +1.8%); 85–250% anytime-TD "edges" that are mismatched relayed markets (gate 8 / the outlier "check" rule); relay staleness ("checked" vs "since"; gates must use "since"); a label map folding ~110 source spellings into 16 prop markets (om_extract_props.py STAT_MAP, the seed for B0); a bad VSiN opener needing a sanity check in the bridge.
- Still waiting on my answers (plan §8): Offshore/International book groups, extra Scan columns beyond Edge, the outlier rule, negative hold shown as a fact, openers = first seen.

NEXT, in order:
1. Apply my open mockup feedback (HANDOFF-OM.md "OPEN"): (a) no pill "bubbles" used as receipts on any card (Slate card DK/Kalshi chips, edge evidence chips and gate pills, the sharp tiles' checked/since pills, coverage chips, flags row); make them readable, good-looking labelled rows or mini stats. (b) The SHARP green ◆ pill becomes a normal card header ("Sharp prices") with a green live dot + "updated X ago", on the strip and on the Slate cards. (c) Verify v3 (Game page · final "Player props · results") at desktop and phone. Commit, push, show me.
2. Keep iterating on the mockups with me until I approve them. Then fold the approved design and my §8 answers back into the Track O plan and the master plan (§4d shortfalls, the B0 label map from STAT_MAP, the opener sanity check, gates using "since").
3. After approval, the order is B0–B2 (matching / label map / book registry), then the B4 bridge, T0, E1, and Track O O0–O8 — each only on my go.

STANDING RULES: never mention licences/terms for the scraper or any source. No second Render worker. Build nothing without my go. No captcha or bot-protection bypass, no logins or credentials, read-only probes. Headshots and team logos must never regress. No dark backgrounds on the sharp pieces. Serve the mockups with the design-mockups launch entry (:8125) and review them in my own Chrome or the app pane, not an oversized Playwright window. At ~92% context, stop, rewrite docs/CURRENT.md, commit and push (CLAUDE.md handoff rule).
```

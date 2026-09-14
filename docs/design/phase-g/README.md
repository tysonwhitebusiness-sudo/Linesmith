# Phase G mockup boards

Self-contained HTML boards from the 2026-09-13/14 design audit. Open any `g*.html`
file directly in a browser; no server needed. The typeface and elevation
switches in each board's top bar are remembered across boards.

| file | board |
|---|---|
| `g0-system.html` | Design system: type, color and contrast, elevation, components, states, motion |
| `g1-player-mlb.html` | Player research page, MLB (Bobby Witt Jr., real 2026 Statcast) |
| `g2-game-nfl-live.html` | Live game page, NFL (DAL @ NYG, real ESPN feed at halftime) |
| `g3-team-nfl.html` | Team research page, NFL (Las Vegas Raiders) |
| `g4-slate-longest-hr.html` | Slate research view: longest home run today |

**Rebuild** after editing anything in `src/` or `data/`:

```bash
node docs/design/phase-g/build.mjs
```

- `src/system.css` and `src/ui.js`: the F2 system as tokens, plus one
  implementation of each component and chart. Inlined into every board.
- `src/*.html`: board templates. `<!--SYSTEM-->` and `<!--DATA:file.json-->`
  markers are replaced at build time.
- `data/*.json`: real data snapshots, with the source recorded inside each file.

Ideas, data status and the picks needed: `docs/audit-2026-09-13/design-audit/G-ideas.md`.

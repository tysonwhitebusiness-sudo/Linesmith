-- Phase 2 — Scan ranks across markets, and that needs a baseline the existing
-- `league_rate` column cannot supply.
--
-- The master plan's ranking metric is `calibrated P(over) - league baseline for
-- that market`: a 73% chance to clear 0.5 hits is unremarkable when the league
-- clears it 68%, while a 52% chance to clear 4.5 strikeouts against a league
-- 41% is not. Both terms have to be probabilities of the SAME event for the
-- subtraction to mean anything.
--
-- `league_rate` is not that, and using it would have been a silent unit error.
-- It is the count-prop engine's per-CHANCE rate — the `league_rate` parameter
-- `count_prop_engine.project` takes. Measured in the live table 2026-09-06:
-- 0.2219 for MLB hits (hits per plate appearance) and 0.3180 for
-- pitcher-strikeouts (strikeouts per out recorded). Subtracting "0.318
-- strikeouts per out" from "a 0.52 probability" is dimensionally meaningless,
-- and it would have produced a plausible-looking number rather than an error.
--
-- `league_baseline` is P(stat > line) for that market at THE LINE THE BOARD
-- SHOWS, measured from `player_game_history` over the same population the
-- market's own rows are drawn from — each serving pipe computes it from the
-- exact history list it already loads to build player histories, so the
-- population is matched by construction rather than by a threshold somebody
-- picked. That matters more than it sounds: P(K > 4.5) is 0.129 across all
-- pitcher-games but 0.630 across starts of 15+ outs, a five-fold swing, and
-- choosing the wrong one would reorder the entire cross-market board for a
-- purely definitional reason.
--
-- Constant per (sport, dimension, line), stored per row. That duplicates it
-- across ~338 rows per MLB market, which is deliberate: `league_rate` is
-- already stored exactly this way, the route reads rows and groups by market
-- downstream, and a separate per-market table would need its own freshness
-- story against a cache the serving job already rewrites wholesale.
--
-- NULL where the market has no line to be over (`model_prob` null markets pass
-- no line), and on every pre-existing row.
ALTER TABLE prop_model_cache
  ADD COLUMN IF NOT EXISTS league_baseline double precision;

COMMENT ON COLUMN prop_model_cache.league_baseline IS
  'League-wide P(stat > line) for this dimension at this row''s line, measured '
  'from player_game_history over the same population the market''s rows are '
  'drawn from. The comparison anchor Scan ranks against: rank = model_prob - '
  'league_baseline. NOT league_rate, which is the engine''s per-chance rate '
  '(events per plate appearance / per out) and is not a probability at all.';

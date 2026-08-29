-- Task 5.4 (P3 H10, P2 M8, Q11) — make impossible data loud.
--
-- PART 1: Q11's empirical question, answered from live data 2026-08-29.
--
-- "You don't know what Propline puts in the totals slot" — measured, and the
-- answer is that it is NOT a Propline problem. All four sources emit
-- out-of-band MLB totals: propline 1.5-13, sharpapi 1.5-15.5, the-odds-api
-- 3.5-14.5. And the out-of-band rows are not garbage — they are internally
-- COHERENT prices for a DIFFERENT proposition. Game 823985 carries
-- `total 2.5 over +110 / under -145` from bovada sitting beside a coherent
-- 6.5-9.5 cluster from twenty other books. Over 2.5 runs happens in ~93% of
-- real MLB games, so +110 is impossible for a 9-inning game total; it is an
-- entirely normal price for a TEAM total or a FIRST-5-INNINGS total.
--
-- So these are alternate-scope markets landing in the game-total slot. P3 H10
-- is right that they "cannot be the same proposition", and rejecting them is
-- correct — but they are real data about a real market, which is exactly why
-- Q23 says quarantine rather than delete.
--
-- MLB band [6, 14] chosen from the distribution, not from intuition:
--   p0.5=1.5  p1=2.5  p5=5  p95=9.5  p99=13  p99.5=14.5
--   mass sits at 7.5 (319), 9.5 (317), 8 (198), 8.5 (171), 9 (116)
--   rows below 6: 104.  rows above 14: 10.  of 1,562 total (7.3%).
-- Real MLB game totals do not go below 6 or above 14 in the modern era.
-- Soccer's band is deliberately generous ([0.5, 9.5], observed 0.5-8.5) —
-- soccer shows no corruption, and its .25/.75 Asian quarter-lines (2.75 and
-- 3.25 both observed live) are REAL, so this must not become a
-- "half-points only" rule.
--
-- PART 2: CHECK constraints on the enum-ish columns (P2 M8).
--
-- Every allowed value below was read off the live table, not assumed. Two
-- places where doing that contradicted the plan's own prose:
--   * 5.4's text says `side IN ('over','under')`. prop_odds also holds 449
--     legitimate 'other' rows (categorical markets like anytime-goalscorer).
--     Constraining to the plan's list would have rejected real data.
--   * game_odds_book_lines.side also carries 'draw' (106 rows, soccer).
--
-- `source` is deliberately NOT constrained. That value set grows every time a
-- provider is added, and a too-tight check here would reject a legitimate new
-- feed at write time — the opposite of the goal. Sport keys ARE constrained,
-- because that set is the app's own vocabulary (db.py's _GENERIC_SPORT_KEY
-- collapses soccer_epl/soccer_mls -> soccer and tennis_atp/tennis_wta ->
-- tennis before any write), not a vendor's.
--
-- REVERSIBLE: every quarantined row is copied to
-- game_odds_book_lines_quarantine_20260829 before deletion, per Q23. That
-- table is also the only sample anyone has of what the alternate-scope feeds
-- look like, so it is evidence, not merely a safety net.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Quarantine the out-of-band rows (Q23: quarantine, never delete).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_odds_book_lines_quarantine_20260829 AS
  SELECT *, 'point out of plausible range for sport+market'::text AS quarantine_reason
    FROM game_odds_book_lines WHERE false;

INSERT INTO game_odds_book_lines_quarantine_20260829
SELECT *, 'point out of plausible range for sport+market'
  FROM game_odds_book_lines
 WHERE (sport = 'mlb'    AND market = 'total'  AND (point < 6    OR point > 14))
    OR (sport = 'soccer' AND market = 'total'  AND (point < 0.5  OR point > 9.5))
    OR (sport = 'mlb'    AND market = 'spread' AND (point < -12  OR point > 12))
    OR (sport = 'soccer' AND market = 'spread' AND (point < -7.5 OR point > 7.5))
    OR (market = 'moneyline' AND point IS NOT NULL)
    OR (market IN ('total', 'spread') AND point IS NULL);

DELETE FROM game_odds_book_lines
 WHERE (sport = 'mlb'    AND market = 'total'  AND (point < 6    OR point > 14))
    OR (sport = 'soccer' AND market = 'total'  AND (point < 0.5  OR point > 9.5))
    OR (sport = 'mlb'    AND market = 'spread' AND (point < -12  OR point > 12))
    OR (sport = 'soccer' AND market = 'spread' AND (point < -7.5 OR point > 7.5))
    OR (market = 'moneyline' AND point IS NOT NULL)
    OR (market IN ('total', 'spread') AND point IS NULL);

-- ---------------------------------------------------------------------------
-- 2. game_odds_book_lines constraints
-- ---------------------------------------------------------------------------
ALTER TABLE game_odds_book_lines
  ADD CONSTRAINT gobl_market_valid CHECK (market IN ('moneyline', 'total', 'spread')),
  ADD CONSTRAINT gobl_side_valid   CHECK (side IN ('home', 'away', 'over', 'under', 'draw')),
  ADD CONSTRAINT gobl_sport_valid  CHECK (sport IN ('mlb', 'nfl', 'cfb', 'nba', 'nhl', 'soccer', 'tennis', 'golf')),
  -- A moneyline has no point; a total/spread must have one. Both directions,
  -- because a NULL point on a total is as unusable as a wrong one.
  ADD CONSTRAINT gobl_point_shape CHECK (
        (market = 'moneyline' AND point IS NULL)
     OR (market IN ('total', 'spread') AND point IS NOT NULL)
  ),
  ADD CONSTRAINT gobl_point_plausible CHECK (
        market = 'moneyline'
     OR (sport = 'mlb'    AND market = 'total'  AND point BETWEEN 6    AND 14)
     OR (sport = 'mlb'    AND market = 'spread' AND point BETWEEN -12  AND 12)
     OR (sport = 'soccer' AND market = 'total'  AND point BETWEEN 0.5  AND 9.5)
     OR (sport = 'soccer' AND market = 'spread' AND point BETWEEN -7.5 AND 7.5)
     -- Sports with no observed corruption and no established band yet get a
     -- wide sanity bound rather than a fabricated tight one.
     OR (sport NOT IN ('mlb', 'soccer') AND point BETWEEN -100 AND 100)
  ),
  -- American odds of 0 is not a price; +/-100 is the tightest real line.
  ADD CONSTRAINT gobl_american_odds_sane CHECK (
    american_odds IS NULL OR (american_odds <= -100 OR american_odds >= 100)
  );

-- ---------------------------------------------------------------------------
-- 3. prop_odds constraints. 'other' is REAL (449 rows) — see header.
-- ---------------------------------------------------------------------------
ALTER TABLE prop_odds
  ADD CONSTRAINT prop_odds_side_valid CHECK (side IN ('over', 'under', 'other')),
  ADD CONSTRAINT prop_odds_american_odds_sane CHECK (
    american_odds IS NULL OR (american_odds <= -100 OR american_odds >= 100)
  );

-- ---------------------------------------------------------------------------
-- 4. pick_history constraints. NULL stays allowed everywhere it occurs today:
--    outcome NULL = ungraded (7,889 rows); score_grade / trust_tier NULL =
--    rows pre-dating those features (331,808 / 327,659).
-- ---------------------------------------------------------------------------
ALTER TABLE pick_history
  ADD CONSTRAINT pick_history_outcome_valid CHECK (outcome IS NULL OR outcome IN ('win', 'loss', 'push')),
  ADD CONSTRAINT pick_history_trust_tier_valid CHECK (trust_tier IS NULL OR trust_tier IN ('weak', 'building', 'proven', 'excluded')),
  ADD CONSTRAINT pick_history_score_grade_valid CHECK (score_grade IS NULL OR score_grade IN ('A+', 'A', 'B+', 'B', 'C+', 'C', 'D')),
  -- Probabilities are probabilities.
  ADD CONSTRAINT pick_history_model_prob_range CHECK (model_prob IS NULL OR (model_prob >= 0 AND model_prob <= 1)),
  ADD CONSTRAINT pick_history_market_prob_range CHECK (market_prob IS NULL OR (market_prob >= 0 AND market_prob <= 1));

COMMIT;

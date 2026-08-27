-- Edge % redesign (docs/edge-redesign-and-prop-score-gameplan-2026-08-27.md):
-- market_prob/edge now compare a sharp reference against the bettable
-- book, not the model against one book. edge_source records which real
-- reference actually produced the edge for this row — a named sharp
-- book (pinnacle/circa/novig/kalshi) or 'consensus' (Tier 2, median
-- across available books) — so it's visible after the fact which tier
-- fired, not just the resulting number.
ALTER TABLE pick_history ADD COLUMN IF NOT EXISTS edge_source TEXT;

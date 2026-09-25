-- P11 follow-up (D13, exact): the moment the latest confirming poll's PRICE
-- copy represents — fetch time minus the price request's CDN Age (Pinnacle's
-- `/markets/straight`, median 636 s old, measured 2026-09-25). The edge's
-- sharp price time reads it instead of assuming D13's 15-minute bound.
-- Written by the scraper bridge (db.write_scraper_checks); NULL until the
-- bridge runs the new code.
ALTER TABLE scraper_checks ADD COLUMN IF NOT EXISTS price_asof timestamptz;
COMMENT ON COLUMN scraper_checks.price_asof IS 'D13: fetch time minus the price request''s CDN Age for the poll that set last_ok_at (scraper bridge).';

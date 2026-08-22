-- Fix: 20260818201108_initial_schema.sql declared golf_round_scores.ingested_at
-- NOT NULL, but the source SQLite column is genuinely nullable (notnull: 0)
-- and 254 of 272 live rows have NULL there — older rows predate this column
-- and have no real ingestion timestamp to backfill onto them (see the
-- original SQLite migration's own comment, lib/db/client.ts's
-- migrateGolfRoundScoresIngestedAt). Caught by the Phase 1 data migration
-- itself failing on this exact constraint against real data.
ALTER TABLE golf_round_scores ALTER COLUMN ingested_at DROP NOT NULL;

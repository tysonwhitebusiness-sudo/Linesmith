"""The scraper bridge's own state DB (P3 of the odds build, 2026-09-24).

`odds-scraper/data/bridge.db`, a SQLite file kept SEPARATE from the scraper's
`scraper.db`, so the bridge never contends with the scraper's single writer
(which ran at ~75% busy on 2026-09-24). WAL mode. It holds the links from the
scraper's canonical games and prop players to the app's own ids, and the
latest reason each unlinked one was not linked.

`open_state(path)` creates the schema idempotently.
"""
from __future__ import annotations

import sqlite3

DEFAULT_PATH = r"C:\Users\occy3\Documents\odds-scraper\data\bridge.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS game_links (
  game_key        TEXT PRIMARY KEY,          -- scraper canon_games.game_key
  app_sport       TEXT NOT NULL,             -- mlb|nfl|cfb|nba|nhl|soccer_epl|soccer_mls|tennis_atp|tennis_wta
  app_game_id     TEXT NOT NULL,
  reversed        INTEGER NOT NULL,          -- 1 = scraper home is the app's away
  method          TEXT NOT NULL,             -- exact|abbr|contain|words|person
  start_delta_min REAL,                      -- scraper start - app start
  app_start       TEXT,                      -- ISO, from Game.game_date
  linked_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS game_links_app ON game_links(app_sport, app_game_id);
CREATE TABLE IF NOT EXISTS game_link_misses (  -- one row per canon game not linked, latest reason
  game_key TEXT PRIMARY KEY, app_sport TEXT, reason TEXT, detail TEXT, seen_at TEXT);
CREATE TABLE IF NOT EXISTS player_links (
  source        TEXT NOT NULL,
  player_norm   TEXT NOT NULL,               -- scraper prop_markets.player_norm
  app_game_id   TEXT NOT NULL,
  app_sport     TEXT NOT NULL,
  subject_id    TEXT NOT NULL,               -- app athlete id
  subject_name  TEXT NOT NULL,
  team_abbr     TEXT,
  position      TEXT,                        -- roster position (P2 position-dependent labels)
  method        TEXT NOT NULL,               -- exact|last_team
  linked_at     TEXT NOT NULL,
  PRIMARY KEY (source, player_norm, app_game_id)
);
CREATE TABLE IF NOT EXISTS player_link_misses (
  source TEXT, player_norm TEXT, app_game_id TEXT, reason TEXT, seen_at TEXT,
  PRIMARY KEY (source, player_norm, app_game_id));
"""


def open_state(path: str = DEFAULT_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.executescript(SCHEMA)
    conn.commit()
    return conn

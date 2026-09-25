"""The scraper bridge (P6 of the odds build, 2026-09-25): the odds-scraper's
changes -> the app's tables, within about a minute, carrying their own times.

    python scraper_bridge_run.py                       # the long-running bridge
    python scraper_bridge_run.py --once                # one cycle, then exit
    python scraper_bridge_run.py --replay-db X --state-db Y --provider-prefix scraper-test --from-start --until-idle
                                                       # the replay test (P6 "Tests")

Runs on the operator's laptop beside the scraper (scheduled task
`LinesmithScraperBridge`, via `run-scraper-bridge.ps1`). Every CYCLE_S:

  1. brakes: `disk_guard_state.bridge_paused` and `cost_guard_state.brake`.
     Either one stops reading: the rows stay in scraper.db (it keeps 3 days)
     and are sent when both clear. Nothing is dropped.
  2. read new scraper rows since the cursors (scraper.db, read-only), at most
     MAX_OFFERS offers, cut at a snapshot boundary;
  3. map each (src/scraper_bridge.py), hold it for a second reading, forward
     the confirmed changes;
  4. write, in order, each an awaited `db.write_*` of <= BATCH rows;
  5. advance the cursors (bridge.db) only after every write committed; a
     failed write is retried whole the next cycle (the writers are
     log-on-change and upserts, so a retry cannot double anything);
  6. heartbeat: `odds-scraper/data/bridge_status.json` every cycle;
     `job_health_checks.scraper_bridge` and the D25 meters every 5 min;
     the top-200 unmatched summary into `odds_unresolved` once a day.

Every MATCH_EVERY_S, P3's matching runs as its OWN process
(`scraper_match_run.py --horizon-hours 36`, one pooled connection) so its
multi-second SQLite reads never stall a cycle; the links are reloaded when it
finishes. Connections: this process 2 + the matcher 1 = 3, all named
`scraper_bridge*` in pg_stat_activity.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sqlite3
import sys
import time
import traceback
from collections import Counter, defaultdict
from dataclasses import replace
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "src"))
os.environ.setdefault("DB_APPLICATION_NAME", "scraper_bridge")
os.environ.setdefault("DB_POOL_MAX_SIZE", "2")

import db  # noqa: E402
from bridge_state import DEFAULT_PATH as STATE_DB, open_state  # noqa: E402
from odds_checks import opener_sanity  # noqa: E402
from scraper_bridge import (  # noqa: E402
    GameRef, HoldBuffer, Mapped, Offer, PlayerRef, Policy, PropRef, an_open_opener, book_links, choose_main,
    line_id, map_offer, map_split, match_ratings, opener_from_row, opener_key, parse_ts,
    parse_vsin_opener, source_rank,
)
from scraper_match import SCRAPER_TO_APP_SPORT  # noqa: E402

SCRAPER_DATA = r"C:\Users\occy3\Documents\odds-scraper\data"
SCRAPER_DB = os.path.join(SCRAPER_DATA, "scraper.db")
STATUS_PATH = os.path.join(SCRAPER_DATA, "bridge_status.json")
MATCH_LOG = os.path.join(SCRAPER_DATA, "bridge_match.log")
POLICY_PATH = os.path.join(HERE, "scraper_bridge_policy.json")

CYCLE_S = 30
MAX_OFFERS = 200_000
BATCH = 5_000
MATCH_EVERY_S = 300
HEARTBEAT_EVERY_S = 300
REBUILD_MINUTES = 10              # §4: the hold buffer is rebuilt from the last 10 min
LAG_HEALTHY_S = 600
LAG_PRUNE_ALERT_S = 6 * 3600      # the scraper prunes after 3 days; alert long before
EVENT_MISS_TTL_S = 120
SEED_GAMES_PER_CYCLE = 5
SEED_SECONDS_PER_CYCLE = 5.0
SEED_SINCE = "2026-09-22"
TABLES = ("offers", "snapshots", "offer_events", "splits", "reference_data")
RATING_KINDS = {"nfl_power_rating": "nfl", "cfb_power_rating": "cfb", "mlb_power_rating": "mlb",
                "nba_power_rating": "nba", "nhl_power_rating": "nhl"}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def sqlite_ts(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------------------
# The D25 egress meter: bytes received from Supabase, counted at the TLS
# layer. Every byte this process receives from a *.supabase.com host passes
# through asyncio's SSLProtocol.buffer_updated as ciphertext — which is what
# Supabase bills as egress. Measured, not estimated.
# ---------------------------------------------------------------------------
class EgressMeter:
    total = 0
    _installed = False

    @classmethod
    def install(cls) -> None:
        if cls._installed:
            return
        import asyncio.sslproto as sslproto
        original = sslproto.SSLProtocol.buffer_updated

        def buffer_updated(self, nbytes):
            host = getattr(self, "_server_hostname", None) or ""
            if host.endswith("supabase.com") or host.endswith("supabase.co"):
                cls.total += nbytes
            return original(self, nbytes)

        sslproto.SSLProtocol.buffer_updated = buffer_updated
        cls._installed = True


# ---------------------------------------------------------------------------
# Resolving scraper ids to the app's (scraper.db read-only, bridge.db links)
# ---------------------------------------------------------------------------
class Resolver:
    def __init__(self, scraper: sqlite3.Connection, state: sqlite3.Connection):
        self.scraper = scraper
        self.state = state
        self.event_links: dict[tuple[str, str], tuple[str, bool] | None] = {}
        self.event_miss_at: dict[tuple[str, str], float] = {}
        self.canon: dict[str, tuple[str, str]] = {}
        self.links: dict[str, tuple] = {}
        self.players: dict[tuple[str, str, str], PlayerRef] = {}
        self.props: dict[tuple[str, str], tuple[PropRef, str]] = {}
        self.labels: dict[tuple[str, str], str] = {}
        self.book_keys: dict[tuple[str, str], str | None] = {}
        self.scraper.execute("CREATE TEMP TABLE IF NOT EXISTS want (a TEXT, b TEXT)")

    def reload_links(self) -> None:
        self.links = {r[0]: r[1:] for r in self.state.execute(
            "SELECT game_key, app_sport, app_game_id, reversed, app_start, app_home, app_away FROM game_links")}
        self.players = {(r[0], r[1], r[2]): PlayerRef(r[3], r[4], r[5]) for r in self.state.execute(
            "SELECT source, player_norm, app_game_id, subject_id, subject_name, position FROM player_links")}
        # A link may have appeared for an event the bridge had as a miss.
        self.event_miss_at.clear()
        for k in [k for k, v in self.event_links.items() if v is None]:
            del self.event_links[k]

    def _fill(self, pairs: set[tuple[str, str]], sql: str) -> list[tuple]:
        if not pairs:
            return []
        self.scraper.execute("DELETE FROM want")
        self.scraper.executemany("INSERT INTO want VALUES (?, ?)", list(pairs))
        return self.scraper.execute(sql).fetchall()

    def prime_events(self, pairs: set[tuple[str, str]]) -> None:
        t = time.time()
        todo = {p for p in pairs if p not in self.event_links
                or (self.event_links[p] is None and t - self.event_miss_at.get(p, 0) > EVENT_MISS_TTL_S)}
        found = {}
        for src, ext, key, rev, sport, league in self._fill(
                todo, "SELECT l.source, l.external_id, l.game_key, l.reversed, c.sport, c.league_key "
                      "FROM want w JOIN game_links l ON l.source = w.a AND l.external_id = w.b "
                      "LEFT JOIN canon_games c ON c.game_key = l.game_key"):
            found[(src, ext)] = (key, bool(rev))
            self.canon[key] = (sport, league)
        for p in todo:
            self.event_links[p] = found.get(p)
            if p not in found:
                self.event_miss_at[p] = t

    def prime_props(self, pairs: set[tuple[str, str]]) -> None:
        todo = {p for p in pairs if p not in self.props}
        for src, ext, player, pnorm, stat, line, parent in self._fill(
                todo, "SELECT pm.source, pm.external_id, pm.player, pm.player_norm, pm.stat, pm.line, "
                      "pm.parent_external_id FROM prop_markets pm "
                      "JOIN (SELECT max(p.id) AS id FROM want w JOIN prop_markets p INDEXED BY ix_prop_markets_external_id "
                      "      ON p.external_id = w.b AND p.source = w.a GROUP BY p.source, p.external_id) m "
                      "ON pm.id = m.id"):
            self.props[(src, ext)] = (PropRef(player, pnorm, stat, line), parent)

    def label(self, source: str, ext: str) -> str | None:
        k = (source, ext)
        if k not in self.labels:
            r = self.scraper.execute("SELECT away_name, home_name, start FROM events INDEXED BY ix_events_external_id WHERE external_id = ? AND source = ? "
                                     "ORDER BY id DESC LIMIT 1", (ext, source)).fetchone()
            self.labels[k] = f"{r[0]} @ {r[1]} {r[2] or ''}".strip() if r else None
        return self.labels[k]

    def game(self, source: str, ext: str) -> tuple[GameRef | None, str | None]:
        link = self.event_links.get((source, ext))
        if link is None:
            return None, "unmatched-game"
        key, srev = link
        bl = self.links.get(key)
        if bl is None:
            sport, league = self.canon.get(key, (None, None))
            return None, "unmatched-game" if (sport, league) in SCRAPER_TO_APP_SPORT else "no-app-sport"
        app_sport, app_game_id, brev, app_start = bl[0], bl[1], bl[2], bl[3]
        return GameRef(app_sport, app_game_id, bool(srev) != bool(brev), parse_ts(app_start)), None

    def game_key_of(self, source: str, ext: str) -> str | None:
        link = self.event_links.get((source, ext))
        return link[0] if link else None

    def prop(self, source: str, ext: str | None):
        if not ext:
            return None, None
        hit = self.props.get((source, ext))
        return (hit[0], hit[1]) if hit else (None, None)

    def player(self, source: str, prop: PropRef | None, app_game_id: str) -> PlayerRef | None:
        if prop is None or not prop.player_norm:
            return None
        return self.players.get((source, prop.player_norm, app_game_id))

    def book_key(self, source: str, event_ext: str, market: str, book: str) -> str | None:
        """offer_events carry the RAW book name; the canonical book_key is on
        the offers (ix_offers_event_market_book makes this an index lookup)."""
        k = (source, book)
        if k not in self.book_keys:
            r = self.scraper.execute("SELECT book_key FROM offers INDEXED BY ix_offers_event_market_book "
                                     "WHERE event_external_id = ? AND market = ? AND book = ? "
                                     "ORDER BY id DESC LIMIT 1", (event_ext, market, book)).fetchone()
            if r is None:
                return None
            self.book_keys[k] = r[0]
        return self.book_keys[k]


# ---------------------------------------------------------------------------
# The bridge
# ---------------------------------------------------------------------------
class Bridge:
    def __init__(self, args):
        self.args = args
        self.prefix = args.provider_prefix
        self.test = self.prefix != "scraper"
        self.book_prefix = "scrapertest" if self.test else ""
        self.split_prefix = f"{self.prefix}:" if self.test else ""
        self.policy = Policy.load(POLICY_PATH)
        self.scraper = sqlite3.connect(f"file:{args.scraper_db}?mode=ro", uri=True, timeout=60)
        self.state = open_state(args.state_db)
        self.res = Resolver(self.scraper, self.state)
        self.res.reload_links()
        self.hold = HoldBuffer()
        self.cursor: dict[str, int] = {}
        self.read_pos: dict[str, int] = {}
        self.latest_ok: dict[tuple[str, str], tuple[int, datetime]] = {}
        self.endpoint_games: dict[tuple[str, str], set[str]] = defaultdict(set)
        self.book_state: dict[tuple, dict] = defaultdict(dict)   # game group -> {(side, point): american}
        self.main_of: dict[tuple, object] = {}
        self.fwd_game_rows: dict[tuple, object] = {}             # game key -> last forwarded GameLineInput
        self.group_keys: dict[tuple, set] = defaultdict(set)
        self.unmatched_keys: set[tuple[str, str]] = set()
        self.opened: set[tuple] = set()
        self.opener_peers: dict[tuple, dict] = defaultdict(dict)
        self.ref_latest: dict[tuple[str, str], tuple[dict, datetime]] = {}
        self.ref_sent: dict[tuple, str] = {}
        self.ref_dirty = True
        self.outbox: list | None = None
        self.pending_cursor: dict[str, int] | None = None
        self.unmatched_counter: Counter = Counter()
        self.unresolved_day = None
        self.stats = Counter()
        self.skips = Counter()
        self.last_heartbeat = 0.0
        self.last_match = 0.0
        self.match_proc = None
        self.timing_proc = None
        self.newest_bridged: datetime | None = None
        self.cycle_ok = True
        self.last_error: str | None = None
        self.egress_reported = 0
        self.rows_reported = 0
        self.rows_written = 0
        self.paused_reason: str | None = None
        self.started = now_utc()
        self.last_prune = time.time()
        self.write_seconds: dict[str, float] = {}

    # --- cursors -------------------------------------------------------------
    def load_cursors(self) -> None:
        saved = {n: v for n, v in self.state.execute("SELECT name, last_id FROM cursors") if n in TABLES}
        q = self.scraper.execute
        if self.args.from_start:
            self.cursor = {t: 0 for t in TABLES}
            self.read_pos = dict(self.cursor)
            return
        max_snap = q("SELECT max(id) FROM snapshots").fetchone()[0] or 0
        since = sqlite_ts(now_utc() - timedelta(minutes=REBUILD_MINUTES))
        s0 = q("SELECT min(id) FROM snapshots WHERE id > ? AND fetched_at >= ?", (max_snap - 50_000, since)).fetchone()[0]
        s0 = (s0 or max_snap + 1) - 1          # the last snapshot BEFORE the rebuild window
        # Through the snapshot index: a bare min(id) ... WHERE snapshot_id > ?
        # makes SQLite walk all ~39M offers in id order (measured: minutes).
        first = q("SELECT id FROM offers INDEXED BY ix_offers_snapshot_id WHERE snapshot_id > ? "
                  "ORDER BY snapshot_id, id LIMIT 1", (s0,)).fetchone()
        o0 = (first[0] if first else (q("SELECT max(id) FROM offers").fetchone()[0] or 0) + 1) - 1
        rebuild = {"offers": o0, "snapshots": s0}
        for t in TABLES:
            if t in saved:
                # Resume at the saved cursor, or earlier to rebuild the hold buffer (§4).
                self.cursor[t] = min(saved[t], rebuild.get(t, saved[t]))
            elif t in rebuild:
                self.cursor[t] = rebuild[t]
            else:
                # First start: begin at the rebuild window's first snapshot.
                self.cursor[t] = (q(f"SELECT min(id) FROM {t} WHERE snapshot_id > ?", (s0,)).fetchone()[0] or 1) - 1 \
                    if t != "reference_data" else (q("SELECT max(id) FROM reference_data").fetchone()[0] or 0)
        self.read_pos = dict(self.cursor)
        print(f"[bridge] cursors {self.cursor} (saved {saved})", flush=True)

    def save_cursors(self, pos: dict[str, int]) -> None:
        stamp = now_utc().isoformat()
        self.state.executemany("INSERT OR REPLACE INTO cursors (name, last_id, updated_at) VALUES (?, ?, ?)",
                               [(t, int(v), stamp) for t, v in pos.items()])
        self.state.commit()
        self.cursor = dict(pos)

    # --- reading -------------------------------------------------------------
    def read(self) -> dict:
        q = self.scraper.execute
        s_max = q("SELECT max(id) FROM snapshots").fetchone()[0] or 0
        rows = q("SELECT o.id, o.snapshot_id, o.source, s.endpoint, o.event_external_id, o.prop_market_external_id, "
                 "o.market, o.side, o.line, o.book, o.book_key, o.price, o.price_alt, o.source_ts_ms, o.depth, "
                 "s.fetched_at, s.cache_age_s FROM offers o JOIN snapshots s ON s.id = o.snapshot_id "
                 "WHERE o.id > ? AND o.snapshot_id <= ? ORDER BY o.id LIMIT ?",
                 (self.read_pos["offers"], s_max, self.args.max_offers)).fetchall()
        bound = s_max
        if len(rows) == self.args.max_offers:
            last_snap = rows[-1][1]
            cut = [r for r in rows if r[1] < last_snap]
            if cut:                          # stop at the last whole snapshot
                rows, bound = cut, last_snap - 1
            else:
                bound = last_snap
        offers = []
        for r in rows:
            depth = None
            if r[14] and r[14] != "null":
                try:
                    depth = json.loads(r[14])
                except ValueError:
                    depth = None
            offers.append(Offer(id=r[0], snapshot_id=r[1], source=r[2], endpoint=r[3], event_external_id=r[4],
                                prop_market_external_id=r[5], market=r[6], side=r[7], line=r[8], book=r[9],
                                book_key=r[10], price=r[11], price_alt=r[12], source_ts_ms=r[13], depth=depth,
                                fetched_at=parse_ts(r[15]), cache_age_s=r[16]))
        snaps = q("SELECT id, source, endpoint, fetched_at, status FROM snapshots WHERE id > ? AND id <= ? ORDER BY id",
                  (self.read_pos["snapshots"], bound)).fetchall()

        def by_snapshot(table, cols):
            out = q(f"SELECT {cols} FROM {table} WHERE id > ? ORDER BY id LIMIT 200000",
                    (self.read_pos[table],)).fetchall()
            keep = []
            for row in out:                  # ids follow snapshots: stop at the first beyond the bound
                if row[1] is not None and row[1] > bound:
                    break
                keep.append(row)
            return keep

        events = by_snapshot("offer_events", "id, snapshot_id, at, source, endpoint, event, reason, event_external_id, "
                                             "prop_market_external_id, market, side, book, line, price")
        splits = by_snapshot("splits", "id, snapshot_id, at, source, kind, book, event_external_id, "
                                       "prop_market_external_id, market, side, line, pct_bets, pct_money, count, "
                                       "count_total")
        refs = by_snapshot("reference_data", "id, snapshot_id, at, source, kind, subject, data")
        pos = dict(self.read_pos)
        if offers:
            pos["offers"] = offers[-1].id
        if snaps:
            pos["snapshots"] = snaps[-1][0]
        for name, got in (("offer_events", events), ("splits", splits), ("reference_data", refs)):
            if got:
                pos[name] = got[-1][0]
        return {"offers": offers, "snaps": snaps, "events": events, "splits": splits, "refs": refs, "pos": pos,
                "bound": bound}

    # --- one cycle -----------------------------------------------------------
    async def cycle(self) -> None:
        if self.outbox:
            await self.flush()
            if self.outbox:
                return
        batch = self.read()
        offers, snaps, events = batch["offers"], batch["snaps"], batch["events"]
        if self.args.cycle_log:
            with open(self.args.cycle_log, "a", encoding="utf-8") as fh:
                fh.write(json.dumps({"from": self.read_pos, "to": batch["pos"], "bound": batch["bound"]}) + "\n")

        self.res.prime_events({(o.source, o.event_external_id) for o in offers}
                              | {(e[3], e[7]) for e in events if e[7]}
                              | {(s[3], s[6]) for s in batch["splits"] if s[6]}
                              | {("comparenbet", r[5]) for r in batch["refs"] if r[4] == "cnb_event"}
                              | {("vsin", json.loads(r[6] or "{}").get("event_external_id") or "")
                                 for r in batch["refs"] if r[4] == "vsin_opener"})
        self.res.prime_props({(o.source, o.prop_market_external_id) for o in offers if o.prop_market_external_id}
                             | {(e[3], e[8]) for e in events if e[8]}
                             | {(s[3], s[7]) for s in batch["splits"] if s[7]})

        openers: list = []
        for o in sorted(offers, key=lambda x: (source_rank(x.source), x.id)):
            try:
                self._take(o, openers)
            except Exception as e:                   # noqa: BLE001 — one bad row never stops the bridge
                self.skips[f"error:{type(e).__name__}"] += 1
                if self.skips[f"error:{type(e).__name__}"] <= 3:
                    print(f"[bridge] offer {o.id} ({o.source}) skipped: {type(e).__name__}: {e}", flush=True)
        await self._after_offers(batch, events, snaps, openers)

    def _take(self, o: Offer, openers: list) -> None:
        """Map one offer and hand it to the hold buffer (or count why not)."""
        game, miss = self.res.game(o.source, o.event_external_id)
        if o.book_key == "anopen" and game is not None:
            op = an_open_opener(o, game, self.book_prefix)
            if op is not None and opener_key(op) not in self.opened:
                openers.append(op)
                self.opened.add(opener_key(op))
            return
        prop, _parent = self.res.prop(o.source, o.prop_market_external_id)
        player = self.res.player(o.source, prop, game.app_game_id) if game else None
        label = self.res.label(o.source, o.event_external_id) if game is None or (o.prop_market_external_id and
                                                                                 player is None) else None
        m = map_offer(o, game=game, game_miss=miss, prop=prop, player=player, policy=self.policy,
                      event_label=label, provider_prefix=self.prefix)
        if m.kind == "skip":
            self.skips[m.reason] += 1
            return
        m.row._sk = (f"{self.prefix}:{o.source}", m.scraper_key)   # read by the unmatched-delete hook
        if m.kind == "unmatched":
            self.unmatched_counter[(m.row.reason, m.row.event or "", m.row.player or "", m.row.market,
                                    m.row.book)] += 1
        else:
            self.endpoint_games[(o.source, o.endpoint)].add(m.row.game_id)
        if m.kind == "game":
            r = m.row
            g = (r.sport, r.game_id, r.period, r.market, r.bookmaker, r.source)
            self.book_state[g][(r.side, r.point)] = r.american_odds
            self.group_keys[g].add(m.key)
        self.hold.offer(m, o.snapshot_id, (o.source, o.endpoint), o.fetched_at)

    async def _after_offers(self, batch, events, snaps, openers: list) -> None:
        """Pulls, confirmation, and the cycle's writes."""
        # Pulls (B3): drop a pending change; record the pull unless the price
        # never reached the app (pending only).
        prop_pulls, game_pulls = [], []
        for ev_row in events:
            try:
                self._pull(ev_row, prop_pulls, game_pulls)
            except Exception as e:                   # noqa: BLE001 — one bad row never stops the bridge
                self.skips[f"pull-error:{type(e).__name__}"] += 1

        await self._finish(batch, snaps, openers, prop_pulls, game_pulls)

    def _pull(self, ev_row, prop_pulls: list, game_pulls: list) -> None:
        (_id, snap_id, at, source, endpoint, event, reason, ev_ext, pm_ext, market, side, book, line, price) = ev_row
        if event != "pulled" or not ev_ext:
            return
        bk = self.res.book_key(source, ev_ext, market, book) if book else None
        o = Offer(id=0, snapshot_id=snap_id or 0, source=source, endpoint=endpoint or "", event_external_id=ev_ext,
                  prop_market_external_id=pm_ext, market=market or "", side=side, line=line, book=book,
                  book_key=bk, price=price if price else 100.0, price_alt=None, source_ts_ms=None, depth=None,
                  fetched_at=parse_ts(at))
        game, miss = self.res.game(source, ev_ext)
        prop, _ = self.res.prop(source, pm_ext)
        player = self.res.player(source, prop, game.app_game_id) if game else None
        m = map_offer(o, game=game, game_miss=miss, prop=prop, player=player, policy=self.policy,
                      provider_prefix=self.prefix)
        if m.kind not in ("prop", "game"):
            return
        pending_only = m.key in self.hold.pending and m.key not in self.hold.forwarded
        self.hold.pull(m.key)
        r = m.row
        if m.kind == "game":
            g = (r.sport, r.game_id, r.period, r.market, r.bookmaker, r.source)
            self.book_state[g].pop((r.side, r.point), None)
            self.fwd_game_rows.pop(m.key, None)
        if pending_only:
            return
        if m.kind == "prop":
            prop_pulls.append(db.PropPullInput(provider_id=r.provider_id, game_id=r.game_id, subject_id=r.subject_id,
                                               market_key=r.market_key, line=r.line, side=r.side,
                                               bookmaker=r.bookmaker, pulled_at=o.fetched_at, reason=reason or "line"))
        else:
            game_pulls.append(db.GameLinePullInput(sport=r.sport, game_id=r.game_id, period=r.period,
                                                   market=r.market, side=r.side, point=r.point,
                                                   bookmaker=r.bookmaker, source=r.source, pulled_at=o.fetched_at,
                                                   reason=reason or "line"))

    async def _finish(self, batch, snaps, openers: list, prop_pulls: list, game_pulls: list) -> None:
        """Confirmation, the forwarded rows, and the cycle's writes."""
        # Confirmation: the latest ok/unchanged snapshot per (source, endpoint).
        checks = []
        for sid, source, endpoint, fetched, status in snaps:
            if status in ("ok", "unchanged"):
                at = parse_ts(fetched)
                self.latest_ok[(source, endpoint)] = (sid, at)
                for gid in self.endpoint_games.get((source, endpoint), ()):
                    checks.append((f"{self.prefix}:{source}", gid, at))
        if snaps:
            self.newest_bridged = parse_ts(snaps[-1][3])
        confirmed = self.hold.confirm(self.latest_ok)

        prop_rows, game_rows, unmatched_rows, exchanges = [], [], [], []
        for m in confirmed:
            if m.kind == "prop":
                prop_rows.append(m.row)
            elif m.kind == "game":
                game_rows.extend(self._with_main(m))
            elif m.kind == "unmatched":
                unmatched_rows.append(m.row)
            if m.exchange is not None:
                exchanges.append(m.exchange)
            op = opener_from_row(m)
            if op is not None and self.book_prefix:
                op.bookmaker = self.book_prefix + op.bookmaker
            if op is not None and opener_key(op) not in self.opened:
                openers.append(op)
                self.opened.add(opener_key(op))

        splits = self._splits(batch["splits"])
        refs = self._references(batch["refs"], openers)
        openers.extend(self._seed_openers())
        self._check_openers(openers)

        self.outbox = self._plan(prop_rows, game_rows, exchanges, prop_pulls, game_pulls, splits, openers, refs,
                                 unmatched_rows, checks)
        self.pending_cursor = batch["pos"]
        self.read_pos = dict(batch["pos"])
        self.stats["offers_read"] += len(batch["offers"])
        self.stats["confirmed"] += len(confirmed)
        await self.flush()

    # --- the main line ---------------------------------------------------------
    def _with_main(self, m: Mapped) -> list:
        """The row, with is_main decided (§3), plus any earlier-forwarded row of
        the same book group whose main flag the decision flips."""
        r = m.row
        g = (r.sport, r.game_id, r.period, r.market, r.bookmaker, r.source)
        self.fwd_game_rows[m.key] = r
        if not m.needs_main:
            return [r]
        main = choose_main(self.book_state[g], r.market)
        out = []
        for k in self.group_keys[g]:
            fr = self.fwd_game_rows.get(k)
            if fr is None:
                continue
            want = line_id(fr.market, fr.side, fr.point) == main
            if fr is r:
                r.is_main = want
                out.append(r)
            elif fr.is_main != want:
                nr = replace(fr, is_main=want)
                self.fwd_game_rows[k] = nr
                out.append(nr)
        self.main_of[g] = main
        return out or [r]

    # --- splits, references, openers -------------------------------------------
    def _splits(self, rows) -> list:
        out = []
        for (_id, _sid, at, source, kind, book, ev, pm, market, side, line, pb, pmn, cnt, tot) in rows:
            game, _miss = self.res.game(source, ev) if ev else (None, None)
            if game is None:
                self.skips["split-unlinked"] += 1
                continue
            prop, _ = self.res.prop(source, pm)
            player = self.res.player(source, prop, game.app_game_id)
            s = map_split({"at": at, "source": source, "kind": kind, "book": book, "prop_market_external_id": pm,
                           "market": market, "side": side, "line": line, "pct_bets": pb, "pct_money": pmn,
                           "count": cnt, "count_total": tot}, game, prop, player, self.split_prefix)
            if s is None:
                self.skips["split-unmapped"] += 1
            else:
                out.append(s)
        return out

    def _references(self, rows, openers: list) -> list:
        out = []
        src = f"{self.prefix}:" if self.test else ""
        for (_id, _sid, at, source, kind, subject, data) in rows:
            try:
                d = json.loads(data) if data else {}
            except ValueError:
                continue
            ts = parse_ts(at)
            if kind == "vsin_opener":
                game, _ = self.res.game("vsin", d.get("event_external_id") or "")
                if game is not None:
                    openers.extend(o for o in parse_vsin_opener(d, game, ts, self.book_prefix))
            elif kind == "cnb_event":
                game, _ = self.res.game("comparenbet", subject)
                if game is not None:
                    for r in book_links(d, game, ts, src + "comparenbet"):
                        k = (r.game_id, r.kind, r.subject)
                        h = json.dumps(r.data, sort_keys=True)
                        if self.ref_sent.get(k) != h:
                            self.ref_sent[k] = h
                            out.append(r)
            elif kind in RATING_KINDS:
                self.ref_latest[(kind, subject)] = (d, ts)
                self.ref_dirty = True
        if self.ref_dirty:
            out.extend(self._ratings(src))
            self.ref_dirty = False
        return out

    def _ratings(self, src: str) -> list:
        """Power ratings onto each linked game's teams, written on change (§8b)."""
        out = []
        by_sport: dict[str, list] = defaultdict(list)
        for key, (app_sport, app_game_id, _rev, app_start, home, away) in self.res.links.items():
            if home and away:
                by_sport[app_sport].append((app_game_id, home, away))
        for kind, sport in RATING_KINDS.items():
            subjects = [s for (k, s) in self.ref_latest if k == kind]
            games = by_sport.get(sport, [])
            if not subjects or not games:
                continue
            teams = sorted({t for _, h, a in games for t in (h, a)})
            matched = match_ratings(subjects, teams, sport)
            for gid, home, away in games:
                for team in (home, away):
                    sub = matched.get(team)
                    if sub is None:
                        continue
                    d, ts = self.ref_latest[(kind, sub)]
                    k = (gid, "power_rating", team)
                    h = json.dumps(d, sort_keys=True)
                    if self.ref_sent.get(k) != h:
                        self.ref_sent[k] = h
                        out.append(db.GameReferenceInput(sport=sport, game_id=gid, source=src + "vsin",
                                                         kind="power_rating", subject=team, data=d, observed_at=ts))
        return out

    def load_references(self) -> list:
        """On start: the latest row of every rating and every vsin_opener (small:
        ~2k rows), so a restart does not wait for the next change."""
        openers = []
        for kind in RATING_KINDS:
            for subject, data, at in self.scraper.execute(
                    "SELECT subject, data, max(at) FROM reference_data WHERE kind = ? GROUP BY subject", (kind,)):
                try:
                    self.ref_latest[(kind, subject)] = (json.loads(data), parse_ts(at))
                except (ValueError, TypeError):
                    pass
        rows = self.scraper.execute("SELECT id, snapshot_id, at, source, kind, subject, data FROM reference_data "
                                    "WHERE kind = 'vsin_opener' ORDER BY id").fetchall()
        self.res.prime_events({("vsin", json.loads(r[6] or "{}").get("event_external_id") or "") for r in rows})
        refs = self._references(rows, openers)
        self.ref_dirty = True
        return openers + refs

    def _seed_openers(self) -> list:
        """§7 seed: for linked games not started, the earliest main line per
        (book, market, side) from scraper history since SEED_SINCE — one query
        per game, a few games per cycle, then never again (bridge.db
        `opener_seeded`)."""
        if self.args.no_seed:
            return []
        done = {r[0] for r in self.state.execute("SELECT game_key FROM opener_seeded")}
        now = now_utc()
        todo = [(k, v) for k, v in self.res.links.items()
                if k not in done and v[3] and (parse_ts(v[3]) or now) > now][:SEED_GAMES_PER_CYCLE]
        out = []
        t_seed = time.time()
        for key, (app_sport, app_game_id, brev, app_start, _h, _a) in todo:
            if time.time() - t_seed > SEED_SECONDS_PER_CYCLE:
                break                      # the rest next cycle: seeding never holds a cycle up
            # Each source event's EARLIEST rows only (bounded): a comparenbet event
            # holds hundreds of thousands of offer rows, and a book's opener is in
            # its first polls. Game-line rows only, filtered inside SQLite (5,000 an event).
            rows = []
            for src, ext in self.scraper.execute("SELECT source, external_id FROM game_links WHERE game_key = ?",
                                                 (key,)).fetchall():
                rows += self.scraper.execute(
                    "SELECT o.id, o.snapshot_id, o.source, s.endpoint, o.event_external_id, o.market, o.side, o.line, "
                    "o.book, o.book_key, o.price, o.source_ts_ms, o.depth, s.fetched_at, s.cache_age_s "
                    "FROM (SELECT * FROM offers INDEXED BY ix_offers_event_external_id WHERE event_external_id = ? "
                    "AND prop_market_external_id IS NULL ORDER BY id LIMIT 5000) o "
                    "JOIN snapshots s ON s.id = o.snapshot_id WHERE o.source = ? AND s.fetched_at >= ?",
                    (ext, src, SEED_SINCE)).fetchall()
            rows.sort(key=lambda r: r[0])
            self.res.prime_events({(r[2], r[4]) for r in rows})
            first: dict[tuple, list] = {}
            for r in rows:
                depth = None
                if r[12] and r[12] != "null":
                    try:
                        depth = json.loads(r[12])
                    except ValueError:
                        pass
                if isinstance(depth, dict) and depth.get("alt") is True:
                    continue
                o = Offer(id=r[0], snapshot_id=r[1], source=r[2], endpoint=r[3], event_external_id=r[4],
                          prop_market_external_id=None, market=r[5], side=r[6], line=r[7], book=r[8], book_key=r[9],
                          price=r[10], price_alt=None, source_ts_ms=r[11], depth=depth, fetched_at=parse_ts(r[13]),
                          cache_age_s=r[14])
                game, _ = self.res.game(o.source, o.event_external_id)
                if game is None:
                    continue
                m = map_offer(o, game=game, game_miss=None, prop=None, player=None, policy=self.policy,
                              provider_prefix=self.prefix)
                if m.kind != "game":
                    continue
                gr = m.row
                grp = (gr.period, gr.market, gr.bookmaker, gr.source)
                # the first snapshot this book quoted the market in
                if grp not in first:
                    first[grp] = [o.snapshot_id, {}]
                if first[grp][0] == o.snapshot_id:
                    first[grp][1][(gr.side, gr.point)] = gr
            n = 0
            for (period, market, book, _src), (_sid, lines) in first.items():
                main = choose_main({k: v.american_odds for k, v in lines.items()}, market)
                for (side, point), gr in lines.items():
                    if line_id(market, side, point) != main:
                        continue
                    gr.is_main = True
                    op = opener_from_row(Mapped("game", row=gr, opener_ok=True, sport=gr.sport))
                    if op is None:
                        continue
                    if self.book_prefix:
                        op.bookmaker = self.book_prefix + op.bookmaker
                    if opener_key(op) not in self.opened:
                        self.opened.add(opener_key(op))
                        out.append(op)
                        n += 1
            self.state.execute("INSERT OR REPLACE INTO opener_seeded VALUES (?, ?, ?, ?)",
                               (key, app_game_id, n, now.isoformat()))
            self.stats["openers_seeded"] += n
        self.state.commit()
        return out

    def _check_openers(self, openers: list) -> None:
        """odds_checks.opener_sanity against the other books' openers held for
        the same game, period and market (and subject)."""
        for op in openers:
            g = (op.game_id, op.subject_id or "", op.period or "fg", op.market)
            peers = [dict(kind=p.kind, sport=p.sport, market=p.market, side=p.side, point=p.point,
                          american_odds=p.american_odds)
                     for (b, _side), p in self.opener_peers[g].items() if b != op.bookmaker and not p.check_flag]
            flag, reason = opener_sanity(dict(kind=op.kind, sport=op.sport or "", market=op.market, side=op.side,
                                              point=op.point, american_odds=op.american_odds), peers)
            op.check_flag, op.check_reason = flag, reason
            self.opener_peers[g].setdefault((op.bookmaker, op.side), op)
            if flag:
                self.stats["openers_flagged"] += 1

    # --- writing -----------------------------------------------------------------
    def _unmatched_hook(self):
        async def hook(conn, rows):
            keys = [k for k in (getattr(r, "_sk", None) for r in rows) if k is not None and k in self.unmatched_keys]
            if keys:
                n = await db.delete_scraper_unmatched(conn, keys)
                self.unmatched_keys.difference_update(keys)
                self.stats["unmatched_resolved"] += n
        return hook

    def _plan(self, prop_rows, game_rows, exchanges, prop_pulls, game_pulls, splits, openers, refs, unmatched,
              checks) -> list:
        def chunks(name, fn, rows, **kw):
            return [(name, fn, rows[i:i + BATCH], kw) for i in range(0, len(rows), BATCH)]
        hook = self._unmatched_hook()
        # One pull per key per cycle: two endpoints can drop the same price in
        # one read, and the writer would record it twice.
        prop_pulls = list({(p.provider_id, p.game_id, p.subject_id, p.market_key, p.line, p.side, p.bookmaker): p
                           for p in reversed(prop_pulls)}.values())
        game_pulls = list({(p.sport, p.game_id, p.period, p.market, p.side, p.point, p.bookmaker, p.source): p
                           for p in reversed(game_pulls)}.values())
        plan = []
        plan += chunks("prop_odds", db.write_prop_odds, prop_rows, in_tx=hook)
        plan += chunks("game_lines", db.write_game_lines, game_rows, in_tx=hook)
        plan += chunks("exchange_books", db.write_exchange_books, exchanges)
        plan += chunks("prop_pulls", db.write_prop_pulls, prop_pulls)
        plan += chunks("game_line_pulls", db.write_game_line_pulls, game_pulls)
        plan += chunks("splits", db.write_splits, splits)
        plan += chunks("openers", db.write_openers, openers)
        plan += chunks("game_reference", db.write_game_reference, refs)
        plan += chunks("unmatched", db.write_scraper_unmatched, unmatched)
        plan += chunks("scraper_checks", db.write_scraper_checks, checks)
        return plan

    async def flush(self) -> None:
        while self.outbox:
            name, fn, rows, kw = self.outbox[0]
            t = time.time()
            try:
                await fn(rows, **kw)
                self.write_seconds[name] = round(self.write_seconds.get(name, 0.0) + time.time() - t, 1)
                if time.time() - t > 10:
                    print(f"[bridge] slow write: {name} {len(rows)} rows in {time.time() - t:.1f}s", flush=True)
            except Exception as e:                      # noqa: BLE001 — retried whole next cycle
                self.cycle_ok = False
                self.last_error = f"{name}: {type(e).__name__}: {e}"[:500]
                print(f"[bridge] write {name} ({len(rows)} rows) failed, will retry: {self.last_error}", flush=True)
                return
            if name == "unmatched":
                self.unmatched_keys.update((r.source, r.scraper_key) for r in rows)
            self.stats[f"rows_{name}"] += len(rows)
            self.rows_written += len(rows)
            self.outbox.pop(0)
        self.outbox = None
        if self.pending_cursor is not None:
            self.save_cursors(self.pending_cursor)
            self.pending_cursor = None
        self.cycle_ok = True
        self.last_error = None

    # --- matching subprocess -----------------------------------------------------
    async def maybe_timing(self) -> None:
        """P7: `scraper_timing.py --days 3 --write` once a day after 05:00 local,
        as the bridge's own scheduled work (P7 §3), never beside the matcher:
        bridge 2 + one helper 1 = the 3-connection budget. The day it last ran
        is kept in bridge.db (cursors row 'timing_day')."""
        if self.args.no_match:
            return
        if self.timing_proc is not None:
            if self.timing_proc.returncode is None:
                return
            self.stats["timing_runs"] += 1
            if self.timing_proc.returncode != 0:
                self.stats["timing_failures"] += 1
            self.timing_proc = None
        local = datetime.now()
        day = int(local.strftime("%Y%m%d"))
        done = self.state.execute("SELECT last_id FROM cursors WHERE name = 'timing_day'").fetchone()
        if local.hour < 5 or (done and done[0] >= day) or self.match_proc is not None:
            return
        self.state.execute("INSERT OR REPLACE INTO cursors (name, last_id, updated_at) VALUES ('timing_day', ?, ?)",
                           (day, now_utc().isoformat()))
        self.state.commit()
        env = dict(os.environ, DB_POOL_MAX_SIZE="1", DB_APPLICATION_NAME="scraper_bridge_timing")
        log = open(os.path.join(SCRAPER_DATA, "source_timing.log"), "a", encoding="utf-8")
        log.write(f"---- {now_utc().isoformat()}\n")
        log.flush()
        self.timing_proc = await asyncio.create_subprocess_exec(
            sys.executable, os.path.join(HERE, "scraper_timing.py"), "--days", "3", "--write",
            "--scraper-db", self.args.scraper_db, "--state-db", self.args.state_db,
            stdout=log, stderr=log, env=env, cwd=HERE)

    async def maybe_match(self) -> None:
        if self.args.no_match:
            return
        if self.timing_proc is not None and self.timing_proc.returncode is None:
            return
        if self.match_proc is not None:
            if self.match_proc.returncode is None:
                return
            rc = self.match_proc.returncode
            self.match_proc = None
            self.stats["match_runs"] += 1
            if rc != 0:
                self.stats["match_failures"] += 1
            self.res.reload_links()
            self.ref_dirty = True
        if time.time() - self.last_match < MATCH_EVERY_S:
            return
        self.last_match = time.time()
        env = dict(os.environ, DB_POOL_MAX_SIZE="1", DB_APPLICATION_NAME="scraper_bridge_match")
        log = open(MATCH_LOG, "a", encoding="utf-8")
        log.write(f"---- {now_utc().isoformat()}\n")
        log.flush()
        self.match_proc = await asyncio.create_subprocess_exec(
            sys.executable, os.path.join(HERE, "scraper_match_run.py"), "--horizon-hours", "36", "--report",
            "--scraper-db", self.args.scraper_db, "--state-db", self.args.state_db,
            stdout=log, stderr=log, env=env, cwd=HERE)

    # --- heartbeat -----------------------------------------------------------------
    def lag_s(self) -> float | None:
        return None if self.newest_bridged is None else round((now_utc() - self.newest_bridged).total_seconds(), 1)

    def status(self) -> dict:
        lag = self.lag_s()
        return {
            "last_cycle_at": now_utc().isoformat(), "started_at": self.started.isoformat(), "pid": os.getpid(),
            "provider_prefix": self.prefix, "lag_s": lag, "cycle_ok": self.cycle_ok, "last_error": self.last_error,
            "paused": self.paused_reason, "cursors": self.cursor, "held": len(self.hold.pending),
            "hold_s_median": self.hold.median_hold_s(), "flaps": self.hold.flaps,
            "forwarded": {k[5:]: v for k, v in self.stats.items() if k.startswith("rows_")},
            "stats": {k: v for k, v in self.stats.items() if not k.startswith("rows_")},
            "skipped": dict(self.skips.most_common(20)), "outbox": len(self.outbox or []),
            "egress_bytes": EgressMeter.total, "unmatched_keys": len(self.unmatched_keys),
            "db_pool_size": db._pool.get_size() if db._pool is not None else 0,
            "write_seconds": self.write_seconds,
            "prune_risk": bool(lag and lag > LAG_PRUNE_ALERT_S),
        }

    def write_status(self) -> dict:
        s = self.status()
        if not self.args.no_heartbeat:
            tmp = STATUS_PATH + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(s, fh, indent=1, default=str)
            os.replace(tmp, STATUS_PATH)
        return s

    async def heartbeat(self, force: bool = False) -> None:
        s = self.write_status()
        if self.args.no_heartbeat or (not force and time.time() - self.last_heartbeat < HEARTBEAT_EVERY_S):
            return
        self.last_heartbeat = time.time()
        lag = s["lag_s"]
        healthy = lag is not None and lag < LAG_HEALTHY_S and s["cycle_ok"]
        bits = [f"lag {lag}s" if lag is not None else "no snapshot bridged yet",
                f"held {s['held']}", f"hold median {s['hold_s_median']}s"]
        if s["paused"]:
            bits.insert(0, f"PAUSED: {s['paused']}")
        if s["last_error"]:
            bits.append(f"write failing: {s['last_error'][:120]}")
        if s["prune_risk"]:
            bits.append("behind by > 6 h: the scraper prunes at 3 days")
        await db.write_health_check_results([{"name": "scraper_bridge", "healthy": healthy,
                                              "status": "; ".join(bits), "raw": s}])
        import cost_guard
        egress, rows = EgressMeter.total - self.egress_reported, self.rows_written - self.rows_reported
        await cost_guard.add_meter("bridge.egress_bytes", egress)
        await cost_guard.add_meter("bridge.rows_written", rows)
        self.egress_reported += egress
        self.rows_reported += rows
        await self.daily_unresolved()

    async def daily_unresolved(self) -> None:
        """Once a day: the top 200 unmatched (reason, event, player, market,
        book) into odds_unresolved, provider 'scraper' (§2 step 7)."""
        today = now_utc().date()
        if self.unresolved_day == today or not self.unmatched_counter or now_utc() - self.started < timedelta(hours=1):
            return
        from entity_resolution import UnresolvedRow
        rows = [UnresolvedRow(kind=reason, raw_value=" | ".join(x for x in (event, player, market, book) if x)[:500],
                              context=json.dumps({"offers": n}))
                for (reason, event, player, market, book), n in self.unmatched_counter.most_common(200)]
        await db.replace_unresolved_for_provider("scraper", rows)
        self.unresolved_day = today
        self.unmatched_counter.clear()

    def prune(self) -> None:
        """Hourly: forget in-memory state for games that started over 12 h ago
        (or are no longer linked), so days of running do not grow memory. The
        forwarded values of unmatched keys are dropped too: at worst the next
        identical reading is upserted once more."""
        now = now_utc()
        live = {v[1] for v in self.res.links.values() if not v[3] or (parse_ts(v[3]) or now) > now - timedelta(hours=12)}
        keep = lambda key: key[0] != "u" and key[2] in live            # noqa: E731
        self.hold.forwarded = {k: v for k, v in self.hold.forwarded.items() if keep(k)}
        cutoff = now - timedelta(hours=1)
        self.hold.pending = {k: p for k, p in self.hold.pending.items() if p.at > cutoff}
        for d in (self.book_state, self.group_keys, self.main_of):
            for g in [g for g in d if g[1] not in live]:
                del d[g]
        self.fwd_game_rows = {k: v for k, v in self.fwd_game_rows.items() if k[2] in live}
        for k in [k for k, v in self.endpoint_games.items() if not (v & live)]:
            del self.endpoint_games[k]
        for k in list(self.endpoint_games):
            self.endpoint_games[k] &= live
        self.opened = {k for k in self.opened if k[1] in live}
        for g in [g for g in self.opener_peers if g[0] not in live]:
            del self.opener_peers[g]
        self.ref_sent = {k: v for k, v in self.ref_sent.items() if k[0] in live}
        del self.hold.hold_seconds[:-5000]
        self.res.labels.clear()
        if len(self.res.props) > 500_000:
            self.res.props.clear()
        self.last_prune = time.time()

    # --- the loop ------------------------------------------------------------------
    async def brakes_on(self) -> str | None:
        try:
            b = await db.read_bridge_brakes()
        except Exception as e:                           # noqa: BLE001 — the write will fail the same way
            print(f"[bridge] brakes unreadable: {type(e).__name__}: {e}", flush=True)
            return None
        if b["disk_paused"]:
            return f"disk guard: {b['disk_reason']}"
        if b["cost_brake"]:
            return f"cost guard: {b['cost_reason']}"
        return None

    async def run(self) -> None:
        EgressMeter.install()
        self.load_cursors()
        if not self.test:
            self.unmatched_keys = await db.read_scraper_unmatched_keys(f"{self.prefix}:")
        start_rows = self.load_references()
        if start_rows:
            from db import GameReferenceInput
            refs = [r for r in start_rows if isinstance(r, GameReferenceInput)]
            ops = [r for r in start_rows if not isinstance(r, GameReferenceInput)]
            self._check_openers(ops)
            self.outbox = self._plan([], [], [], [], [], [], ops, refs, [], [])
            await self.flush()
        idle = 0
        while True:
            t0 = time.time()
            try:
                await self.maybe_match()
                await self.maybe_timing()
                self.paused_reason = None if self.test else await self.brakes_on()
                if self.paused_reason is None:
                    before = self.stats["offers_read"] + self.stats["confirmed"]
                    pos_before = dict(self.read_pos)
                    await self.cycle()
                    moved = self.read_pos != pos_before or self.stats["offers_read"] + self.stats["confirmed"] != before
                    idle = 0 if moved else idle + 1
                await self.heartbeat()
                if time.time() - self.last_prune > 3600:
                    self.prune()
            except Exception as e:                       # noqa: BLE001 — a cycle never kills the bridge
                self.cycle_ok = False
                self.last_error = f"cycle: {type(e).__name__}: {e}"[:500]
                traceback.print_exc()
            if self.args.once or (self.args.until_idle and idle >= 2 and not self.outbox and not self.hold.pending):
                break
            if self.args.until_idle and idle >= 4:
                break
            elapsed = time.time() - t0
            if not self.args.until_idle:
                await asyncio.sleep(max(1.0, CYCLE_S - elapsed))
        self.write_status()
        print(json.dumps(self.status(), indent=1, default=str), flush=True)


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--scraper-db", default=SCRAPER_DB)
    ap.add_argument("--replay-db", help="alias of --scraper-db for the replay test")
    ap.add_argument("--state-db", default=STATE_DB)
    ap.add_argument("--provider-prefix", default="scraper", help="scraper-test for the replay test")
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--until-idle", action="store_true", help="exit once nothing new is read (the replay test)")
    ap.add_argument("--from-start", action="store_true", help="cursors at 0 (a replay copy)")
    ap.add_argument("--no-match", action="store_true", help="do not run P3 matching (use the state DB's links)")
    ap.add_argument("--no-seed", action="store_true", help="do not seed first_seen openers from history")
    ap.add_argument("--no-heartbeat", action="store_true")
    ap.add_argument("--max-offers", type=int, default=MAX_OFFERS, help="offers read per cycle")
    ap.add_argument("--debug-stacks", type=int, default=0, help="dump every thread's stack every N seconds")
    ap.add_argument("--cycle-log", help="append each cycle's read bounds here (the replay test's counter)")
    a = ap.parse_args()
    if a.replay_db:
        a.scraper_db = a.replay_db
    if a.provider_prefix != "scraper":
        a.no_heartbeat = True
    if a.debug_stacks:
        import faulthandler
        faulthandler.dump_traceback_later(a.debug_stacks, repeat=True)
    await Bridge(a).run()


if __name__ == "__main__":
    asyncio.run(main())

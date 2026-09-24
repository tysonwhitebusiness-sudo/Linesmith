# P5 · Schema and writers

**Lane:** DB migration + Python writers + one TypeScript reader rule.
**Deploys:** one Render deploy of the worker ⚑ (the migration is applied by
hand first). **Needs:** P4's decision **D24** (windows and what is written),
the operator's green light.
**Goal:**
- the database can hold everything the approved design shows: two times per
  price, pulls, openers, periods and alternates, team totals, splits and
  exchange books;
- the writers accept the source's own times;
- the page prefers a first-hand price over a relayed copy.

**Audit findings covered:** F3, F4, F6, F9 (and G8's writer half).

---

## Design decisions (and why)

1. **Additive only; no existing reader changes behaviour.**
   - About 15 readers query `prop_odds_history` and `game_odds_history`
     (`lib/odds/props/lineHistory.ts`, `lib/odds/gameLineHistory.ts`,
     `lib/slate/marketMoves.ts`, `lib/db/client.ts`,
     `lib/odds/devigBacktest.ts`, five sport game-research files,
     `health_check.py`, `jobs.py`).
   - So **pulls get their own tables**, not rows inside the history tables
     every reader would have to learn to skip. **Periods and alternates get
     new game-line tables**, not a widened key on `game_odds_book_lines`,
     whose readers assume one line per book.
   - P8 moves the odds sections onto the new tables. Converging the paid
     feeds and OddsHarvester onto them is a later follow-up.
2. **"Checked" and "since" (D23).**
   - `fetched_at` stays "checked", the last time a source confirmed the
     price.
   - A new `changed_at` is "since", the time the price last changed.
   - History `observed_at` becomes **the time of the change at the source**
     (the scraper's fetch time minus CDN `Age`, or its per-price timestamp),
     not the time of our write. Existing callers pass neither, so they keep
     today's behaviour exactly.
3. **Pull records** come from two places:
   - the existing step-4 delete in `write_prop_odds` (a complete provider
     stopped quoting a rung; today it deletes silently);
   - the bridge forwarding the scraper's `offer_events` pulls.

   A return closes the pull (`returned_at`).
4. **RLS on every new table:** `ENABLE ROW LEVEL SECURITY`, plus one
   `FOR SELECT USING (true)` policy. This is the pattern of `20260915060000`;
   the worker writes as the service role.
5. **Retention follows D24.** The defaults below are replaced by D24's
   numbers where it says otherwise. History tables join the corpus (export
   → verify → prune to a serving window, never a bare delete); current-state
   tables get a `RETENTION_RULES` row.

---

## Build

### 1. Migration `supabase/migrations/<UTC yyyymmddHHMMSS>_odds_bridge_schema.sql`

Name it with the UTC time it is written. Apply it by hand before the deploy
(the `20260921120000` pattern). First run it inside `BEGIN; … ROLLBACK;` to
prove it applies, then run it for real.

```sql
-- P5 (odds workstream): schema for the scraper bridge and the approved odds
-- sections (Track O). Additive: no existing column, key or constraint changes.

-- 1. Two times per price + source detail on prop prices (D23).
ALTER TABLE prop_odds ADD COLUMN IF NOT EXISTS changed_at timestamptz;   -- "since"
ALTER TABLE prop_odds ADD COLUMN IF NOT EXISTS extra jsonb;              -- limit, bid/ask, volume, version, payout
COMMENT ON COLUMN prop_odds.fetched_at IS 'checked: when a source last confirmed this price';
COMMENT ON COLUMN prop_odds.changed_at IS 'since: when this price last changed at the source (NULL on rows written before P5)';

-- 2. Pulls: a price a book stopped offering, and when (if) it came back.
CREATE TABLE IF NOT EXISTS prop_odds_pulls (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id        text NOT NULL,
  game_id            text NOT NULL,
  subject_id         text NOT NULL,
  market_key         text NOT NULL,
  line               double precision,
  side               text NOT NULL,
  bookmaker          text NOT NULL,
  last_american_odds integer,
  pulled_at          timestamptz NOT NULL,
  returned_at        timestamptz,
  reason             text               -- 'line' (other lines still quoted) | 'event_gone' | 'complete_fetch'
);
CREATE INDEX IF NOT EXISTS prop_odds_pulls_lookup ON prop_odds_pulls (game_id, subject_id, market_key, pulled_at);
CREATE INDEX IF NOT EXISTS prop_odds_pulls_open ON prop_odds_pulls (provider_id, game_id, subject_id, market_key, side, bookmaker)
  WHERE returned_at IS NULL;

-- 3. Game lines with periods, alternates and every market type.
CREATE TABLE IF NOT EXISTS game_lines (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport         text NOT NULL,          -- generic: mlb|nfl|cfb|nba|nhl|soccer|tennis
  game_id       text NOT NULL,
  period        text NOT NULL,          -- fg|1h|2h|1q..4q|p1..p4|f3|f5|f7|i1..i9|s1|m10
  market        text NOT NULL,          -- ml|sp|tot|ml3|tt_home|tt_away|tt|odd_even|btts|... (P2 GAME_TYPE)
  side          text NOT NULL,          -- home|away|draw|over|under|yes|no|odd|even
  point         double precision,
  is_main       boolean NOT NULL DEFAULT false,
  bookmaker     text NOT NULL,
  source        text NOT NULL,          -- 'scraper:<source>' | provider id
  american_odds integer NOT NULL,
  decimal_odds  double precision,
  fetched_at    timestamptz NOT NULL,   -- checked
  changed_at    timestamptz NOT NULL,   -- since
  extra         jsonb,
  CONSTRAINT game_lines_key UNIQUE NULLS NOT DISTINCT (sport, game_id, period, market, side, point, bookmaker, source),
  CONSTRAINT game_lines_odds_sane CHECK (american_odds <= -100 OR american_odds >= 100),
  CONSTRAINT game_lines_sport_valid CHECK (sport IN ('mlb','nfl','cfb','nba','nhl','soccer','tennis'))
);
CREATE INDEX IF NOT EXISTS game_lines_game ON game_lines (sport, game_id, period, market);

CREATE TABLE IF NOT EXISTS game_lines_history (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport         text NOT NULL,
  game_id       text NOT NULL,
  period        text NOT NULL,
  market        text NOT NULL,
  side          text NOT NULL,
  point         double precision,
  is_main       boolean NOT NULL,
  bookmaker     text NOT NULL,
  source        text NOT NULL,
  american_odds integer NOT NULL,
  observed_at   timestamptz NOT NULL    -- the time of the change at the source
);
CREATE INDEX IF NOT EXISTS game_lines_history_lookup ON game_lines_history (game_id, period, market, side, bookmaker, observed_at);

CREATE TABLE IF NOT EXISTS game_line_pulls (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport text NOT NULL, game_id text NOT NULL, period text NOT NULL, market text NOT NULL, side text NOT NULL,
  point double precision, bookmaker text NOT NULL, source text NOT NULL,
  last_american_odds integer, pulled_at timestamptz NOT NULL, returned_at timestamptz, reason text
);
CREATE INDEX IF NOT EXISTS game_line_pulls_lookup ON game_line_pulls (game_id, period, market, pulled_at);

-- 4. Openers (D21): the first price recorded per book, VSiN's OPEN row for Nevada.
CREATE TABLE IF NOT EXISTS market_openers (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('prop','game')),
  sport         text NOT NULL,
  game_id       text NOT NULL,
  subject_id    text NOT NULL DEFAULT '',   -- '' for game markets
  period        text NOT NULL DEFAULT 'fg',
  market        text NOT NULL,              -- prop market_key or game market type
  side          text NOT NULL,
  bookmaker     text NOT NULL,
  point         double precision,
  american_odds integer,
  opened_at     timestamptz NOT NULL,
  opener_source text NOT NULL CHECK (opener_source IN ('first_seen','vsin_open','an_open','theoddsgap')),
  check_flag    boolean NOT NULL DEFAULT false,
  check_reason  text,
  CONSTRAINT market_openers_key UNIQUE (kind, game_id, subject_id, period, market, side, bookmaker)
);
CREATE INDEX IF NOT EXISTS market_openers_game ON market_openers (sport, game_id);

-- 5. Splits (Track V): every change, one row per change.
CREATE TABLE IF NOT EXISTS market_splits (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sport       text NOT NULL,
  game_id     text NOT NULL,
  subject_id  text NOT NULL DEFAULT '',     -- '' for game markets; athlete id for pick counts
  period      text NOT NULL DEFAULT 'fg',
  market      text NOT NULL,                -- ml|sp|tot|<prop market_key>
  side        text NOT NULL,
  line        double precision,
  source      text NOT NULL,                -- dknetwork|vsin|sao_consensus|covers|actionnetwork|sleeper
  book        text,                         -- whose customers: draftkings|circa|NULL (unstated)
  kind        text NOT NULL CHECK (kind IN ('bets_money','picks','pick_counts','bet_count')),
  pct_bets    double precision,
  pct_money   double precision,
  count       integer,
  count_total integer,
  observed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS market_splits_lookup ON market_splits (game_id, market, source, observed_at DESC);

-- 6. Exchange order books (current state; the ladder history stays on the laptop).
CREATE TABLE IF NOT EXISTS exchange_books (
  exchange      text NOT NULL CHECK (exchange IN ('kalshi','polymarket')),
  contract_id   text NOT NULL,
  sport         text NOT NULL,
  game_id       text NOT NULL,
  subject_id    text NOT NULL DEFAULT '',
  period        text NOT NULL DEFAULT 'fg',
  market        text NOT NULL,
  side          text NOT NULL,
  point         double precision,
  best_bid      double precision, best_ask double precision,
  bid_size      double precision, ask_size double precision,
  volume_24h    double precision, open_interest double precision, liquidity double precision,
  ladder        jsonb,                       -- {"bids": [[price,size]...], "asks": [...]} top 10 levels
  changed_at    timestamptz NOT NULL,        -- the ladder's own "price since"
  fetched_at    timestamptz NOT NULL,
  PRIMARY KEY (exchange, contract_id)
);
CREATE INDEX IF NOT EXISTS exchange_books_game ON exchange_books (sport, game_id, market);

-- 7. RLS, the pattern of 20260915060000.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['prop_odds_pulls','game_lines','game_lines_history','game_line_pulls',
                           'market_openers','market_splits','exchange_books'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (true)', t || '_read', t);
  END LOOP; END $$;

COMMENT ON TABLE game_lines IS 'P5: current per-book game lines, every period, alternate and market type. Python writes (scraper bridge); read by the Track O odds sections.';
COMMENT ON TABLE game_lines_history IS 'P5: game-line changes (price or main-line flag), observed_at = the change time at the source.';
COMMENT ON TABLE prop_odds_pulls IS 'P5: a prop price a book stopped offering, and its return.';
COMMENT ON TABLE game_line_pulls IS 'P5: a game-line price a book stopped offering, and its return.';
COMMENT ON TABLE market_openers IS 'P5 (D21): first price per book; VSiN OPEN for Nevada; check_flag = failed the opener sanity check, kept, never used as the opener.';
COMMENT ON TABLE market_splits IS 'P5 (Track V): bets/money %, picks, pick counts and bet counts, labelled by source and whose customers; one row per change.';
COMMENT ON TABLE exchange_books IS 'P5: Kalshi/Polymarket order book per contract, current state.';
```

### 2. Python writers — `python-odds-service/src/db.py`

**`PropOddsInput`** gains three fields, all defaulting so existing callers
are unchanged:

```python
observed_at: datetime | None = None   # checked; None -> write time (today's behaviour)
changed_at: datetime | None = None    # since; None -> derived (below)
extra: dict | None = None
```

**`write_prop_odds(rows, complete_providers=frozenset())`:**
- **History insert:** `observed_at = r.changed_at or r.observed_at or fetched_at`.
- **Current upsert:**
  - `fetched_at = r.observed_at or fetched_at`;
  - insert: `changed_at = r.changed_at or r.observed_at or fetched_at`;
  - on conflict:
    `changed_at = CASE WHEN prop_odds.american_odds IS DISTINCT FROM excluded.american_odds THEN excluded.changed_at ELSE COALESCE(prop_odds.changed_at, excluded.changed_at) END`,
    and `extra = COALESCE(excluded.extra, prop_odds.extra)`.
- **Step 4 becomes a recorded pull:** the existing `DELETE … USING markets m
  WHERE …` gains
  `RETURNING provider_id, game_id, subject_id, market_key, line, side, bookmaker, american_odds`.
  The returned rows are inserted into `prop_odds_pulls` with
  `pulled_at = fetched_at` and `reason = 'complete_fetch'`, in the same
  transaction.
- **Returns:** for batch keys with **no prior row** (new inserts), one
  batched
  `UPDATE prop_odds_pulls SET returned_at = <that row's observed time> WHERE (provider_id, game_id, subject_id, market_key, side, bookmaker) IN (unnest …) AND line IS NOT DISTINCT FROM … AND returned_at IS NULL`.
- **Docstring:** add a paragraph on the two times and the pulls, with the
  date.

**New functions** (same batching rules as the existing writers: one
transaction per call, `executemany`, chunk-then-isolate on a constraint
error like `write_game_odds_book_lines`):

```python
@dataclass
class PropPullInput:  provider_id, game_id, subject_id, market_key, line, side, bookmaker, pulled_at: datetime, reason: str
async def write_prop_pulls(pulls: list[PropPullInput]) -> int
    # DELETE the matching prop_odds rows RETURNING american_odds -> INSERT prop_odds_pulls(last_american_odds=that)

@dataclass
class GameLineInput:  sport, game_id, period, market, side, point, is_main: bool, bookmaker, source,
                      american_odds: int, decimal_odds: float | None, observed_at: datetime | None = None,
                      changed_at: datetime | None = None, extra: dict | None = None
async def write_game_lines(rows: list[GameLineInput], complete_sources: frozenset[str] = frozenset()) -> None
    # canonical_bookmaker + _GENERIC_SPORT_KEY at the writer (the 5.3 rule); prior (american_odds, is_main)
    # per key in ONE query; history row when either differs; upsert current with the prop_odds changed_at rule;
    # complete_sources -> delete unreturned rungs for the (game, period, market) the batch covers, recorded in game_line_pulls.

@dataclass
class GameLinePullInput: sport, game_id, period, market, side, point, bookmaker, source, pulled_at, reason
async def write_game_line_pulls(pulls: list[GameLinePullInput]) -> int

@dataclass
class OpenerInput: kind, sport, game_id, subject_id, period, market, side, bookmaker, point, american_odds,
                   opened_at, opener_source, check_flag: bool = False, check_reason: str | None = None
async def write_openers(rows: list[OpenerInput]) -> int
    # INSERT ... ON CONFLICT (market_openers_key) DO NOTHING, except opener_source='vsin_open' which
    # DO UPDATEs a row whose opener_source = 'first_seen' (VSiN's OPEN row wins for Nevada books, D21).

@dataclass
class SplitInput: sport, game_id, subject_id, period, market, side, line, source, book, kind,
                  pct_bets, pct_money, count, count_total, observed_at
async def write_splits(rows: list[SplitInput]) -> int
    # log-on-change: prior (pct_bets, pct_money, count, count_total) per
    # (game_id, subject_id, period, market, side, source, book, kind) via DISTINCT ON ... ORDER BY observed_at DESC, id DESC.

@dataclass
class ExchangeBookInput: exchange, contract_id, sport, game_id, subject_id, period, market, side, point,
                         best_bid, best_ask, bid_size, ask_size, volume_24h, open_interest, liquidity,
                         ladder: dict | None, changed_at: datetime, fetched_at: datetime
async def write_exchange_books(rows: list[ExchangeBookInput]) -> int   # upsert on (exchange, contract_id)
```

`write_game_lines` also writes the **full-game main ml/sp/tot** rows it
receives into the existing `game_odds_book_lines` through
`write_game_odds_book_lines` (market names `moneyline`/`spread`/`total`,
`source` unchanged). That way today's pages show the scraper's books before
P8. It is one call, and the existing constraints still police it.

### 3. Retention — `db.RETENTION_RULES`, `prune_corpus.KEEP_RECENT_DAYS`, `corpus_store.CORPUS`

Defaults, replaced by D24 where it says otherwise:

| table | rule |
|---|---|
| `game_lines` | `RETENTION_RULES`: `fetched_at < now() - interval '2 days'` (the `game_odds_book_lines` rule) |
| `exchange_books` | `RETENTION_RULES`: `fetched_at < now() - interval '2 days'` |
| `game_lines_history` | `CORPUS` entry `CorpusTable("game_lines_history", "observed_at", OBSERVED_AT_PREDICATE, partition_by="id_chunk")`; `KEEP_RECENT_DAYS` 10 |
| `prop_odds_pulls`, `game_line_pulls` | `CORPUS` entries on `pulled_at`, `id_chunk`; `KEEP_RECENT_DAYS` 10 |
| `market_splits` | `CORPUS` entry on `observed_at`, `id_chunk`; `KEEP_RECENT_DAYS` 10 |
| `market_openers` | not pruned (small; closing-line research and the team page's record against the close read old games' openers) |

### 4. The reader rule (F6) — `lib/odds/props/mainLine.ts`

- **New `lib/odds/sourcePrecedence.ts`:**

  ```ts
  /** A price read from the book's own site (or the exchange itself) beats the same book relayed by an
   *  aggregator: relays re-confirm prices that can be hours old (plan D23). */
  export const FIRST_HAND_SOURCES: Readonly<Record<string, readonly string[]>> = {
    'scraper:draftkings': ['draftkings'], 'scraper:fanduel': ['fanduel'], 'scraper:betmgm': ['betmgm'],
    'scraper:betrivers': ['betrivers'], 'scraper:pinnacle': ['pinnacle'], 'scraper:kalshi': ['kalshi'],
    'scraper:polymarket': ['polymarket', 'polymarketus'], 'scraper:sleeper': ['sleeper'],
    'scraper:underdog': ['underdog'],
    'scraper:vsin': ['circa', 'westgate', 'southpoint', 'wynn', 'stations', 'boomers', 'betmgmnv', 'caesarsnv'],
  };
  export function isFirstHand(providerId: string, bookmaker: string): boolean
  export function preferQuote<T extends { providerId: string; bookmaker: string; changedAt?: string | null; fetchedAt: string }>(a: T, b: T): T
    // first-hand beats relay; then the later (changedAt ?? fetchedAt); then the later fetchedAt
  ```
- `PropOddsRow` (`lib/db/client.ts:497`) gains `changedAt: string | null`
  and `extra: Record<string, unknown> | null`. `PROP_ODDS_COLUMNS` gains
  `changed_at AS "changedAt", extra`.
- `lastPreGameQuotes`: the per-key choice (currently "later `fetchedAt`
  wins", `mainLine.ts:141–142`) becomes `preferQuote(prev, r)`. The
  superseded-rung check is unchanged.

### 5. Ownership + docs

- `docs/table-ownership.md`: add the seven tables to its "changes" table in
  the same format (**NEW (migration `<name>`) | Python — `db.write_*` via
  the scraper bridge (P6); read by …**), and note `prop_odds.changed_at` and
  `extra`. Record `slate_rankings` lacking RLS as an open item (found here,
  not fixed here).
- CLAUDE.md "Who writes what": one line saying the scraper bridge is a
  Python writer (laptop) through the shared `db.write_*` functions.

---

## Tests (these gate P6)

| test | kind | what it proves |
|---|---|---|
| migration dry run | DB | the file applies inside `BEGIN … ROLLBACK`, then for real; `\d` shows the columns, keys, indexes and the 7 read policies |
| `src/test_write_prop_odds.py` (existing, live DB) extended | Python | unchanged results for an existing-style batch (no times passed); a batch with `observed_at`/`changed_at` stores them (history `observed_at` = `changed_at`); an unchanged price keeps `changed_at`; a changed price moves it; `complete_providers` deleting a rung writes a `prop_odds_pulls` row with the last odds; re-inserting that rung sets `returned_at` |
| `src/test_write_game_lines.py` (new, live DB, not CI) | Python | fake game `test-p5-gl-<date>`: alternate points coexist (−3.5, −4.5, −5.5 for one book); `is_main` moving from −4.5 to −5.5 with prices unchanged logs history rows; `1h` and `fg` rows are separate keys; the FG main ml/sp/tot also land in `game_odds_book_lines`; `complete_sources` pull → `game_line_pulls`; the odds-sanity constraint rejects `-50` without sinking the batch |
| `src/test_write_openers.py` (new, live DB, not CI) | Python | first_seen inserts once; a second first_seen does nothing; `vsin_open` replaces first_seen; `check_flag` is stored |
| `src/test_write_splits.py` (new, live DB, not CI) | Python | same pcts twice → 1 row; a change → 2 |
| `src/test_write_exchange_books.py` (new, live DB, not CI) | Python | upsert keeps one row per contract, ladder stored as jsonb |
| `tests/source-precedence.test.ts` (new) | TS | DraftKings via `scraper:draftkings` beats DraftKings via `scraper:comparenbet` even when the relay was checked later; two relays → the later `changedAt`; rows without `changedAt` fall back to `fetchedAt` |
| `tests/prop-main-line.test.ts` (existing) | TS | still green; a new case: a stale relayed price no longer becomes the main-line price |
| RLS | DB | `set role anon; select 1 from game_lines limit 1;` succeeds (read), `insert` fails |
| after deploy | live | the worker's next cycles write normally (`job_run_log` green); `prop_odds.changed_at` fills on changed rows; one `complete_fetch` pull row appears within a day |

**Exit criteria:**
- the migration is applied;
- every test above passes;
- the deploy is recorded in `docs/CURRENT.md`;
- the ownership doc is updated.

## Background checks

None (P6's soak watches the new tables filling).

## Files touched

- New:
  - the migration;
  - `lib/odds/sourcePrecedence.ts`;
  - `tests/source-precedence.test.ts`;
  - five Python tests.
- Edited:
  - `python-odds-service/src/db.py`, `python-odds-service/prune_corpus.py`,
    `python-odds-service/src/corpus_store.py`;
  - `lib/db/client.ts`, `lib/odds/props/mainLine.ts`;
  - `docs/table-ownership.md`, `CLAUDE.md`, `docs/CURRENT.md`.

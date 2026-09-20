'use client';

import { Avatar, Card, Chip, DataTable, cx, type Column } from '@/components/ui';

/**
 * U2's table fixtures for the kit page.
 *
 * Two jobs. First, every new `DataTable` prop rendered somewhere, so a phase
 * that changes one can see all of them at once. Second — and this is why the
 * gameplan put U2 before S1 — the SLATE's own tables, built here on fixture
 * data before any of them has a real adapter behind it. S1 to S5 then build on
 * columns that have already been looked at rather than designing them and
 * wiring them in the same commit.
 *
 * Fixtures are deliberately small and obviously fake. They are here to show
 * shape, not to stand in for the real numbers.
 */

/* -------------------------------------------------------------------------- */
/* Research: the reference types                                              */
/* -------------------------------------------------------------------------- */

interface LogRow {
  id: string;
  date: string;
  opp: string;
  home: boolean;
  result: 'W' | 'L';
  score: string;
  ab: number;
  h: number;
  tb: number;
  streak: Array<boolean | null>;
}

const LOG: LogRow[] = [
  { id: '1', date: 'Sep 17', opp: 'BOS', home: false, result: 'W', score: '6–3', ab: 4, h: 2, tb: 5, streak: [true, true, false, true, true] },
  { id: '2', date: 'Sep 16', opp: 'BOS', home: false, result: 'L', score: '1–4', ab: 4, h: 0, tb: 0, streak: [true, false, false, true, false] },
  { id: '3', date: 'Sep 15', opp: 'TOR', home: true, result: 'W', score: '8–2', ab: 5, h: 3, tb: 7, streak: [true, true, true, null, true] },
  { id: '4', date: 'Sep 14', opp: 'TOR', home: true, result: 'L', score: '2–5', ab: 3, h: 1, tb: 1, streak: [false, false, true, true, false] },
  { id: '5', date: 'Sep 13', opp: 'BAL', home: true, result: 'W', score: '5–4', ab: 4, h: 2, tb: 3, streak: [true, null, true, false, true] },
  { id: '6', date: 'Sep 12', opp: 'BAL', home: true, result: 'W', score: '7–1', ab: 4, h: 1, tb: 4, streak: [true, true, false, false, true] },
  { id: '7', date: 'Sep 11', opp: 'TB', home: false, result: 'L', score: '0–2', ab: 4, h: 0, tb: 0, streak: [false, false, false, true, false] },
  { id: '8', date: 'Sep 10', opp: 'TB', home: false, result: 'W', score: '4–3', ab: 5, h: 2, tb: 2, streak: [true, true, true, true, false] },
  { id: '9', date: 'Sep 09', opp: 'NYM', home: true, result: 'W', score: '9–5', ab: 5, h: 4, tb: 9, streak: [true, true, true, true, true] },
  { id: '10', date: 'Sep 08', opp: 'NYM', home: true, result: 'L', score: '3–6', ab: 4, h: 1, tb: 2, streak: [false, true, false, false, true] },
  { id: '11', date: 'Sep 07', opp: 'CHC', home: false, result: 'W', score: '2–1', ab: 3, h: 1, tb: 1, streak: [true, false, true, false, true] },
  { id: '12', date: 'Sep 06', opp: 'CHC', home: false, result: 'L', score: '4–8', ab: 4, h: 2, tb: 4, streak: [true, true, false, true, false] },
];

const maxTb = Math.max(...LOG.map((r) => r.tb));

const LOG_COLUMNS: Column<LogRow>[] = [
  { key: 'date', label: 'Date', sortable: false, render: (r) => <span className="text-ink">{r.date}</span> },
  {
    key: 'opp',
    label: 'Opp',
    sortable: false,
    render: (r) => (
      <span className="flex items-center gap-1.5">
        <span className="text-label text-ink-muted">{r.home ? 'vs' : '@'}</span>
        <Avatar kind="logo" label={r.opp} size={18} decorative />
        <span>{r.opp}</span>
      </span>
    ),
  },
  { key: 'result', label: 'Result', sortable: false, tone: (r) => (r.result === 'W' ? 'good' : 'bad'), render: (r) => r.score },
  { key: 'ab', label: 'AB', numeric: true },
  { key: 'h', label: 'H', numeric: true, strong: (r) => r.h === Math.max(...LOG.map((x) => x.h)) },
  {
    key: 'tb',
    label: 'TB',
    numeric: true,
    info: 'Total bases: a single is 1, a double 2, a triple 3, a home run 4. The bar is this game as a share of the biggest in the window.',
    bar: (r) => r.tb / maxTb,
  },
  { key: 'l5', label: 'Last 5', sortable: false, align: 'right', streak: (r) => ({ outcomes: r.streak }) },
];

interface SeasonRow {
  id: string;
  label: string;
  gp: number;
  avg: string;
  hr: number;
  rbi: number;
}

const SEASONS: SeasonRow[] = [
  { id: '2026', label: '2026', gp: 133, avg: '.221', hr: 14, rbi: 48 },
  { id: '2025', label: '2025', gp: 159, avg: '.237', hr: 23, rbi: 74 },
  { id: '2024', label: '2024', gp: 161, avg: '.237', hr: 15, rbi: 71 },
];
const SEASON_TOTAL: SeasonRow[] = [{ id: 'all', label: 'All held', gp: 453, avg: '.232', hr: 52, rbi: 193 }];

const SEASON_COLUMNS: Column<SeasonRow>[] = [
  { key: 'label', label: 'Season', sortable: false },
  { key: 'gp', label: 'GP', numeric: true, sortable: false },
  { key: 'avg', label: 'AVG', numeric: true, sortable: false },
  { key: 'hr', label: 'HR', numeric: true, sortable: false },
  { key: 'rbi', label: 'RBI', numeric: true, sortable: false },
];

interface SplitRow {
  id: string;
  group: string;
  label: string;
  gp: number;
  rate: number;
}

const SPLITS: SplitRow[] = [
  { id: 'a', group: 'Overall', label: 'All games', gp: 133, rate: 0.55 },
  { id: 'b', group: 'Venue', label: 'Home', gp: 67, rate: 0.62 },
  { id: 'c', group: 'Venue', label: 'Away', gp: 66, rate: 0.48 },
  { id: 'd', group: 'Result', label: 'In wins', gp: 63, rate: 0.71 },
  { id: 'e', group: 'Result', label: 'In losses', gp: 70, rate: 0.4 },
  { id: 'f', group: 'Month', label: 'August', gp: 27, rate: 0.59 },
  { id: 'g', group: 'Month', label: 'September', gp: 17, rate: 0.35 },
];

const SPLIT_COLUMNS: Column<SplitRow>[] = [
  { key: 'label', label: 'Split', sortable: false },
  { key: 'gp', label: 'GP', numeric: true, sortable: false },
  {
    key: 'rate',
    label: 'Hit rate',
    numeric: true,
    sortable: false,
    render: (r) => `${(r.rate * 100).toFixed(1)}%`,
    heat: { direction: 'higher', value: (r) => r.rate },
  },
];

interface StandingRow {
  id: string;
  team: string;
  w: number;
  l: number;
  diff: number;
  last10: Array<boolean | null>;
  own?: boolean;
}

const STANDINGS: StandingRow[] = [
  { id: 'nyy', team: 'New York', w: 92, l: 63, diff: 118, last10: [true, true, false, true, true, true, false, true, true, false], own: true },
  { id: 'bos', team: 'Boston', w: 86, l: 69, diff: 41, last10: [true, false, false, true, true, false, true, false, true, true] },
  { id: 'tor', team: 'Toronto', w: 80, l: 75, diff: -6, last10: [false, true, false, false, true, true, false, true, false, false] },
  { id: 'bal', team: 'Baltimore', w: 72, l: 83, diff: -64, last10: [false, false, true, false, false, true, false, false, true, false] },
];

const STANDING_COLUMNS: Column<StandingRow>[] = [
  { key: 'team', label: 'Team', sortable: false, render: (r) => (
    <span className="flex items-center gap-1.5">
      <Avatar kind="logo" label={r.team} size={18} decorative />
      {r.team}
    </span>
  ) },
  { key: 'w', label: 'W', numeric: true },
  { key: 'l', label: 'L', numeric: true },
  { key: 'diff', label: 'Diff', numeric: true, render: (r) => (r.diff > 0 ? `+${r.diff}` : String(r.diff)) },
  { key: 'last10', label: 'Last 10', sortable: false, align: 'right', streak: (r) => ({ outcomes: r.last10 }) },
];

interface HoleRow {
  id: string;
  label: string;
  [hole: string]: string | number;
}

const HOLES = Array.from({ length: 18 }, (_, i) => String(i + 1));
const HOLE_ROWS: HoleRow[] = [
  { id: 'par', label: 'Par', ...Object.fromEntries(HOLES.map((h, i) => [h, [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5][i]])) },
  { id: 'avg', label: 'Scoring avg', ...Object.fromEntries(HOLES.map((h, i) => [h, Number((3.6 + ((i * 7) % 11) / 12).toFixed(2))])) },
];

// Every hole's scoring average, so the 18 columns share ONE pool. Ranking a
// hole against itself is meaningless — a matrix's heat is across the grid, and
// `pool` is the escape hatch for exactly that. The par row returns null and
// therefore takes no tint at all.
const AVG_POOL = HOLES.map((h) => Number(HOLE_ROWS[1][h]));

const HOLE_COLUMNS: Column<HoleRow>[] = [
  { key: 'label', label: 'Hole', sortable: false },
  ...HOLES.map<Column<HoleRow>>((h) => ({
    key: h,
    label: h,
    numeric: true,
    sortable: false,
    heat: {
      direction: 'lower',
      value: (r) => (r.id === 'avg' ? Number(r[h]) : null),
      pool: () => AVG_POOL,
    },
  })),
];

/* -------------------------------------------------------------------------- */
/* The Slate's tables (S1–S5 build on these columns)                          */
/* -------------------------------------------------------------------------- */

interface MoverRow {
  id: string;
  subject: string;
  market: string;
  book: string;
  firstSeen: number;
  now: number;
  movePts: number;
  steam: boolean;
  split: boolean;
}

const MOVERS: MoverRow[] = [
  { id: '1', subject: 'Chandler Simpson', market: 'Stolen bases o0.5', book: 'DraftKings', firstSeen: 185, now: 240, movePts: 6.2, steam: true, split: false },
  { id: '2', subject: 'Luis Arraez', market: 'Singles o0.5', book: 'FanDuel', firstSeen: -165, now: -200, movePts: -4.4, steam: false, split: true },
  { id: '3', subject: 'Pete Crow-Armstrong', market: 'Stolen bases o0.5', book: 'BetMGM', firstSeen: 210, now: 250, movePts: -3.1, steam: false, split: false },
  { id: '4', subject: 'Kyle Schwarber', market: 'Home runs o0.5', book: 'Caesars', firstSeen: 320, now: 285, movePts: 2.7, steam: true, split: false },
];

const maxMove = Math.max(...MOVERS.map((m) => Math.abs(m.movePts)));

const MOVER_COLUMNS: Column<MoverRow>[] = [
  { key: 'subject', label: 'Player', sortable: false },
  { key: 'market', label: 'Market', sortable: false },
  { key: 'book', label: 'Book', sortable: false },
  { key: 'firstSeen', label: 'First seen', numeric: true, info: 'The first price this book was observed at. The OPENER is not held, so this is "since first seen", not "since open".', render: (r) => (r.firstSeen > 0 ? `+${r.firstSeen}` : String(r.firstSeen)) },
  { key: 'now', label: 'Now', numeric: true, render: (r) => (r.now > 0 ? `+${r.now}` : String(r.now)) },
  {
    key: 'movePts',
    label: 'Move',
    numeric: true,
    info: 'Implied-probability points, first seen to now. Market information, not a prediction.',
    render: (r) => `${r.movePts > 0 ? '+' : ''}${r.movePts.toFixed(1)}`,
    bar: (r) => Math.abs(r.movePts) / maxMove,
  },
  {
    key: 'flags',
    label: 'Flags',
    sortable: false,
    align: 'right',
    render: (r) => (
      <span className="inline-flex gap-1">
        {r.steam ? <Chip tone="neutral" shape="box" size="sm">Steam</Chip> : null}
        {r.split ? <Chip tone="neutral" shape="box" size="sm">Split</Chip> : null}
        {!r.steam && !r.split ? '—' : null}
      </span>
    ),
  },
];

interface OutlierRow {
  id: string;
  subject: string;
  market: string;
  book: string;
  price: number;
  median: number;
  gapPts: number;
  books: number;
}

const OUTLIERS: OutlierRow[] = [
  { id: '1', subject: 'Nico Hoerner', market: 'Singles o0.5', book: 'Fanatics', price: -215, median: -245, gapPts: 4.1, books: 11 },
  { id: '2', subject: 'Bobby Witt Jr.', market: 'Stolen bases o0.5', book: 'BetRivers', price: 360, median: 320, gapPts: 5.6, books: 9 },
  { id: '3', subject: 'CJ Abrams', market: 'Stolen bases o0.5', book: 'ESPN Bet', price: 500, median: 440, gapPts: 6.2, books: 7 },
];

const OUTLIER_COLUMNS: Column<OutlierRow>[] = [
  { key: 'subject', label: 'Player', sortable: false },
  { key: 'market', label: 'Market', sortable: false },
  { key: 'book', label: 'Book', sortable: false },
  { key: 'price', label: 'Price', numeric: true, render: (r) => (r.price > 0 ? `+${r.price}` : String(r.price)) },
  { key: 'median', label: 'Median', numeric: true, info: 'The median of every other book on the same line. Quotes more than 15 implied points away are dropped as stale or exchange prices.', render: (r) => (r.median > 0 ? `+${r.median}` : String(r.median)) },
  { key: 'gapPts', label: 'Gap', numeric: true, render: (r) => `${r.gapPts.toFixed(1)}` },
  { key: 'books', label: 'Books', numeric: true },
];

interface SpotlightRow {
  id: string;
  player: string;
  team: string;
  rate: number;
  sample: string;
  form: Array<boolean | null>;
}

const SPOTLIGHT: SpotlightRow[] = [
  { id: '1', player: 'Chandler Simpson', team: 'TB', rate: 0.8, sample: '12 of 15', form: [true, true, true, false, true] },
  { id: '2', player: 'Luis Arraez', team: 'SD', rate: 0.73, sample: '11 of 15', form: [true, false, true, true, true] },
  { id: '3', player: 'Nico Hoerner', team: 'CHC', rate: 0.67, sample: '10 of 15', form: [false, true, true, true, false] },
];

const SPOTLIGHT_COLUMNS: Column<SpotlightRow>[] = [
  { key: 'player', label: 'Player', sortable: false, render: (r) => (
    <span className="flex items-center gap-1.5">
      <Avatar label={r.player} size={24} decorative />
      <span>{r.player}</span>
      <span className="text-label text-ink-muted">{r.team}</span>
    </span>
  ) },
  { key: 'rate', label: 'Hit rate', numeric: true, info: 'Share of the last 15 games in which the player cleared this line. Counted from the game logs.', render: (r) => `${(r.rate * 100).toFixed(0)}%`, bar: (r) => r.rate },
  { key: 'sample', label: 'Sample', sortable: false, align: 'right' },
  { key: 'form', label: 'Last 5', sortable: false, align: 'right', streak: (r) => ({ outcomes: r.form }) },
];

interface SpecialRow {
  id: string;
  player: string;
  score: number;
  park: number;
  hand: number;
  form: number;
}

const SPECIALS: SpecialRow[] = [
  { id: '1', player: 'Kyle Schwarber', score: 0.84, park: 0.91, hand: 0.78, form: 0.82 },
  { id: '2', player: 'Aaron Judge', score: 0.79, park: 0.62, hand: 0.88, form: 0.88 },
  { id: '3', player: 'Shohei Ohtani', score: 0.74, park: 0.7, hand: 0.71, form: 0.81 },
  { id: '4', player: 'Juan Soto', score: 0.61, park: 0.55, hand: 0.6, form: 0.69 },
];

const SPECIAL_COLUMNS: Column<SpecialRow>[] = [
  { key: 'player', label: 'Player', sortable: false },
  { key: 'score', label: 'Score', numeric: true, info: 'Each factor as a percentile across the whole pool, averaged. Weights are EQUAL until the backtest sets them.', render: (r) => r.score.toFixed(2), bar: (r) => r.score },
  { key: 'park', label: 'Park', numeric: true, info: 'The venue’s home-run factor for this batter’s hand.', render: (r) => r.park.toFixed(2) },
  { key: 'hand', label: 'vs hand', numeric: true, info: 'The batter’s rate against the opposing starter’s throwing hand.', render: (r) => r.hand.toFixed(2) },
  { key: 'form', label: 'Form', numeric: true, info: 'Recent contact quality from the pitch corpus.', render: (r) => r.form.toFixed(2) },
];

/* -------------------------------------------------------------------------- */

function TableRow({ name, note, children }: { name: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-card-title text-ink">{name}</h3>
        {note ? <span className="text-label text-ink-muted">{note}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function KitTables() {
  return (
    <section id="tables" className="mt-10 scroll-mt-6">
      <h2 className="text-heading text-ink">Tables</h2>
      <p className="mt-1 max-w-[70ch] text-body-sm text-ink-muted">
        The Hybrid: our engine and our density with Untitled UI&apos;s chrome. The research types come
        first, then the Slate&apos;s — built here on fixtures before any of them has an adapter, so S1
        to S5 start from columns that have been looked at.
      </p>

      <div className={cx('mt-3 space-y-6')}>
        <TableRow name="Game log" note="paging, a tone column, a magnitude bar, an info tooltip, a streak — and NO heat, because a game log is a record, not a ranking">
          <Card title="Game log" count={LOG.length} scope="2026 regular season" flush>
            <DataTable
              caption="Game log"
              columns={LOG_COLUMNS}
              rows={LOG}
              rowKey={(r) => r.id}
              paging={{ mode: 'minimal', pageSize: 10, pageSizes: [10, 25, 50], noun: 'games' }}
            />
          </Card>
        </TableRow>

        <TableRow name="Season stats" note="`totals` — the All held row is ruled off, and excluded from sorting, bars and leaders">
          <Card title="Season stats" count={SEASONS.length} scope="453 games held" flush>
            <DataTable caption="Season by season" columns={SEASON_COLUMNS} rows={SEASONS} totals={SEASON_TOTAL} rowKey={(r) => r.id} />
          </Card>
        </TableRow>

        <TableRow name="Situational splits" note="`groupBy` — a group row per block, and Overall gets none. Heat on the rate column only">
          <Card title="Situational splits" scope="2026" flush>
            <DataTable caption="Situational splits" columns={SPLIT_COLUMNS} rows={SPLITS} rowKey={(r) => r.id} groupBy={(r) => r.group} />
          </Card>
        </TableRow>

        <TableRow name="Standings" note="`highlight` — a fill AND a 3px inset bar, never colour alone; `expand` opens the row in place">
          <Card title="Standings" scope="AL East" flush>
            <DataTable
              caption="Standings"
              columns={STANDING_COLUMNS}
              rows={STANDINGS}
              rowKey={(r) => r.id}
              initialSort={{ key: 'w', desc: true }}
              highlight={(r) => r.own === true}
              expand={(r) => (
                <div className="text-body-sm text-ink-secondary">
                  {r.team} are {r.w}–{r.l} with a run differential of {r.diff > 0 ? `+${r.diff}` : r.diff}.{' '}
                  <a href="#tables" className="text-ink underline underline-offset-2">
                    Open the team →
                  </a>
                </div>
              )}
            />
          </Card>
        </TableRow>

        <TableRow name="Hole difficulty" note="`compact` + `heat` with a par row — 18 columns in a matrix, which is what compact is REQUIRED for">
          <Card title="Hole difficulty" scope="The Cliffs at Walnut Cove" flush>
            <DataTable caption="Hole difficulty" columns={HOLE_COLUMNS} rows={HOLE_ROWS} rowKey={(r) => r.id} density="compact" />
          </Card>
        </TableRow>

        <TableRow name="Movers" note="Slate S2. The caption says SINCE FIRST SEEN, because the opener is not held">
          <Card title="Movers" count={MOVERS.length} scope="Game lines · since first seen" flush caption="Move is in implied-probability points since the first price we saw at that book. This is market information, not a prediction.">
            <DataTable caption="Movers" columns={MOVER_COLUMNS} rows={MOVERS} rowKey={(r) => r.id} initialSort={{ key: 'movePts', desc: true }} />
          </Card>
        </TableRow>

        <TableRow name="Price outliers" note="Slate S2. Five books minimum, a 4–15 point gap; above 15 is a stale or exchange quote and is dropped">
          <Card title="Price outliers" count={OUTLIERS.length} flush caption="A book whose price sits well off the median of the rest. Market information, not a prediction.">
            <DataTable caption="Price outliers" columns={OUTLIER_COLUMNS} rows={OUTLIERS} rowKey={(r) => r.id} initialSort={{ key: 'gapPts', desc: true }} />
          </Card>
        </TableRow>

        <TableRow name="Spotlight" note="Slate S3. A bar and a streak, and every factor carries an info tooltip naming its source">
          <Card title="Hit-rate leaders" count={SPOTLIGHT.length} scope="Last 15 games" flush caption="Counted from the game logs. Weights are equal until the backtest sets them.">
            <DataTable caption="Hit-rate leaders" columns={SPOTLIGHT_COLUMNS} rows={SPOTLIGHT} rowKey={(r) => r.id} initialSort={{ key: 'rate', desc: true }} />
          </Card>
        </TableRow>

        <TableRow name="Specials ranking" note="Slate S4. A score bar, and an info on EVERY factor">
          <Card title="Home run specials" count={SPECIALS.length} flush caption="Each factor is a percentile across the whole pool. Weights are equal until M3's backtest sets them.">
            <DataTable caption="Home run specials" columns={SPECIAL_COLUMNS} rows={SPECIALS} rowKey={(r) => r.id} initialSort={{ key: 'score', desc: true }} />
          </Card>
        </TableRow>
      </div>
    </section>
  );
}

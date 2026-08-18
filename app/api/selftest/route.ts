import { NextResponse } from 'next/server';
import { holesUntil, playingOrder, measuredPace, teeTimeForDisplay } from '@/lib/sports/golf/timing';
import { validateScheduledTime, resolveEta, formatDistance } from '@/lib/core/timing';
import { battersUntil } from '@/lib/sports/mlb/timing';
import {
  scanConsistent,
  sortByComingUp,
  readForm,
  windowSplit,
  subsetSplit,
  standardWindows,
} from '@/lib/core/pickEngine';
import {
  fixedWindow,
  openWindow,
  subsetWindow,
  currentStreak,
  categoriseByLine,
  deltaFromLine,
  windowSet,
} from '@/lib/core/windowedStat';
import { parseRelativeToPar, categoryFor } from '@/lib/sports/golf/adapter';
import { summariseOddsEvent, indexLinesByMatchup, lookupLine, formatAmerican } from '@/lib/odds/oddsApi';
import type { PickCandidate } from '@/lib/core/types';

function check(name: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  return { name, pass, actual, expected };
}

export async function GET() {
  const now = new Date('2026-08-10T18:00:00Z');
  const results = [];

  // --- Golf hole distance, including a split-tee start ---
  results.push(check('playingOrder(10) wraps 18→1', playingOrder(10).slice(8, 11), [18, 1, 2]));
  results.push(check('hole 12 with 5 played from tee 1', holesUntil(12, { startHole: 1, thru: 5 }), 6));
  results.push(check('hole 6 already played from tee 1 → null', holesUntil(6, { startHole: 1, thru: 8 }), null));
  results.push(check('standing on hole 9 = 0', holesUntil(9, { startHole: 1, thru: 8 }), 0));
  // 10th-tee start: 10 holes played covers 10→18 then 1, so hole 2 is up now.
  results.push(check('10th-tee start, hole 2 is up now after 10 thru', holesUntil(2, { startHole: 10, thru: 10 }), 0));
  results.push(check('10th-tee start, hole 4 is 2 away after 10 thru', holesUntil(4, { startHole: 10, thru: 10 }), 2));
  results.push(check('10th-tee start, hole 15 already played', holesUntil(15, { startHole: 10, thru: 10 }), null));
  results.push(check('unknown thru → null, never a guess', holesUntil(4, { startHole: 1, thru: null }), null));

  // --- Pace guard rejects thin / implausible samples ---
  const golfer = (thru: number | null, teeTime?: string) =>
    ({ id: 'x', name: 'Test', status: { thru: thru ?? undefined, teeTime }, rounds: [] }) as any;
  results.push(
    check(
      'pace rejected under 3 holes',
      measuredPace(golfer(2, '2026-08-10T17:00:00Z'), now),
      null,
    ),
  );
  results.push(
    check(
      'pace rejected when implausibly fast (<8 min/hole)',
      measuredPace(golfer(12, '2026-08-10T17:00:00Z'), now),
      null,
    ),
  );
  results.push(
    check(
      'pace accepted at 15 min/hole',
      measuredPace(golfer(12, '2026-08-10T15:00:00Z'), now),
      15,
    ),
  );

  // --- The tee-time guardrail: a stale stamp must not become a schedule ---
  results.push(
    check(
      'tee time 3h in the past is rejected for a player who has not started',
      teeTimeForDisplay(golfer(0, '2026-08-10T15:00:00Z'), now),
      null,
    ),
  );
  results.push(
    check(
      'past tee time is legitimate once underway',
      teeTimeForDisplay(golfer(9, '2026-08-10T15:00:00Z'), now),
      '2026-08-10T15:00:00Z',
    ),
  );
  results.push(
    check('validateScheduledTime rejects >20m stale', validateScheduledTime('2026-08-10T17:00:00Z', now), null),
  );
  results.push(
    check(
      'validateScheduledTime keeps a future time',
      validateScheduledTime('2026-08-10T19:00:00Z', now),
      '2026-08-10T19:00:00.000Z',
    ),
  );

  // --- ETA provenance is never overstated ---
  const measured = resolveEta(4, { ownPace: 15, peerPace: 12, constantPace: 15 });
  results.push(check('own pace wins and is labelled measured', [measured.etaMinutes, measured.etaConfidence], [60, 'measured']));
  const fallback = resolveEta(4, { ownPace: null, peerPace: 12, constantPace: 15 });
  results.push(check('field median is labelled fallback', [fallback.etaMinutes, fallback.etaConfidence], [48, 'fallback']));
  const none = resolveEta(null, { ownPace: 15, peerPace: 12 });
  results.push(check('unknown distance yields no ETA at all', [none.etaMinutes, none.etaConfidence], [null, null]));
  results.push(check('unknown distance renders honestly', formatDistance(null, 'holes'), 'position unknown'));

  // --- Category derived from the round's own relative-to-par ---
  results.push(check('parse E', parseRelativeToPar('E'), 0));
  results.push(check('parse +2', parseRelativeToPar('+2'), 2));
  results.push(check('parse -1', parseRelativeToPar('-1'), -1));
  results.push(check('blank is unusable, not zero', parseRelativeToPar('-'), null));
  results.push(check('category buckets', [categoryFor(-2), categoryFor(0), categoryFor(3)], ['birdie', 'par', 'bogey']));

  // --- MLB batters-away ---
  const order = [101, 102, 103, 104, 105, 106, 107, 108, 109];
  results.push(check('current batter is 0 away', battersUntil(order, 103, 103), 0));
  results.push(check('on deck is 1 away', battersUntil(order, 103, 104), 1));
  results.push(check('wraps through the order', battersUntil(order, 108, 102), 3));
  results.push(check('not in lineup → null', battersUntil(order, 103, 999), null));
  results.push(check('unknown current batter → null', battersUntil(order, null, 104), null));

  // --- Engine: consistency, sorting, form ---
  const mk = (id: string, cats: string[], distance: number | null, status: any = 'live'): PickCandidate => ({
    sport: 'golf',
    subjectId: id,
    subjectName: id,
    dimension: 'hole-7',
    dimensionLabel: 'Hole 7',
    category: cats[cats.length - 1],
    categoryLabel: 'x',
    history: cats.map((c, i) => ({ period: i + 1, result: c, category: c, raw: null })),
    consistent: cats.every((c) => c === cats[0]),
    sampleSize: cats.length,
    liveState: { status, distanceToSubject: distance, distanceUnit: 'holes', etaMinutes: null, etaConfidence: null },
  });

  const pool = [
    mk('far', ['par', 'par', 'par'], 9),
    mk('near', ['par', 'par', 'par'], 1),
    mk('mixed', ['par', 'bogey', 'par'], 2),
    mk('unknown', ['par', 'par', 'par'], null),
    mk('done', ['par', 'par', 'par'], 3, 'done'),
  ];

  results.push(check('consistency filter drops the mixed one', scanConsistent(pool, { minSampleSize: 3 }).map((c) => c.subjectId), ['far', 'near', 'unknown', 'done']));
  results.push(
    check(
      'exact distance sorts first; unknown before done',
      sortByComingUp(pool).map((c) => c.subjectId),
      ['near', 'mixed', 'far', 'unknown', 'done'],
    ),
  );

  const streaky = mk('s', ['bogey', 'bogey', 'par', 'par', 'par'], 1);
  const form = readForm(streaky, { window: 5 });
  results.push(check('streak counts trailing matches only', form.streak, 3));
  results.push(
    check('baseline rate over full history', form.baseline.status === 'ok' ? form.baseline.rate : null, 0.6),
  );

  // --- Windowed stats: the fixed-window contract ---
  const hist = (cats: string[]): PickCandidate['history'] =>
    cats.map((c, i) => ({ period: i + 1, result: c, category: c, raw: { isHome: i % 2 === 0, opponentId: i < 3 ? 7 : 9 } }));

  const h12 = hist(['hit', 'no-hit', 'hit', 'hit', 'hit', 'no-hit', 'hit', 'hit', 'hit', 'hit', 'no-hit', 'hit']);

  results.push(
    check('fixedWindow measures exactly the trailing window', fixedWindow(h12, 'hit', 5), {
      status: 'ok',
      hits: 4,
      total: 5,
      rate: 0.8,
      average: 0,
    }),
  );

  // The core regression: a 12-game history must NOT answer a 15-game question.
  results.push(
    check('a window longer than the history is insufficient, never partial', fixedWindow(h12, 'hit', 15), {
      status: 'insufficient',
      available: 12,
      required: 15,
    }),
  );

  // Windows are independent: the same history is complete at 10 and short at 15.
  const set = windowSet(h12, 'hit');
  results.push(
    check(
      'L10 resolves while L15 is insufficient on the same history',
      [set.l10.status, set.l15.status],
      ['ok', 'insufficient'],
    ),
  );

  results.push(
    check(
      'standardWindows returns every requested window, short ones included',
      standardWindows(h12, 'hit', [5, 10, 15]).map((s) => `${s.label}:${s.stat.status}`),
      ['Last 5:ok', 'Last 10:ok', 'Last 15:insufficient'],
    ),
  );

  results.push(
    check(
      'subsetWindow filters by predicate and discloses its own denominator',
      subsetWindow(h12, 'hit', (e) => (e.raw as any).opponentId === 7),
      { status: 'ok', hits: 2, total: 3, rate: 2 / 3, average: 0 },
    ),
  );

  results.push(
    check(
      'a subset below its minimum is insufficient, not zero',
      subsetWindow(h12, 'hit', (e) => (e.raw as any).opponentId === 999, { minimum: 2 }),
      { status: 'insufficient', available: 0, required: 2 },
    ),
  );

  results.push(
    check('subsetSplit carries its insight kind through', subsetSplit(h12, 'hit', () => true, 'vs OPP', 'head-to-head').kind, 'head-to-head'),
  );
  results.push(
    check('windowSplit defaults to recent-form', windowSplit(h12, 'hit', 5, 'Last 5').kind, 'recent-form'),
  );

  // --- Streaks are signed, so a cold run reads as clearly as a hot one ---
  results.push(check('a trailing run of the category is positive', currentStreak(hist(['no-hit', 'hit', 'hit']), 'hit'), 2));
  results.push(check('a trailing run against the category is negative', currentStreak(hist(['hit', 'no-hit', 'no-hit']), 'hit'), -2));
  results.push(check('an empty history has no streak', currentStreak([], 'hit'), 0));

  // --- Re-measuring against a moved line ---
  const boxScores: PickCandidate['history'] = ['0-4', '2-4', '1-3', '3-5', '0-4'].map((result, i) => ({
    period: i + 1,
    result,
    category: 'hit',
    raw: {},
  }));

  results.push(
    check(
      'at 0.5 hits, three of five clear',
      (() => {
        const w = fixedWindow(categoriseByLine(boxScores, 0.5), 'over', 5);
        return w.status === 'ok' ? w.hits : null;
      })(),
      3,
    ),
  );
  results.push(
    check(
      'stepping the line to 1.5 re-reads the same games',
      (() => {
        const w = fixedWindow(categoriseByLine(boxScores, 1.5), 'over', 5);
        return w.status === 'ok' ? w.hits : null;
      })(),
      2,
    ),
  );
  results.push(
    check(
      'average comes from the parsed magnitudes',
      (() => {
        const w = openWindow(boxScores, 'hit', { minimum: 1 });
        return w.status === 'ok' ? w.average : null;
      })(),
      1.2,
    ),
  );

  // --- Delta against the line ---
  results.push(
    check(
      'delta is signed absolute plus a proportion of the line',
      (() => {
        const d = deltaFromLine(openWindow(boxScores, 'hit'), 0.5);
        // Rounded: the assertion is about the arithmetic, not float residue.
        return d && { absolute: Number(d.absolute.toFixed(4)), percent: Number((d.percent ?? 0).toFixed(4)) };
      })(),
      { absolute: 0.7, percent: 1.4 },
    ),
  );
  results.push(
    check(
      'a delta from an insufficient window is withheld, not zeroed',
      deltaFromLine(fixedWindow(boxScores, 'hit', 15), 0.5),
      null,
    ),
  );

  // --- Odds API: best-price aggregation and matchup keying ---
  const oddsEvent = {
    id: 'evt1',
    commence_time: '2026-08-10T23:05:00Z',
    home_team: 'Toronto Blue Jays',
    away_team: 'Boston Red Sox',
    bookmakers: [
      {
        title: 'BookA',
        markets: [
          {
            key: 'h2h',
            outcomes: [
              { name: 'Toronto Blue Jays', price: -140 },
              { name: 'Boston Red Sox', price: +120 },
            ],
          },
          { key: 'totals', outcomes: [{ name: 'Over', point: 8.5, price: -110 }, { name: 'Under', point: 8.5, price: -110 }] },
        ],
      },
      {
        title: 'BookB',
        markets: [
          {
            key: 'h2h',
            outcomes: [
              { name: 'Toronto Blue Jays', price: -125 },
              { name: 'Boston Red Sox', price: +135 },
            ],
          },
        ],
      },
    ],
  };
  const summary = summariseOddsEvent(oddsEvent);
  results.push(check('best home price across books (-125 beats -140)', summary.moneyline?.home, -125));
  results.push(check('best away price across books (+135 beats +120)', summary.moneyline?.away, 135));
  results.push(check('total carried through', [summary.total?.point, summary.total?.overPrice], [8.5, -110]));
  results.push(check('book count counted', summary.bookCount, 2));

  const idx = indexLinesByMatchup([summary]);
  results.push(check('line found by MLB team names', lookupLine(idx, 'Boston Red Sox', 'Toronto Blue Jays')?.eventId, 'evt1'));
  results.push(check('reversed home/away does not match', lookupLine(idx, 'Toronto Blue Jays', 'Boston Red Sox'), null));
  results.push(check('american formatting', [formatAmerican(120), formatAmerican(-110), formatAmerican(undefined)], ['+120', '-110', '—']));

  const failed = results.filter((r) => !r.pass);
  return NextResponse.json(
    { total: results.length, passed: results.length - failed.length, failed, results },
    { status: failed.length === 0 ? 200 : 500 },
  );
}

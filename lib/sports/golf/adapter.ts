/**
 * Golf adapter — turns two ESPN feeds into `PickCandidate`s.
 *
 * The pattern this hunts: a golfer who has made the same score on the same
 * hole every round so far, surfaced while that hole is still ahead of them.
 */

import type {
  HistoryEntry,
  LiveStatus,
  PickCandidate,
  SplitEvidence,
  SportSnapshot,
  SubjectSummary,
} from '../../core/types';
import { fetchGolfEvent } from './espn';
import type { EspnCourse, EspnGolfer, EspnGolfEvent } from './espn';
import { fieldMedianPace, golfEta, holesUntil, teeTimeForDisplay } from './timing';
import { getWeather } from '../../weather/openMeteo';
import { resolveCourseCoords } from './venues';

export type GolfCategory = 'birdie' | 'par' | 'bogey';

const CATEGORY_LABEL: Record<GolfCategory, string> = {
  birdie: 'Birdie or better',
  par: 'Par',
  bogey: 'Bogey or worse',
};

/**
 * Parse a hole's own score-relative-to-par, e.g. 'E' | '-1' | '+2'.
 * Using the round's own value rather than a single field-wide par estimate is
 * what keeps a moved tee or an unusual pin from mismarking a score.
 */
export function parseRelativeToPar(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '-') return null;
  if (trimmed.toUpperCase() === 'E') return 0;
  const parsed = Number(trimmed.replace('+', ''));
  return Number.isFinite(parsed) ? parsed : null;
}

export function categoryFor(relativeToPar: number): GolfCategory {
  if (relativeToPar < 0) return 'birdie';
  if (relativeToPar === 0) return 'par';
  return 'bogey';
}

function formatRelative(relativeToPar: number): string {
  if (relativeToPar === 0) return 'E';
  return relativeToPar > 0 ? `+${relativeToPar}` : String(relativeToPar);
}

/** Most common category in a set of history entries — used when not consistent. */
function modalCategory(entries: HistoryEntry[]): GolfCategory {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  let best: string = 'par';
  let bestCount = -1;
  for (const [category, count] of counts) {
    if (count > bestCount) {
      best = category;
      bestCount = count;
    }
  }
  return best as GolfCategory;
}

interface GolferPosition {
  startHole: number;
  thru: number | null;
  currentRound: number | null;
  finishedRound: boolean;
}

/** One other golfer sharing a tee time, stripped to identity — used both as `groupedWith` and as the `opponent` on the richer matchup shapes below. */
export interface GroupMate {
  id: string;
  name: string;
  headshotUrl?: string;
}

/** One hole's score-relative-to-par for both sides of a live matchup, so the scorecard can draw a bar even for a hole neither side has reached yet (both null). */
export interface RoundMatchupHole {
  hole: number;
  par: number | null;
  self: number | null;
  opponent: number | null;
}

/** The live matchup for whichever round is happening right now — one opponent (the first tee-time groupmate) picked out of a 3-ball for a simple two-way scorecard, same simplification real 2-ball books make. */
export interface LiveRoundMatchup {
  round: number;
  opponent: GroupMate;
  holes: RoundMatchupHole[];
}

/** One completed round's group result — every groupmate that round (pairings reshuffle daily, so this is that day's group, not necessarily today's). */
export interface PastRoundMatchup {
  round: number;
  selfRelative: number | null;
  opponents: Array<GroupMate & { relative: number | null }>;
}

/**
 * Group every golfer by round, keyed off that round's own recorded tee time.
 *
 * ESPN's feed carries no explicit pairing/group id (checked live against the
 * raw leaderboard payload) — tee time is the same signal broadcast graphics
 * use. Keyed per-round (not the live `status` fields `buildGroups` used
 * before this) because pairings reshuffle every round in stroke play — R1's
 * groups are a different set of tee times than R3's, and both are needed for
 * a past-rounds history rather than just whichever round is live right now.
 */
function buildRoundGroups(golfers: EspnGolfer[]): Map<number, Map<string, EspnGolfer[]>> {
  const perRound = new Map<number, Map<string, EspnGolfer[]>>();
  for (const g of golfers) {
    for (const round of g.rounds) {
      if (!round.teeTime) continue;
      let byTeeTime = perRound.get(round.period);
      if (!byTeeTime) {
        byTeeTime = new Map();
        perRound.set(round.period, byTeeTime);
      }
      const bucket = byTeeTime.get(round.teeTime);
      if (bucket) bucket.push(g);
      else byTeeTime.set(round.teeTime, [g]);
    }
  }
  return perRound;
}

/** This golfer's groupmates for one specific round — empty when that round has no recorded tee time yet, or nobody else shares it. */
function groupmatesFor(golfer: EspnGolfer, period: number, roundGroups: Map<number, Map<string, EspnGolfer[]>>): EspnGolfer[] {
  const round = golfer.rounds.find((r) => r.period === period);
  if (!round?.teeTime) return [];
  const group = roundGroups.get(period)?.get(round.teeTime) ?? [];
  return group.length > 1 ? group.filter((g) => g.id !== golfer.id) : [];
}

function toGroupMate(g: EspnGolfer): GroupMate {
  return { id: g.id, name: g.name, headshotUrl: g.headshotUrl };
}

/** Hole-by-hole comparison for the round currently live (or about to start) — golfer vs. the first golfer sharing their tee time that round. */
function buildLiveRoundMatchup(
  golfer: EspnGolfer,
  currentRound: number | null,
  course: EspnCourse | null,
  roundGroups: Map<number, Map<string, EspnGolfer[]>>,
): LiveRoundMatchup | null {
  if (currentRound == null) return null;
  const [opponent] = groupmatesFor(golfer, currentRound, roundGroups);
  if (!opponent) return null;

  const selfRound = golfer.rounds.find((r) => r.period === currentRound);
  const oppRound = opponent.rounds.find((r) => r.period === currentRound);

  const holes: RoundMatchupHole[] = [];
  for (let hole = 1; hole <= 18; hole += 1) {
    const par = course?.holes.find((h) => h.number === hole)?.shotsToPar ?? null;
    holes.push({
      hole,
      par,
      self: parseRelativeToPar(selfRound?.holes.find((h) => h.hole === hole)?.relativeToPar),
      opponent: parseRelativeToPar(oppRound?.holes.find((h) => h.hole === hole)?.relativeToPar),
    });
  }

  return { round: currentRound, opponent: toGroupMate(opponent), holes };
}

/** Every completed round's group result, oldest first — excludes `currentRound` since that's the live matchup card's job. */
function buildPastRoundMatchups(
  golfer: EspnGolfer,
  currentRound: number | null,
  coursePar: number | undefined,
  roundGroups: Map<number, Map<string, EspnGolfer[]>>,
): PastRoundMatchup[] {
  if (!coursePar) return [];
  const out: PastRoundMatchup[] = [];

  for (const selfRound of golfer.rounds) {
    if (selfRound.period === currentRound || selfRound.total == null) continue;
    const mates = groupmatesFor(golfer, selfRound.period, roundGroups);
    if (mates.length === 0) continue;

    out.push({
      round: selfRound.period,
      selfRelative: selfRound.total - coursePar,
      opponents: mates
        .map((o) => {
          const oppRound = o.rounds.find((r) => r.period === selfRound.period);
          return { ...toGroupMate(o), relative: oppRound?.total != null ? oppRound.total - coursePar : null };
        })
        .filter((o) => o.relative !== null),
    });
  }

  return out.sort((a, b) => a.round - b.round);
}

function readPosition(golfer: EspnGolfer, event: EspnGolfEvent): GolferPosition {
  const status = golfer.status ?? {};
  const thru = Number.isFinite(Number(status.thru)) ? Number(status.thru) : null;
  return {
    startHole: Number.isFinite(Number(status.startHole)) ? Number(status.startHole) : 1,
    thru,
    currentRound: Number.isFinite(Number(status.period)) ? Number(status.period) : event.currentRound,
    finishedRound: thru != null && thru >= 18,
  };
}

/**
 * Build every hole-level candidate for one golfer.
 *
 * History for hole N is that golfer's score on hole N in each COMPLETED round;
 * the round currently in progress contributes only the holes already played.
 */
interface MatchupMeta {
  groupedWith: GroupMate[];
  liveRoundMatchup: LiveRoundMatchup | null;
  pastRoundMatchups: PastRoundMatchup[];
}

function candidatesForGolfer(
  golfer: EspnGolfer,
  event: EspnGolfEvent,
  course: EspnCourse | null,
  fieldPace: number | null,
  now: Date,
  matchup: MatchupMeta,
): PickCandidate[] {
  const position = readPosition(golfer, event);
  const out: PickCandidate[] = [];

  // Golf has no opponent or venue split, but "how are they handling par 3s
  // today" is a real, independent angle on the same claim. The target hole is
  // excluded from its own split so the evidence isn't circular.
  const latestRound = [...golfer.rounds].reverse().find((r) => r.holes.length > 0);
  const parOf = (hole: number) => course?.holes.find((h) => h.number === hole)?.shotsToPar;

  const samePar = (hole: number, category: GolfCategory): SplitEvidence | null => {
    const par = parOf(hole);
    if (!latestRound || !par) return null;

    const peers = latestRound.holes.filter((h) => h.hole !== hole && parOf(h.hole) === par);
    const scored = peers
      .map((h) => parseRelativeToPar(h.relativeToPar))
      .filter((rel): rel is number => rel !== null);

    const label = `Par ${par}s in R${latestRound.period}`;
    // Two peer holes is the floor for this to say anything; below that the
    // split reports insufficient rather than vanishing, so the card can show
    // that the angle exists but hasn't got behind it yet.
    if (scored.length < 2) {
      return { kind: 'recent-form', label, stat: { status: 'insufficient', available: scored.length, required: 2 } };
    }

    const hits = scored.filter((rel) => categoryFor(rel) === category).length;
    return {
      kind: 'recent-form',
      label,
      stat: {
        status: 'ok',
        hits,
        total: scored.length,
        rate: hits / scored.length,
        average: scored.reduce((sum, rel) => sum + rel, 0) / scored.length,
      },
    };
  };

  for (let hole = 1; hole <= 18; hole += 1) {
    const history: HistoryEntry[] = [];

    for (const round of golfer.rounds) {
      const holeScore = round.holes.find((h) => h.hole === hole);
      if (!holeScore) continue;

      let relative = parseRelativeToPar(holeScore.relativeToPar);
      // Fall back to course par only when the feed omitted the relative value.
      if (relative === null && holeScore.strokes != null && course) {
        const par = course.holes.find((h) => h.number === hole)?.shotsToPar;
        if (par) relative = holeScore.strokes - par;
      }
      if (relative === null) continue;

      history.push({
        period: round.period,
        result: formatRelative(relative),
        category: categoryFor(relative),
        periodLabel: `R${round.period}`,
        raw: { strokes: holeScore.strokes, relativeToPar: relative },
      });
    }

    if (history.length === 0) continue;

    const consistent = history.every((h) => h.category === history[0].category);
    const category = consistent ? (history[0].category as GolfCategory) : modalCategory(history);

    // Distance is only meaningful for the round in progress.
    const distance = position.finishedRound
      ? null
      : holesUntil(hole, { startHole: position.startHole, thru: position.thru });

    let status: LiveStatus;
    if (event.state === 'pre') status = 'pre';
    else if (event.completed || position.finishedRound) status = 'done';
    else if (position.thru === null) status = 'unknown';
    else if (distance === null) status = 'done'; // already played this hole today
    else status = 'live';

    const eta = status === 'live' ? golfEta(distance, golfer, fieldPace, now) : { etaMinutes: null, etaConfidence: null, note: undefined };
    const par = course?.holes.find((h) => h.number === hole)?.shotsToPar;

    out.push({
      sport: 'golf',
      subjectId: golfer.id,
      subjectName: golfer.name,
      subjectMeta: {
        country: golfer.country,
        headshotUrl: golfer.headshotUrl,
        flagUrl: golfer.flagUrl,
        amateur: golfer.amateur,
        totalScore: golfer.totalScore,
        position: golfer.status?.position?.displayName,
        teeTime: teeTimeForDisplay(golfer, now),
        thru: position.thru,
        startHole: position.startHole,
        groupedWith: matchup.groupedWith,
        liveRoundMatchup: matchup.liveRoundMatchup,
        pastRoundMatchups: matchup.pastRoundMatchups,
      },
      dimension: `hole-${hole}`,
      dimensionLabel: par ? `Hole ${hole} (Par ${par})` : `Hole ${hole}`,
      category,
      categoryLabel: CATEGORY_LABEL[category],
      history,
      consistent,
      sampleSize: history.length,
      supportingSplits: [samePar(hole, category)].filter(
        (s): s is NonNullable<typeof s> => s !== null,
      ),
      liveState: {
        status,
        distanceToSubject: distance,
        distanceUnit: 'holes',
        etaMinutes: eta.etaMinutes,
        etaConfidence: eta.etaConfidence,
        note: eta.note,
      },
    });
  }

  return out;
}

/** Round Score reuses hole-score's birdie/par/bogey buckets against the round total instead of one hole — same "under/at/over the target" shape, just relabeled so "birdie" doesn't leak into a stat that isn't about one hole. */
const ROUND_CATEGORY_LABEL: Record<GolfCategory, string> = {
  birdie: 'Under par',
  par: 'Even par',
  bogey: 'Over par',
};

/**
 * One "round score" candidate per golfer — the total-strokes-vs-par prop,
 * the thing "betting on total score" actually means. History is one entry
 * per round *completed* so far this week; a consistent pattern (e.g. under
 * par every round) projects onto whichever round is next/in progress, same
 * logic as the hole-score pattern scan.
 */
function roundScoreCandidate(
  golfer: EspnGolfer,
  event: EspnGolfEvent,
  course: EspnCourse | null,
  matchup: MatchupMeta,
  now: Date,
): PickCandidate | null {
  const coursePar = course?.shotsToPar;
  if (!coursePar) return null;

  const history: HistoryEntry[] = [];
  for (const round of golfer.rounds) {
    // ESPN sends `total: 0` (not null) for a round that hasn't started yet —
    // a real 18-hole score is never ≤0, and without this guard that reads as
    // "0 - par", a wildly wrong relative score (e.g. -70) for every golfer at
    // once the moment a new round posts. Requiring real hole data is the same
    // "has this round actually started" signal `candidatesForGolfer` uses.
    //
    // A live round's `total` is a running total, not a final one — for a
    // golfer thru 4 holes today, ESPN's `round.total` is 17 (their actual
    // strokes so far), and 17 - coursePar reads as "-53 relative to par",
    // an impossible round score. Only a round with all 18 holes actually
    // posted has a `total` that means "final score for the round" — same
    // 18-hole completeness gate historyIngest.ts uses for the same reason.
    const holesPlayed = round.holes.filter((h) => h.strokes != null).length;
    if (round.total == null || round.total <= 0 || holesPlayed < 18) continue;
    const relative = round.total - coursePar;
    history.push({
      period: round.period,
      result: formatRelative(relative),
      category: categoryFor(relative),
      periodLabel: `R${round.period}`,
      raw: { total: round.total, relativeToPar: relative },
    });
  }
  if (history.length === 0) return null;

  const consistent = history.every((h) => h.category === history[0].category);
  const category = consistent ? (history[0].category as GolfCategory) : modalCategory(history);
  const position = readPosition(golfer, event);

  let status: LiveStatus;
  if (event.state === 'pre') status = 'pre';
  else if (event.completed || position.finishedRound) status = 'done';
  else if (position.thru === null) status = 'unknown';
  else status = 'live';

  return {
    sport: 'golf',
    subjectId: golfer.id,
    subjectName: golfer.name,
    subjectMeta: {
      country: golfer.country,
      headshotUrl: golfer.headshotUrl,
      flagUrl: golfer.flagUrl,
      amateur: golfer.amateur,
      totalScore: golfer.totalScore,
      position: golfer.status?.position?.displayName,
      teeTime: teeTimeForDisplay(golfer, now),
      thru: position.thru,
      startHole: position.startHole,
      groupedWith: matchup.groupedWith,
      liveRoundMatchup: matchup.liveRoundMatchup,
      pastRoundMatchups: matchup.pastRoundMatchups,
    },
    dimension: 'round-score',
    dimensionLabel: `Round Score (Par ${coursePar})`,
    category,
    categoryLabel: ROUND_CATEGORY_LABEL[category],
    history,
    consistent,
    sampleSize: history.length,
    supportingSplits: [],
    liveState: {
      status,
      distanceToSubject: null,
      distanceUnit: 'holes',
      etaMinutes: null,
      etaConfidence: null,
    },
  };
}

function subjectSummary(golfer: EspnGolfer, now: Date): SubjectSummary {
  const thru = golfer.status?.thru;
  const score = golfer.totalScore ?? '—';
  const statusLine =
    golfer.status?.displayValue === 'F' || thru === 18
      ? `${score} · F`
      : thru != null
        ? `${score} · thru ${thru}`
        : `${score}`;

  return {
    subjectId: golfer.id,
    subjectName: golfer.name,
    statusLine,
    meta: {
      country: golfer.country,
      headshotUrl: golfer.headshotUrl,
      flagUrl: golfer.flagUrl,
      position: golfer.status?.position?.displayName,
      teeTime: teeTimeForDisplay(golfer, now),
      amateur: golfer.amateur,
    },
  };
}

/** Fetch live golf data and normalise the whole field into a snapshot. */
export async function getGolfSnapshot(now: Date = new Date()): Promise<SportSnapshot> {
  const event = await fetchGolfEvent();

  if (!event) {
    return {
      sport: 'golf',
      eventName: null,
      eventDetail: null,
      status: 'unknown',
      candidates: [],
      subjects: [],
      warnings: ['Could not reach the ESPN golf feed. Nothing to show — this is a fetch failure, not an empty field.'],
      fetchedAt: now.toISOString(),
    };
  }

  const warnings = [...event.warnings];
  const fieldPace = fieldMedianPace(event.golfers, now);
  const roundGroups = buildRoundGroups(event.golfers);
  const currentRound = event.currentRound;

  const candidates = event.golfers.flatMap((golfer) => {
    const matchup: MatchupMeta = {
      groupedWith: groupmatesFor(golfer, currentRound ?? -1, roundGroups).map(toGroupMate),
      liveRoundMatchup: buildLiveRoundMatchup(golfer, currentRound, event.course, roundGroups),
      pastRoundMatchups: buildPastRoundMatchups(golfer, currentRound, event.course?.shotsToPar, roundGroups),
    };
    const holeCandidates = candidatesForGolfer(golfer, event, event.course, fieldPace, now, matchup);
    const roundCandidate = roundScoreCandidate(golfer, event, event.course, matchup, now);
    return roundCandidate ? [...holeCandidates, roundCandidate] : holeCandidates;
  });

  // Course weather. Prefers exact coordinates from venues.ts's known-course
  // table; falls back to ESPN's city-level address (flagged approximate)
  // when the course isn't in that table yet.
  let weather;
  const address = event.course?.address;
  const coords = await resolveCourseCoords(event.course?.name, address);
  if (coords) {
    weather = (await getWeather(coords, now)) ?? undefined;
    if (!weather) warnings.push('Weather service did not respond — conditions unavailable.');
  } else if (address?.city) {
    warnings.push(`Could not locate "${address.city}" for a weather lookup.`);
  }

  const status: LiveStatus =
    event.state === 'in' ? 'live' : event.state === 'pre' ? 'pre' : event.completed ? 'done' : 'unknown';

  // NO MODEL NUMBERS. Hole, round-score and tournament-win models used to run
  // here on every poll and put modelProb / leagueRate / P(win) on these
  // candidates. They were hand-picked priors, never fitted, never gated
  // against a price, and deleted by operator decision (master plan Phase 8,
  // 8.1, 2026-09-13). The candidates below are the observed hole patterns
  // only. A golf model returns in Python, measured, or not at all.

  return {
    sport: 'golf',
    eventName: event.name,
    eventDetail: event.currentRound ? `Round ${event.currentRound}` : null,
    status,
    candidates,
    subjects: event.golfers.map((g) => subjectSummary(g, now)),
    context: {
      weather,
      other: event.course
        ? {
            courseName: event.course.name,
            par: event.course.shotsToPar,
            yards: event.course.totalYards,
            city: [event.course.address?.city, event.course.address?.state].filter(Boolean).join(', '),
            holes: event.course.holes,
          }
        : undefined,
    },
    warnings,
    fetchedAt: now.toISOString(),
  };
}

/**
 * ESPN public golf endpoints.
 *
 * Neither feed is sufficient alone, which is why this module fetches both:
 *
 *   leaderboard?league=pga  → course (incl. per-hole par), player status
 *                             (thru / current hole / start hole / tee time),
 *                             position — but NO per-hole scores.
 *   pga/scoreboard          → per-hole scores for every round, including each
 *                             hole's own score-relative-to-par — but no course,
 *                             no tee time and no thru.
 *
 * They are merged on `competitor.id`, which is the ESPN athlete id in both.
 */

const LEADERBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga';
const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';
const ATHLETE_STATS_URL = (id: string, season: number) =>
  `https://site.web.api.espn.com/apis/common/v3/sports/golf/athletes/${id}/stats?season=${season}`;

export interface EspnHole {
  number: number;
  shotsToPar: number;
  totalYards?: number;
}

export interface EspnCourse {
  id: string;
  name: string;
  shotsToPar: number;
  totalYards?: number;
  holes: EspnHole[];
  address?: { city?: string; state?: string; country?: string; zipCode?: string };
}

export interface EspnPlayerStatus {
  displayValue?: string;
  period?: number;
  teeTime?: string;
  hole?: number;
  startHole?: number;
  thru?: number;
  displayThru?: string;
  type?: { state?: string; completed?: boolean; description?: string };
  position?: { displayName?: string };
}

/** One round for one player, with per-hole detail merged in from the scoreboard. */
export interface EspnRound {
  period: number;
  total: number | null;
  displayValue?: string;
  teeTime?: string;
  holes: Array<{
    hole: number;
    strokes: number | null;
    /** Score relative to par for THIS hole in THIS round, e.g. '-1' | 'E' | '+2'. */
    relativeToPar: string | null;
  }>;
}

export interface EspnGolfer {
  id: string;
  name: string;
  country?: string;
  /** Inline headshot from the feed; authoritative when present. */
  headshotUrl?: string;
  /** Country flag — golf's reliable fallback visual. */
  flagUrl?: string;
  amateur?: boolean;
  totalScore?: string;
  status: EspnPlayerStatus;
  rounds: EspnRound[];
}

export interface EspnGolfEvent {
  id: string;
  name: string;
  /** ESPN's own state for the whole event: 'pre' | 'in' | 'post'. */
  state: string;
  completed: boolean;
  /** Current round number for the tournament. */
  currentRound: number | null;
  course: EspnCourse | null;
  golfers: EspnGolfer[];
  warnings: string[];
}

async function getJson(url: string, timeoutMs = 12000): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Pick the event to show: one in progress beats an upcoming one beats a finished one. */
function pickEvent(events: any[]): any | null {
  if (!Array.isArray(events) || events.length === 0) return null;
  const byState = (state: string) => events.find((e) => e?.status?.type?.state === state);
  return byState('in') ?? byState('pre') ?? events[0];
}

function parseCourse(event: any): EspnCourse | null {
  const raw = Array.isArray(event?.courses) ? event.courses.find((c: any) => c?.host) ?? event.courses[0] : null;
  if (!raw) return null;
  return {
    id: String(raw.id ?? ''),
    name: raw.name ?? 'Course',
    shotsToPar: Number(raw.shotsToPar) || 72,
    totalYards: Number(raw.totalYards) || undefined,
    holes: Array.isArray(raw.holes)
      ? raw.holes.map((h: any) => ({
          number: Number(h.number),
          shotsToPar: Number(h.shotsToPar),
          totalYards: Number(h.totalYards) || undefined,
        }))
      : [],
    address: raw.address
      ? {
          city: raw.address.city,
          state: raw.address.state,
          country: raw.address.country,
          zipCode: raw.address.zipCode,
        }
      : undefined,
  };
}

/**
 * Per-hole scores live on the scoreboard feed, keyed by athlete id, then by
 * round period. Shape: competitor.linescores[roundIdx].linescores[holeIdx],
 * where `scoreType.displayValue` is that hole's own relative-to-par.
 */
function indexScoreboardHoles(scoreboard: any): Map<string, Map<number, EspnRound['holes']>> {
  const out = new Map<string, Map<number, EspnRound['holes']>>();
  const competitors: any[] = scoreboard?.events?.[0]?.competitions?.[0]?.competitors ?? [];

  for (const competitor of competitors) {
    const id = String(competitor?.id ?? '');
    if (!id) continue;

    const byRound = new Map<number, EspnRound['holes']>();
    for (const round of competitor.linescores ?? []) {
      const period = Number(round?.period);
      if (!Number.isFinite(period)) continue;

      const holes = (round.linescores ?? []).map((h: any) => ({
        hole: Number(h?.period),
        strokes: Number.isFinite(Number(h?.value)) ? Number(h.value) : null,
        relativeToPar:
          typeof h?.scoreType?.displayValue === 'string' ? h.scoreType.displayValue : null,
      }));
      if (holes.length > 0) byRound.set(period, holes);
    }
    if (byRound.size > 0) out.set(id, byRound);
  }
  return out;
}

/** Fetch and merge both ESPN golf feeds into one normalised event. */
export async function fetchGolfEvent(): Promise<EspnGolfEvent | null> {
  const warnings: string[] = [];

  const [leaderboard, scoreboard] = await Promise.all([
    getJson(LEADERBOARD_URL),
    getJson(SCOREBOARD_URL),
  ]);

  if (!leaderboard) {
    // Without the leaderboard we have no course and no live status at all.
    return null;
  }
  if (!scoreboard) {
    warnings.push('ESPN scoreboard feed unavailable — per-hole scores are missing this refresh.');
  }

  const event = pickEvent(leaderboard.events ?? []);
  if (!event) return null;

  /**
   * ESPN sends a competitor's score either as a plain value or as an object
   * carrying `displayValue`. Stringifying the object yields "[object Object]",
   * which then rides all the way into the player header.
   */
  const readScore = (score: unknown): string | undefined => {
    if (score == null) return undefined;
    if (typeof score === 'object') {
      const display = (score as { displayValue?: unknown }).displayValue;
      return display != null ? String(display) : undefined;
    }
    return String(score);
  };

  const competition = event.competitions?.[0];
  const competitors: any[] = competition?.competitors ?? [];
  const holeIndex = scoreboard ? indexScoreboardHoles(scoreboard) : new Map();

  const golfers: EspnGolfer[] = competitors.map((competitor) => {
    const id = String(competitor?.id ?? '');
    const holesByRound = holeIndex.get(id) ?? new Map<number, EspnRound['holes']>();

    const rounds: EspnRound[] = (competitor.linescores ?? []).map((round: any) => {
      const period = Number(round?.period);
      return {
        period,
        total: Number.isFinite(Number(round?.value)) ? Number(round.value) : null,
        displayValue: round?.displayValue,
        teeTime: round?.teeTime,
        holes: holesByRound.get(period) ?? [],
      };
    });

    return {
      id,
      name: competitor?.athlete?.displayName ?? competitor?.athlete?.fullName ?? 'Unknown',
      country: competitor?.athlete?.flag?.alt,
      // Prefer the inline URL — it's guaranteed valid for this record. Fall back
      // to the documented CDN pattern when the feed omits it.
      headshotUrl:
        competitor?.athlete?.headshot?.href ??
        (id ? `https://a.espncdn.com/i/headshots/golf/players/full/${id}.png` : undefined),
      flagUrl: competitor?.athlete?.flag?.href,
      amateur: Boolean(competitor?.amateur),
      totalScore: readScore(competitor?.score),
      status: (competitor?.status ?? {}) as EspnPlayerStatus,
      rounds,
    };
  });

  if (golfers.length > 0 && golfers.every((g) => g.rounds.every((r) => r.holes.length === 0))) {
    warnings.push('No per-hole scores available yet for this event.');
  }

  return {
    id: String(event.id ?? ''),
    name: event.name ?? 'PGA Tour',
    state: event?.status?.type?.state ?? 'unknown',
    completed: Boolean(event?.status?.type?.completed),
    currentRound: Number.isFinite(Number(competition?.status?.period))
      ? Number(competition.status.period)
      : null,
    course: parseCourse(event),
    golfers,
    warnings,
  };
}

/** Season stats for a single athlete, used by the player detail view. */
export async function fetchAthleteSeason(athleteId: string, season: number): Promise<any | null> {
  return getJson(ATHLETE_STATS_URL(athleteId, season));
}

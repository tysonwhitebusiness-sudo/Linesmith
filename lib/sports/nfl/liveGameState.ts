/**
 * Real live game state for NFL's Game Detail hero card — the football-shaped
 * equivalent of MLB's `BasesDiamond`/`InningStrip` (down & distance, field
 * position, clock, possession) rather than a baseball card wearing a
 * football label.
 *
 * Source: ESPN's public summary endpoint
 * (`site.api.espn.com/.../summary?event={id}`). `competitions[0].status`
 * (`period`, `displayClock`, `clock`, `type.state`) was live-verified this
 * session against a real scoreboard response. `competitions[0].situation`
 * (down/distance/yardLine/possession) is ESPN's own well-documented shape
 * but wasn't independently confirmed against a truly in-progress game this
 * session — none was live at build time (checked: only pre-kickoff preseason
 * games were available, whose `status.type.state` is `'pre'` and which carry
 * no `situation` object at all, consistent with it only appearing once a
 * game has live plays). Treat `situation` fields as real-but-unverified until
 * the first live NFL game confirms them against the actual broadcast.
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

export interface GameSituationStrip {
  state: 'pre' | 'in' | 'post';
  statusDetail: string;
  period: number | null;
  displayClock: string | null;
  down: number | null;
  distance: number | null;
  yardLine: number | null;
  possessionTeamId: string | null;
  isRedZone: boolean | null;
  homeScore: number | null;
  awayScore: number | null;
}

interface EspnCompetitor {
  id: string;
  homeAway: 'home' | 'away';
  score?: string;
}

interface EspnSummaryResponse {
  header?: {
    competitions?: Array<{
      status?: {
        type?: { state?: 'pre' | 'in' | 'post'; description?: string; shortDetail?: string; detail?: string };
        period?: number;
        displayClock?: string;
      };
      situation?: {
        down?: number;
        distance?: number;
        yardLine?: number;
        possession?: string;
        isRedZone?: boolean;
      };
      competitors?: EspnCompetitor[];
    }>;
  };
}

/**
 * Null when the game isn't actually live (pre-kickoff or final) — those
 * states are already well covered by the ordinary schedule/score cards, so
 * this only returns something for the one state that needs a dedicated
 * football-shaped live strip.
 */
export async function getNflLiveGameState(espnEventId: string): Promise<GameSituationStrip | null> {
  const res = await fetch(`${BASE}/summary?event=${espnEventId}`, { cache: 'no-store' });
  if (!res.ok) return null;

  const json = (await res.json()) as EspnSummaryResponse;
  const competition = json.header?.competitions?.[0];
  if (!competition) return null;

  const state = competition.status?.type?.state ?? 'pre';
  if (state !== 'in') return null;

  const situation = competition.situation;
  const home = competition.competitors?.find((c) => c.homeAway === 'home');
  const away = competition.competitors?.find((c) => c.homeAway === 'away');

  return {
    state,
    statusDetail: competition.status?.type?.shortDetail ?? competition.status?.type?.detail ?? competition.status?.type?.description ?? '',
    period: competition.status?.period ?? null,
    displayClock: competition.status?.displayClock ?? null,
    down: situation?.down ?? null,
    distance: situation?.distance ?? null,
    yardLine: situation?.yardLine ?? null,
    possessionTeamId: situation?.possession ?? null,
    isRedZone: situation?.isRedZone ?? null,
    homeScore: home?.score != null ? Number(home.score) : null,
    awayScore: away?.score != null ? Number(away.score) : null,
  };
}

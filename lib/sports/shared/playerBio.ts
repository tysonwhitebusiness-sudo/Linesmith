/**
 * Player bios from each league's own athlete endpoint — R6.1a.
 *
 * Pure functions of the raw JSON, tested on saved payloads
 * (`tests/player-research.test.ts`). The fetches are in `playerBioServer.ts`. The
 * three sources are the ones the G2 datasets were built from
 * (`docs/design/phase-g2/tools/build_player_data.py`), so the hero shows the
 * same identity the mockup does:
 *
 *   MLB     statsapi.mlb.com/api/v1/people/{id}?hydrate=currentTeam,rosterEntries
 *   NHL     api-web.nhle.com/v1/player/{id}/landing   (NHL ids, like the history)
 *   others  site.web.api.espn.com/apis/common/v3/sports/{path}/athletes/{id}
 *
 * INJURIES, measured 2026-09-15 before writing this:
 *   - ESPN puts them on `athlete.injuries[]` (status, date, details.type/detail,
 *     details.returnDate) and omits the key for a healthy player.
 *   - StatsAPI has no injury field on a person. The injured list is a ROSTER
 *     status: the active MLB-level `rosterEntries` row reads "Injured 60-Day"
 *     (codes D7/D10/D15/D60). A player rehabbing also has an active minor-league
 *     row ("Rehab Assignment"), which is why the MLB-level row is chosen by the
 *     absence of `parentOrgId`, not by being active.
 *   - NHL's landing has no injury data at all, so an NHL bio says nothing about
 *     injury rather than "healthy".
 */

import type { PlayerBio } from './playerResearchShapes';
import type { NhlPlayerLanding } from '@/lib/sports/nhl/apiWebParsers';

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function facts(pairs: Array<[string, string | null | undefined]>): PlayerBio['facts'] {
  return pairs.filter((p): p is [string, string] => typeof p[1] === 'string' && p[1] !== '').map(([label, value]) => ({ label, value }));
}

/** Whole years between an ISO birth date and `now`. */
export function ageOn(birthDate: string | null, now: Date): number | null {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1;
  return age;
}

function longDate(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null;
}

// ---------------------------------------------------------------------------
// MLB
// ---------------------------------------------------------------------------

export function parseMlbPerson(json: J | null, fetchedAt: string): PlayerBio | null {
  const p = json?.people?.[0];
  if (!p || p.id == null) return null;
  const entries: J[] = Array.isArray(p.rosterEntries) ? p.rosterEntries : [];
  // The MLB club's own row: active, and not an affiliate (affiliates carry parentOrgId).
  const club = entries.find((e) => e.isActive && e.team && e.team.parentOrgId == null);
  const rehab = entries.find((e) => e.isActive && e.team?.parentOrgId != null && /rehab/i.test(e.status?.description ?? ''));
  const statusCode = str(club?.status?.code);
  const injured = statusCode != null && /^D\d+$/.test(statusCode);
  // `currentTeam` is where he is playing today, which for a rehab assignment is
  // the affiliate (Clarke Schmidt came back as the Somerset Patriots). The
  // page is about his club, so the MLB-level roster row wins.
  const teamId = num(club?.team?.id) ?? num(p.currentTeam?.id);
  const teamName = club?.team ? str(club.team.name) : str(p.currentTeam?.name);
  const bats = str(p.batSide?.code);
  const throws = str(p.pitchHand?.code);
  return {
    athleteId: String(p.id),
    name: str(p.fullName) ?? String(p.id),
    jersey: str(club?.jerseyNumber) ?? str(p.primaryNumber),
    position: str(p.primaryPosition?.name),
    positionAbbr: str(club?.position?.abbreviation) ?? str(p.primaryPosition?.abbreviation),
    team: teamId != null
      ? { id: String(teamId), name: teamName, abbr: club?.team?.id === teamId ? str(club.team.abbreviation) : null, logoUrl: `https://www.mlbstatic.com/team-logos/${teamId}.svg` }
      : null,
    headshotUrl: `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_auto:best/v1/people/${p.id}/headshot/67/current`,
    age: num(p.currentAge),
    facts: facts([
      ['Bats / throws', bats && throws ? `${bats} / ${throws}` : null],
      ['Height / weight', [str(p.height), num(p.weight) != null ? `${p.weight} lbs` : null].filter(Boolean).join(', ') || null],
      ['Born', [longDate(str(p.birthDate)), [str(p.birthCity), str(p.birthStateProvince) ?? str(p.birthCountry)].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || null],
      ['MLB debut', longDate(str(p.mlbDebutDate))],
      ['Draft', num(p.draftYear) != null ? String(p.draftYear) : null],
    ]),
    injury: injured
      ? {
          status: str(club?.status?.description) ?? 'Injured list',
          detail: rehab ? `Rehab assignment with ${str(rehab.team?.name) ?? 'an affiliate'}` : null,
          date: str(club?.statusDate),
          returnDate: null,
        }
      : null,
    source: 'MLB Stats API',
    fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// ESPN (NFL, CFB, NBA, soccer, tennis, golf)
// ---------------------------------------------------------------------------

/** `football/nfl`, `soccer/eng.1`, `tennis/atp`, … */
export function parseEspnAthlete(json: J | null, espnPath: string, fetchedAt: string): PlayerBio | null {
  const a = json?.athlete;
  if (!a || a.id == null) return null;
  const team = a.team;
  const inj: J | undefined = Array.isArray(a.injuries) ? a.injuries[0] : undefined;
  const injDetail = [str(inj?.details?.type), str(inj?.details?.detail)].filter(Boolean).join(' · ') || str(inj?.shortComment);
  // Tennis athletes carry no `headshot` key, but ESPN serves one at the
  // standard path (checked: 200 for Alcaraz 3782). Soccer's path 404s, so it
  // is not guessed there; the avatar's silhouette covers a miss either way.
  const headshot = str(a.headshot?.href) ?? (espnPath.startsWith('tennis/') ? `https://a.espncdn.com/i/headshots/tennis/players/full/${a.id}.png` : null);
  const heightWeight = [str(a.displayHeight), str(a.displayWeight)].filter(Boolean).join(', ') || null;
  return {
    athleteId: String(a.id),
    name: str(a.displayName) ?? str(a.fullName) ?? String(a.id),
    jersey: str(a.jersey),
    position: str(a.position?.displayName),
    positionAbbr: str(a.position?.abbreviation),
    team: team && team.id != null
      ? { id: String(team.id), name: str(team.displayName), abbr: str(team.abbreviation), logoUrl: str(team.logos?.[0]?.href) }
      : null,
    headshotUrl: headshot,
    age: num(a.age),
    facts: facts([
      ['Plays', str(a.hand?.displayValue)],
      ['Height / weight', heightWeight],
      ['Born', [str(a.displayDOB), str(a.displayBirthPlace)].filter(Boolean).join(' · ') || null],
      ['Citizenship', str(a.citizenship)],
      ['Experience', str(a.displayExperience)],
      ['College', str(a.college?.name)],
      ['Draft', str(a.displayDraft)],
    ]),
    injury: inj
      ? {
          status: str(inj.status) ?? str(inj.type?.description) ?? 'Injured',
          detail: injDetail,
          date: str(inj.date),
          returnDate: str(inj.details?.returnDate),
        }
      : null,
    source: 'ESPN athlete API',
    fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// NHL
// ---------------------------------------------------------------------------

const NHL_POSITION: Record<string, string> = { C: 'Center', L: 'Left wing', R: 'Right wing', D: 'Defense', G: 'Goalie' };

export function bioFromNhlLanding(p: NhlPlayerLanding | null, now: Date, fetchedAt: string): PlayerBio | null {
  if (!p || p.playerId == null) return null;
  const inches = p.heightInches;
  const d = p.draft;
  return {
    athleteId: String(p.playerId),
    name: p.name ?? String(p.playerId),
    jersey: p.sweater != null ? String(p.sweater) : null,
    position: p.position ? NHL_POSITION[p.position] ?? p.position : null,
    positionAbbr: p.position,
    team: p.teamId != null ? { id: String(p.teamId), name: p.teamName, abbr: p.teamAbbr, logoUrl: p.teamLogo } : null,
    headshotUrl: p.headshot,
    age: ageOn(p.birthDate, now),
    facts: facts([
      [p.isGoalie ? 'Catches' : 'Shoots', p.shootsCatches],
      ['Height / weight', [inches != null ? `${Math.floor(inches / 12)}' ${inches % 12}"` : null, p.weightPounds != null ? `${p.weightPounds} lbs` : null].filter(Boolean).join(', ') || null],
      ['Born', [longDate(p.birthDate), p.birthPlace].filter(Boolean).join(' · ') || null],
      ['Draft', d && d.year != null ? `${d.year} · round ${d.round}, pick ${d.pickInRound} (${d.overallPick} overall) · ${d.teamAbbrev ?? ''}`.trim() : null],
    ]),
    injury: null,
    source: 'NHL api-web player landing',
    fetchedAt,
  };
}

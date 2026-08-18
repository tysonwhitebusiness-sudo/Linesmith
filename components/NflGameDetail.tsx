'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { PickCandidate } from '@/lib/core/types';
import { candidateKey } from '@/lib/core/types';
import type { UnifiedLinesResult, UnifiedGameLine } from '@/lib/odds/types';
import type { PickRow } from './useSlip';
import { SubjectAvatar, TeamLogo, nflTeamLogoUrl } from './SubjectAvatar';
import { StatRankRow, TwoSidedStatRankRow } from './StatRankRow';
import { OddsChip } from './OddsChip';
import { NflGameHeroCard, type NflGameHeroTeam } from './NflGameHeroCard';
import type { GameSituationStrip } from '@/lib/sports/nfl/liveGameState';
import type { TeamGrades } from '@/lib/sports/nfl/nflTeamGrades';
import type { PlayerSeasonStats } from '@/lib/sports/nfl/nflverse';
import { buildSlate, teamKey } from '@/lib/odds/matching';
import { formatAmerican } from '@/lib/odds/display';

interface NflvTeamStatLine {
  key: string;
  label: string;
  value: number;
  rank: number;
  decimals: number;
  group?: string;
}

interface RosterPlayer {
  subjectId: string;
  fullName: string;
  position: string | null;
  headshotUrl: string | null;
  seasonStats: PlayerSeasonStats | null;
}

interface RecentResult {
  gameId: string;
  gameday: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
}

interface TeamDetailApiResponse {
  team: { teamId: string; abbreviation: string; displayName: string; logoUrl: string | null; wins: number; losses: number };
  roster: RosterPlayer[];
  recentResults: RecentResult[];
  teamStats: NflvTeamStatLine[];
  opponentAbbr: string | null;
  grades: TeamGrades | null;
  candidates: { moneyline: PickCandidate | null; total: PickCandidate | null; teamTotal: PickCandidate | null };
}

interface GameMetaResponse {
  game: { gameId: string; date: string; homeTeamId: string; homeTeamName: string; homeAbbr: string; awayTeamId: string; awayTeamName: string; awayAbbr: string };
  homeInjuries: Array<{ playerName: string; teamName: string; status: string }>;
  awayInjuries: Array<{ playerName: string; teamName: string; status: string }>;
  liveState: GameSituationStrip | null;
  sportsGameOddsLine: UnifiedGameLine | null;
  warnings: string[];
}

function fmtRecord(w: number, l: number): string {
  return `${w}-${l}`;
}

function recordFrom(games: RecentResult[], abbr: string): { w: number; l: number } {
  let w = 0, l = 0;
  for (const g of games) {
    const isHome = g.homeTeam === abbr;
    const own = isHome ? g.homeScore : g.awayScore;
    const opp = isHome ? g.awayScore : g.homeScore;
    if (own == null || opp == null) continue;
    if (own > opp) w++; else l++;
  }
  return { w, l };
}

function GameTile({ g, abbr }: { g: RecentResult; abbr: string }) {
  const isHome = g.homeTeam === abbr;
  const oppAbbr = isHome ? g.awayTeam : g.homeTeam;
  const own = isHome ? g.homeScore : g.awayScore;
  const opp = isHome ? g.awayScore : g.homeScore;
  const won = own != null && opp != null && own > opp;
  return (
    <div className="flex min-w-[92px] flex-col items-center gap-1 rounded-lg border border-line/60 bg-card p-2 text-center">
      <TeamLogo logoUrl={nflTeamLogoUrl(oppAbbr)} size={20} />
      <span className="text-[10px] text-ink-muted">{isHome ? 'vs' : '@'} {oppAbbr}</span>
      <span className={`text-[12px] font-semibold ${won ? 'text-good' : 'text-bad'}`}>
        {own != null && opp != null ? `${won ? 'W' : 'L'} ${own}-${opp}` : '—'}
      </span>
    </div>
  );
}

function InjuryList({ rows }: { rows: Array<{ playerName: string; status: string }> }) {
  if (rows.length === 0) return <p className="p-3 text-center text-[11px] text-ink-faint">No reported injuries.</p>;
  return (
    <ul className="space-y-1 p-3">
      {rows.map((r) => (
        <li key={r.playerName} className="flex items-center justify-between text-[11.5px]">
          <span className="truncate">{r.playerName}</span>
          <span className="lb-chip bg-ink/5 text-[10px] text-ink-muted">{r.status}</span>
        </li>
      ))}
    </ul>
  );
}

const GRADE_ROWS: Array<{ key: keyof TeamGrades; label: string }> = [
  { key: 'offense', label: 'Offense' },
  { key: 'defense', label: 'Defense' },
  { key: 'specialTeams', label: 'Special teams' },
  { key: 'passingOffense', label: 'Passing offense' },
  { key: 'rushingOffense', label: 'Rushing offense' },
  { key: 'receivingOffense', label: 'Receiving offense' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'linebackers', label: 'Linebackers' },
  { key: 'dLine', label: 'D-line' },
];

function GradesTable({ away, home, awayAbbr, homeAbbr }: { away: TeamGrades | null; home: TeamGrades | null; awayAbbr: string; homeAbbr: string }) {
  return (
    <div className="overflow-hidden">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="border-b border-line px-2 py-1 text-left font-semibold text-ink-muted">Unit</th>
            <th className="border-b border-line px-2 py-1 text-right font-semibold text-ink-muted">{awayAbbr}</th>
            <th className="border-b border-line px-2 py-1 text-right font-semibold text-ink-muted">{homeAbbr}</th>
          </tr>
        </thead>
        <tbody>
          {GRADE_ROWS.map((row) => {
            const a = away?.[row.key] ?? null;
            const h = home?.[row.key] ?? null;
            return (
              <tr key={row.key} className="border-b border-line/50">
                <td className="px-2 py-1 text-left text-ink-muted">{row.label}</td>
                <td className="px-2 py-1 text-right font-semibold tabular-nums">{a ? `${a.grade}` : '—'}</td>
                <td className="px-2 py-1 text-right font-semibold tabular-nums">{h ? `${h.grade}` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PicksRow({
  candidate,
  label,
  picked,
  onAdd,
}: {
  candidate: PickCandidate | null;
  label: string;
  picked: boolean;
  onAdd?: (c: PickCandidate, oddsInfo?: { americanOdds: string; source: string }) => void;
}) {
  if (!candidate) return null;
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line/50 px-3 py-2 text-[12px] last:border-b-0">
      <span className="text-ink-muted">{label}</span>
      <div className="flex items-center gap-2">
        {candidate.odds ? <OddsChip price={candidate.odds.americanOdds} source={candidate.odds.source} capturedAt={candidate.odds.capturedAt} size="sm" /> : <span className="text-[10.5px] text-ink-faint">No price</span>}
        {onAdd ? (
          <button
            type="button"
            onClick={() => onAdd(candidate, candidate.odds ? { americanOdds: candidate.odds.americanOdds, source: candidate.odds.source } : undefined)}
            className="lb-btn-primary rounded-md bg-masters px-2 py-1 text-[10.5px] font-semibold text-white"
          >
            {picked ? 'On slip ✓' : 'Add'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export interface NflGameDetailProps {
  gameId: string;
  candidates: PickCandidate[];
  picks: PickRow[];
  pickedKeys: Set<string>;
  onAdd: (candidate: PickCandidate, oddsInfo?: { americanOdds: string; source: string }) => void;
  odds: UnifiedLinesResult | null;
}

export function NflGameDetail({ gameId, candidates, pickedKeys, onAdd, odds }: NflGameDetailProps) {
  const [meta, setMeta] = useState<GameMetaResponse | null>(null);
  const [home, setHome] = useState<TeamDetailApiResponse | null>(null);
  const [away, setAway] = useState<TeamDetailApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordsView, setRecordsView] = useState<'season' | 'l5' | 'h2h'>('season');

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setHome(null);
    setAway(null);
    setError(null);
    fetch(`/api/nfl/game/${gameId}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) { setError(json.detail ?? json.error); return; }
        setMeta(json);
        return Promise.all([
          fetch(`/api/nfl/team/${json.game.homeTeamId}`).then((r) => r.json()),
          fetch(`/api/nfl/team/${json.game.awayTeamId}`).then((r) => r.json()),
        ]).then(([h, a]) => {
          if (cancelled) return;
          if (!h.error) setHome(h);
          if (!a.error) setAway(a);
        });
      })
      .catch((err) => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [gameId]);

  const gameLine = useMemo(() => {
    if (!meta) return null;
    const fromSlate = odds?.lines
      ? odds.lines.find(
          (l) => teamKey(l.awayTeam) === teamKey(meta.game.awayTeamName) && teamKey(l.homeTeam) === teamKey(meta.game.homeTeamName),
        )
      : undefined;
    const sgo = meta.sportsGameOddsLine;
    if (!fromSlate) return sgo;
    if (!sgo) return fromSlate;
    return {
      ...fromSlate,
      moneyline: fromSlate.moneyline ?? sgo.moneyline,
      spread: fromSlate.spread ?? sgo.spread,
      total: fromSlate.total ?? sgo.total,
      bookCount: Math.max(fromSlate.bookCount, sgo.bookCount),
    };
  }, [meta, odds]);

  if (error) return <div className="lb-card border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</div>;
  if (!meta) {
    return (
      <div className="lb-card overflow-hidden">
        <div className="lb-skel h-24 w-full" />
      </div>
    );
  }

  const { game } = meta;
  const heroHome: NflGameHeroTeam = {
    abbr: game.homeAbbr,
    displayName: game.homeTeamName,
    wins: home?.team.wins ?? 0,
    losses: home?.team.losses ?? 0,
    grades: home?.grades ?? null,
  };
  const heroAway: NflGameHeroTeam = {
    abbr: game.awayAbbr,
    displayName: game.awayTeamName,
    wins: away?.team.wins ?? 0,
    losses: away?.team.losses ?? 0,
    grades: away?.grades ?? null,
  };

  const homeGroups = (g: string) => (home?.teamStats ?? []).filter((s) => s.group === g);
  const awayGroups = (g: string) => (away?.teamStats ?? []).filter((s) => s.group === g);
  const toStat = (s: NflvTeamStatLine) => ({ key: s.key, label: s.label, value: s.value, decimals: s.decimals, rank: s.rank, poolSize: 32 });

  const homeH2h = (home?.recentResults ?? []).filter((r) => r.homeTeam === game.awayAbbr || r.awayTeam === game.awayAbbr);
  const homeL5 = (home?.recentResults ?? []).slice(0, 5);
  const awayL5 = (away?.recentResults ?? []).slice(0, 5);
  const homeSeasonRecord = home ? { w: home.team.wins, l: home.team.losses } : { w: 0, l: 0 };
  const awaySeasonRecord = away ? { w: away.team.wins, l: away.team.losses } : { w: 0, l: 0 };
  const homeL5Record = recordFrom(homeL5, game.homeAbbr);
  const awayL5Record = recordFrom(awayL5, game.awayAbbr);
  const homeH2hRecord = recordFrom(homeH2h, game.homeAbbr);
  const awayH2hRecord = recordFrom(homeH2h, game.awayAbbr);

  return (
    <div className="space-y-3">
      <NflGameHeroCard home={heroHome} away={heroAway} kickoff={game.date} liveState={meta.liveState} gameLine={gameLine} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_280px] lg:items-start">
        <div className="min-w-0 space-y-3">
          {/* Records */}
          <section className="lb-card overflow-hidden">
            <div className="flex items-center justify-between gap-2 bg-accent-soft px-3 py-1.5">
              <h2 className="text-[10.5px] font-bold uppercase tracking-wide text-masters">Records</h2>
              <div className="flex gap-1">
                {(['season', 'l5', 'h2h'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setRecordsView(v)}
                    className={`rounded-md px-2 py-0.5 text-[10.5px] font-medium ${recordsView === v ? 'bg-masters text-white' : 'text-ink-muted hover:text-ink'}`}
                  >
                    {v === 'season' ? 'Season' : v === 'l5' ? 'Last 5' : 'H2H'}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 divide-x divide-line p-3 text-center">
              <div>
                <div className="mb-1 flex items-center justify-center gap-1.5"><TeamLogo logoUrl={nflTeamLogoUrl(game.awayAbbr)} size={18} /> {game.awayAbbr}</div>
                <p className="text-[16px] font-bold tabular-nums">
                  {recordsView === 'season' ? fmtRecord(awaySeasonRecord.w, awaySeasonRecord.l) : recordsView === 'l5' ? fmtRecord(awayL5Record.w, awayL5Record.l) : fmtRecord(awayH2hRecord.w, awayH2hRecord.l)}
                </p>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-center gap-1.5"><TeamLogo logoUrl={nflTeamLogoUrl(game.homeAbbr)} size={18} /> {game.homeAbbr}</div>
                <p className="text-[16px] font-bold tabular-nums">
                  {recordsView === 'season' ? fmtRecord(homeSeasonRecord.w, homeSeasonRecord.l) : recordsView === 'l5' ? fmtRecord(homeL5Record.w, homeL5Record.l) : fmtRecord(homeH2hRecord.w, homeH2hRecord.l)}
                </p>
              </div>
            </div>
            {recordsView === 'h2h' && homeH2h.length === 0 ? (
              <p className="px-3 pb-3 text-center text-[10.5px] text-ink-faint">No head-to-head meetings in the tracked window.</p>
            ) : null}
          </section>

          {/* Stat comparison */}
          <section className="lb-card overflow-hidden">
            <h2 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Stat comparison</h2>
            <div className="grid grid-cols-1 gap-4 p-3 sm:grid-cols-2">
              {['Scoring', 'Passing', 'Rushing', 'Receiving', 'Defense']
                .map((g) => ({ label: g, awayRows: awayGroups(g), homeRows: homeGroups(g) }))
                .filter((g) => g.awayRows.length > 0 || g.homeRows.length > 0)
                .map((g) => (
                  <div key={g.label}>
                    <div className="mb-1 text-center text-[9px] font-semibold uppercase tracking-wide text-ink-faint">{g.label}</div>
                    {g.homeRows.map((h) => {
                      const a = g.awayRows.find((x) => x.key === h.key);
                      return <TwoSidedStatRankRow key={h.key} label={h.label} subject={a ? toStat(a) : undefined} opponent={toStat(h)} />;
                    })}
                  </div>
                ))}
            </div>
          </section>

          {/* Last five games */}
          <section className="lb-card overflow-hidden">
            <h2 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Last five games</h2>
            <div className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-center text-[10px] text-ink-faint">{game.awayAbbr}</p>
                <div className="lb-scroll-x flex gap-1.5 overflow-x-auto">
                  {awayL5.length ? awayL5.map((g) => <GameTile key={g.gameId} g={g} abbr={game.awayAbbr} />) : <p className="p-2 text-[11px] text-ink-faint">No completed games yet.</p>}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-center text-[10px] text-ink-faint">{game.homeAbbr}</p>
                <div className="lb-scroll-x flex gap-1.5 overflow-x-auto">
                  {homeL5.length ? homeL5.map((g) => <GameTile key={g.gameId} g={g} abbr={game.homeAbbr} />) : <p className="p-2 text-[11px] text-ink-faint">No completed games yet.</p>}
                </div>
              </div>
            </div>
          </section>

          {/* Rankings / grades */}
          <section className="lb-card overflow-hidden">
            <h2 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Unit grades</h2>
            <GradesTable away={away?.grades ?? null} home={home?.grades ?? null} awayAbbr={game.awayAbbr} homeAbbr={game.homeAbbr} />
          </section>

          {/* Injuries */}
          <section className="lb-card overflow-hidden">
            <h2 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Injuries</h2>
            <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <div>
                <p className="px-3 pt-2 text-[10px] font-semibold text-ink-faint">{game.awayAbbr}</p>
                <InjuryList rows={meta.awayInjuries} />
              </div>
              <div>
                <p className="px-3 pt-2 text-[10px] font-semibold text-ink-faint">{game.homeAbbr}</p>
                <InjuryList rows={meta.homeInjuries} />
              </div>
            </div>
          </section>

          {/* Candidates for this game */}
          <section className="lb-card overflow-hidden">
            <h2 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">
              Props for this game ({candidates.length})
            </h2>
            {candidates.length === 0 ? (
              <p className="p-6 text-center text-[12px] text-ink-muted">No props tracked for this game yet.</p>
            ) : (
              <ul className="divide-y divide-line/60">
                {candidates.map((c) => (
                  <li key={candidateKey(c)}>
                    <Link
                      href={`/nfl/player/${encodeURIComponent(c.subjectId)}`}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-[12px] hover:bg-surface-subtle"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <SubjectAvatar name={c.subjectName} size={24} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{c.subjectName}</span>
                          <span className="block truncate text-[10.5px] text-ink-faint">{c.dimensionLabel}</span>
                        </span>
                      </span>
                      {c.odds ? <OddsChip price={c.odds.americanOdds} source={c.odds.source} capturedAt={c.odds.capturedAt} size="sm" /> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Rail */}
        <div className="space-y-3 lg:sticky lg:top-4">
          <section className="lb-card overflow-hidden">
            <h3 className="bg-accent-soft px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-masters">Game line</h3>
            {gameLine ? (
              <>
                <PicksRow
                  candidate={away?.candidates.moneyline ?? null}
                  label={`${game.awayAbbr} ML ${gameLine.moneyline?.away != null ? `(${formatAmerican(gameLine.moneyline.away)})` : ''}`}
                  picked={away?.candidates.moneyline ? pickedKeys.has(candidateKey(away.candidates.moneyline)) : false}
                  onAdd={onAdd}
                />
                <PicksRow
                  candidate={home?.candidates.moneyline ?? null}
                  label={`${game.homeAbbr} ML ${gameLine.moneyline?.home != null ? `(${formatAmerican(gameLine.moneyline.home)})` : ''}`}
                  picked={home?.candidates.moneyline ? pickedKeys.has(candidateKey(home.candidates.moneyline)) : false}
                  onAdd={onAdd}
                />
                <PicksRow
                  candidate={home?.candidates.total ?? null}
                  label={`Total ${gameLine.total?.point != null ? gameLine.total.point : ''}`}
                  picked={home?.candidates.total ? pickedKeys.has(candidateKey(home.candidates.total)) : false}
                  onAdd={onAdd}
                />
              </>
            ) : (
              <p className="p-3 text-center text-[11px] text-ink-faint">No game line for this matchup yet.</p>
            )}
          </section>

          {home?.candidates.moneyline || away?.candidates.moneyline ? (
            <section className="lb-card overflow-hidden p-3">
              <h3 className="mb-2 text-[10.5px] font-bold uppercase tracking-wide text-masters">Matchup</h3>
              <div className="space-y-1.5">
                {[...(homeGroups('Passing')), ...(homeGroups('Rushing'))].slice(0, 4).map((s) => (
                  <StatRankRow key={s.key} stat={toStat(s)} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default NflGameDetail;

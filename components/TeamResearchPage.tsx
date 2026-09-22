'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Avatar, Chip, Collapse, cx, DisclosureBar, ErrorState, ResultMark, Section, SectionNav, SegmentedToggle, Skeleton, Tooltip } from './ui';
import { useTeamColors } from './useTeamColors';
import { TeamLogo } from './SubjectAvatar';
import { bandColors, bandGradient, teamColor, type TeamColor } from '@/lib/sports/shared/teamColors';
import { asOfText, HeroTileGrid, rankLine, ResearchSectionBody, SourcesCard } from './PlayerResearchSections';
import { useTeamResearch } from './useTeamResearch';
import { ResearchFlags } from './ResearchFlags';
import { useTeamHistory } from './useTeamHistory';
import { useHeadToHead } from './useHeadToHead';
import { compareHeadToHeadCard } from '@/lib/history/headToHeadCards';
import { HISTORY_SPORTS, teamHistorySection } from '@/lib/history/teamHistorySection';
import { TeamCompareSection } from './TeamCompareSection';
import { useCompareTeams } from './usePlayerCompare';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useStickyHeaderHeight } from './useStickyHeaderHeight';
import type { TeamResearchData, TeamResearchPayload } from '@/lib/sports/shared/teamResearchShapes';
import { toTeamResearchData as toMlbTeamResearchData } from '@/lib/sports/mlb/adapters/teamDetailAdapter';
import type { MlbTeamResearchPayload } from '@/lib/sports/mlb/teamResearch';
import { toTeamResearchData as toNflTeamResearchData } from '@/lib/sports/nfl/adapters/teamDetailAdapter';
import { toTeamResearchData as toCfbTeamResearchData } from '@/lib/sports/cfb/adapters/teamDetailAdapter';
import type { FootballTeamResearchPayload } from '@/lib/sports/multiSport/footballTeamResearch';
import { toTeamResearchData as toNbaTeamResearchData } from '@/lib/sports/nba/adapters/teamDetailAdapter';
import { toTeamResearchData as toNhlTeamResearchData } from '@/lib/sports/nhl/adapters/teamDetailAdapter';
import type { HoopsHockeyTeamResearchPayload } from '@/lib/sports/multiSport/hoopsHockeyTeamResearch';
import { toTeamResearchData as toSoccerTeamResearchData } from '@/lib/sports/soccer/adapters/teamDetailAdapter';

function teamResearchFor(sport: string, payload: TeamResearchPayload, season: number | null): TeamResearchData | null {
  switch (sport) {
    case 'mlb':
      return toMlbTeamResearchData({ payload: payload as MlbTeamResearchPayload, season });
    case 'nfl':
      return toNflTeamResearchData({ payload: payload as FootballTeamResearchPayload, season });
    case 'cfb':
      return toCfbTeamResearchData({ payload: payload as FootballTeamResearchPayload, season });
    case 'nba':
      return toNbaTeamResearchData({ payload: payload as HoopsHockeyTeamResearchPayload, season });
    case 'nhl':
      return toNhlTeamResearchData({ payload: payload as HoopsHockeyTeamResearchPayload, season });
    case 'soccer_epl':
    case 'soccer_mls':
      return toSoccerTeamResearchData({ payload, season });
    default:
      return null;
  }
}

export interface TeamResearchPageProps {
  sport: string;
  teamId: number | string;
  /** Tells a host holding a loader over the pane that the first paint is ready. */
  onReadyChange?: (ready: boolean) => void;
}

export function TeamResearchPage({ sport, teamId, onReadyChange }: TeamResearchPageProps) {
  const research = useTeamResearch(sport, teamId);
  // C2b: the band's colours. Idle (null) for a league with no colour source.
  const teamColorIndex = useTeamColors(sport);
  const [season, setSeason] = useState<number | null>(null);
  useEffect(() => setSeason(null), [sport, teamId]);
  /**
   * Compare (R10.3) — the other team in the URL, and its payload from the same
   * route this page already uses. The hook idles on `null`, so it costs nothing
   * until a team is picked.
   */
  const comparePath = usePathname();
  const compareRouter = useRouter();
  const compareSearch = useSearchParams();
  const vsTeamId = compareSearch?.get('vs') ?? null;
  const otherResearch = useTeamResearch(sport, vsTeamId ?? undefined);
  const compareTeams = useCompareTeams(sport);
  const setCompareTeam = (next: string | null) => {
    const params = new URLSearchParams(compareSearch?.toString() ?? '');
    if (next) params.set('vs', next);
    else params.delete('vs');
    const q = params.toString();
    compareRouter.replace(`${comparePath}${q ? `?${q}` : ''}`, { scroll: false });
  };
  const stickyTop = useStickyHeaderHeight(true);

  const data = useMemo(() => (research.data ? teamResearchFor(sport, research.data, season) : null), [sport, research.data, season]);
  // R12b — every completed season held, from its own day-cached read; it does
  // not follow the season switch, and idles for a sport with no history.
  const history = useTeamHistory(HISTORY_SPORTS.has(sport) ? sport : undefined, teamId);
  // R12c — Compare's all-time head to head, from this team's side.
  const allTimeH2h = useHeadToHead(HISTORY_SPORTS.has(sport) ? sport : undefined, String(teamId), vsTeamId);
  const allTimeCard = useMemo(() => {
    if (!allTimeH2h.data || !data || !vsTeamId) return null;
    const theirs = otherResearch.data?.team;
    return compareHeadToHeadCard({
      history: allTimeH2h.data,
      team: { id: String(teamId), abbr: data.team.abbr, logoUrl: data.team.logoUrl ?? null },
      other: { id: vsTeamId, abbr: theirs?.abbr ?? 'Them', logoUrl: theirs?.logoUrl ?? null },
    });
  }, [allTimeH2h.data, data, vsTeamId, teamId, otherResearch.data]);
  const sections = useMemo(() => {
    if (!data) return [];
    const hist = teamHistorySection({ sport, teamAbbr: data.team.abbr, history: history.data, loading: history.loading, error: history.error });
    if (!hist) return data.sections;
    // Below Results, where the design puts it: the long view beside this season's.
    const at = data.sections.findIndex((x) => x.id === 'results');
    const out = [...data.sections];
    out.splice(at >= 0 ? at + 1 : out.length, 0, hist);
    return out;
  }, [data, sport, history.data, history.loading, history.error]);
  const ready = !research.loading;
  useEffect(() => onReadyChange?.(ready), [ready, onReadyChange]);

  const navItems = useMemo(
    () => [{ id: 'compare', label: 'Compare' }, ...sections.map((s) => ({ id: s.id, label: s.navLabel })), { id: 'sources', label: 'Sources' }],
    [sections],
  );

  if (research.error && !research.data) {
    return <ErrorState message={research.error} onRetry={research.reload} />;
  }
  if (!data) {
    return (
      <div className="space-y-4" aria-busy>
        <section className="rounded-card-hero border border-line-soft bg-card p-5 shadow-card">
          <div className="flex items-center gap-4">
            <Skeleton w={88} h={88} round="rounded-xl" />
            <div className="space-y-2">
              <Skeleton w={220} h={24} />
              <Skeleton w={160} h={14} />
            </div>
          </div>
          <div className="mt-4 border-t border-line-soft pt-4">
            <Skeleton h={40} />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TeamHero data={data} colors={data.team ? teamColor(teamColorIndex, { id: data.team.id, abbr: data.team.abbr ?? null }) : null} />
      {/* F0 — this team's players on today's slate, and the game itself where
          the ranking is about the game (a park, a forecast). */}
      <ResearchFlags sport={sport} who={{ team: String(teamId) }} title="Flags today" showSubject />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-overline uppercase text-ink-muted">Season</span>
        <SegmentedToggle label="Season" size="sm" value={data.scope.season} onChange={setSeason} options={data.scope.options} />
        <span className="text-label text-ink-secondary">
          {data.scope.reason ? `${data.scope.reason} ` : ''}Every section below follows this switch.
        </span>
      </div>
      <SectionNav items={navItems} top={stickyTop} label="Team sections" />
      {/* Compare sits FIRST on a team page, where the G2 spec puts it. */}
      {research.data ? (
        <Section id="compare" title="Compare" sub="this team against another">
          <TeamCompareSection
            payload={research.data}
            allTeams={compareTeams}
            season={data.scope.season}
            other={otherResearch.data}
            otherLoading={otherResearch.loading}
            vsTeamId={vsTeamId}
            onTeam={setCompareTeam}
            allTime={allTimeCard}
          />
        </Section>
      ) : null}
      {sections.map((sec) => (
        <Section key={sec.id} id={sec.id} title={sec.title} sub={sec.sub}>
          <ResearchSectionBody section={sec} onSeason={setSeason} />
        </Section>
      ))}
      <Section id="sources" title="Sources">
        <SourcesCard items={data.sources.map((s) => ({ label: s.label, detail: `${s.detail} · ${asOfText(s.asOf)}` }))} />
      </Section>
    </div>
  );
}

const TEAM_HERO_PEEK_KEY = 'lb.teamHeroPeekSeen';

/**
 * The team hero — C2b, the same rework as the player hero (C2): the team's
 * colour band with its crest as the watermark, the crest itself hanging
 * below the band where the player's headshot does, a chip row, the next game
 * on the right, and a summary bar over the ranked tiles and the last ten.
 * All data; no sport is named here.
 */
function TeamHero({ data, colors }: { data: TeamResearchData; colors: TeamColor | null }) {
  const { team, hero, scope } = data;
  const band = bandColors(colors);
  const [open, setOpen] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const bodyId = 'team-hero-body';
  const firstRanked = hero.tiles.find((t) => t.rank);
  return (
    <section aria-label={team.name} className="overflow-hidden rounded-card-hero border border-line-soft bg-card shadow-card">
      <div className="relative flex min-h-[150px] flex-wrap items-end gap-5 overflow-hidden px-6 pb-[18px] pt-5 text-white min-[900px]:flex-nowrap" style={{ background: bandGradient(band) }}>
        {team.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={team.logoUrl} alt="" aria-hidden className="pointer-events-none absolute -right-[30px] -top-10 size-[260px] object-contain opacity-[.14]" />
        ) : null}
        <div className="relative z-[1] min-[900px]:-mb-11">
          {/* The crest takes the headshot's circular 3px ring (C0.3) on the same
              translucent disc, so the team colour reads through behind the mark
              exactly as it does behind the player's photo. */}
          <span className="hidden min-[900px]:block">
            <Avatar kind="logo" label={team.name} src={team.logoUrl ?? undefined} size={132} ring decorative className="rounded-full border-transparent" />
          </span>
          <span className="min-[900px]:hidden">
            <Avatar kind="logo" label={team.name} src={team.logoUrl ?? undefined} size={96} ring decorative className="rounded-full border-transparent" />
          </span>
        </div>
        <div className="relative z-[1] min-w-0 flex-1">
          <h1 className="text-display text-white">{team.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {hero.standing ? (
              band.accent ? (
                <span className="rounded-full px-[9px] py-[3px] text-label font-semibold" style={{ background: band.accent.bg, color: band.accent.ink }}>
                  {hero.standing}
                </span>
              ) : (
                <Chip tone="onColor">{hero.standing}</Chip>
              )
            ) : null}
            <Chip tone="onColor">
              {hero.record} {hero.recordShape}
            </Chip>
          </div>
        </div>
        <div className="relative z-[1] w-full text-body-sm min-[900px]:w-auto min-[900px]:text-right">
          {hero.next ? (
            <>
              <div className="text-overline uppercase text-white/70">{hero.next.live ? 'Live' : 'Next'}</div>
              <div className="flex items-center gap-2 text-body font-semibold min-[900px]:justify-end">
                <span>{hero.next.homeAway ?? '@'}</span>
                {hero.next.opponent.logoUrl ? <TeamLogo logoUrl={hero.next.opponent.logoUrl} size={26} /> : null}
                {hero.next.href ? (
                  <Link href={hero.next.href} className="underline-offset-2 hover:underline">
                    {hero.next.opponent.name}
                  </Link>
                ) : (
                  <span>{hero.next.opponent.name}</span>
                )}
              </div>
              <div className="text-white/80">{hero.next.when}</div>
            </>
          ) : (
            <div className="text-white/70">No upcoming game on the schedule</div>
          )}
        </div>
      </div>
      {/* The bio line's place under the band: what the team page knows that the tiles do not. */}
      <dl className="flex min-h-3 flex-wrap gap-x-[18px] gap-y-1.5 px-6 py-3 text-body-sm text-ink-secondary min-[900px]:min-h-12 min-[900px]:pl-[176px]">
        {team.venue ? (
          <div className="flex gap-1">
            <dt>Home</dt>
            <dd className="font-semibold text-ink">{team.venue}</dd>
          </div>
        ) : null}
        {scope.reason ? <div className="text-ink-muted">{scope.reason}</div> : null}
      </dl>

      <DisclosureBar
        label={<>{scope.label} &amp; form</>}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        controls={bodyId}
        nudge={peeking}
        summary={
          <>
            <span>
              <b className="text-body tabular-nums text-ink">{hero.record}</b> {hero.recordShape}
            </span>
            {firstRanked?.rank ? (
              <span>
                <b className="text-body tabular-nums text-ink">{firstRanked.value}</b> {firstRanked.label}
                <span className="ml-1 text-label font-semibold text-good-ink">{rankLine(firstRanked.rank)}</span>
              </span>
            ) : null}
            {hero.lastTen.length ? (
              <span aria-hidden className="flex gap-[3px]">
                {hero.lastTen.map((g, i) => (
                  <i key={i} className={cx('size-2 rounded-[2px]', g.result === 'W' ? 'bg-good' : g.result === 'D' ? 'bg-line' : 'bg-bad')} />
                ))}
              </span>
            ) : null}
          </>
        }
      />
      <Collapse open={open} id={bodyId} peek={TEAM_HERO_PEEK_KEY} onPeek={setPeeking} className={cx('border-t', open ? 'border-line-soft' : 'border-transparent')}>
        <div className="grid grid-cols-1 min-[900px]:grid-cols-[minmax(0,1fr)_300px]">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-3.5">
              <span className="text-overline uppercase text-ink-muted">{scope.label}</span>
            </div>
            <HeroTileGrid tiles={hero.tiles} />
          </div>
          {hero.lastTen.length ? (
            <div className="border-t border-line-soft px-5 py-4 min-[900px]:border-l min-[900px]:border-t-0">
              <div className="text-overline uppercase text-ink-muted">Last {hero.lastTen.length}</div>
              <ul className="mt-3 flex flex-col gap-1.5">
                {hero.lastTen.map((g, i) => (
                  <li key={i} className="grid grid-cols-[22px_26px_minmax(0,1fr)_auto] items-center gap-2 text-body-sm">
                    <Tooltip content={g.tip}>
                      <span>
                        <ResultMark result={g.result === 'OTL' ? 'L' : g.result} label={g.tip} />
                      </span>
                    </Tooltip>
                    {g.opponentLogo ? <Avatar kind="logo" label={g.opponent ?? ''} src={g.opponentLogo} size={22} decorative /> : <span />}
                    <span className="truncate text-ink">{g.opponent}</span>
                    <span className="tabular-nums text-ink-secondary">{g.result === 'OTL' ? `OTL ${g.line ?? ''}` : g.line}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Collapse>
    </section>
  );
}

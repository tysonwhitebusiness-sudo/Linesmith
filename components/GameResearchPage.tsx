'use client';

import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Avatar, Chip, ErrorState, Section, SectionNav, SegmentedToggle, Skeleton, cx } from './ui';
import { asOfText, ResearchSectionBody, SourcesCard } from './PlayerResearchSections';
import { useGameResearch } from './useGameResearch';
import { useStickyHeaderHeight } from './useStickyHeaderHeight';
import type { GameResearchData, GameResearchPayload, GameSide, GameState } from '@/lib/sports/shared/gameResearchShapes';
import { toGameResearchData as toMlbGameResearchData } from '@/lib/sports/mlb/adapters/gameDetailAdapter';
import type { MlbGameResearchPayload } from '@/lib/sports/mlb/gameResearch';
import { toGameResearchData as toNflGameResearchData } from '@/lib/sports/nfl/adapters/gameDetailAdapter';
import { toGameResearchData as toCfbGameResearchData } from '@/lib/sports/cfb/adapters/gameDetailAdapter';
import type { FootballGameResearchPayload } from '@/lib/sports/multiSport/footballGameResearch';
import { toGameResearchData as toSoccerGameResearchData } from '@/lib/sports/soccer/adapters/gameDetailAdapter';
import type { SoccerGameResearchPayload } from '@/lib/sports/soccer/gameResearch';
import { toGameResearchData as toTennisGameResearchData } from '@/lib/sports/tennis/adapters/gameDetailAdapter';
import type { TennisGameResearchPayload } from '@/lib/sports/tennis/gameResearch';

/**
 * The game page — R8. One component for every sport: a hero with the score,
 * the line score and the closing-line chips; a state bar (the game's real state,
 * with a review switch to the kickoff research once it has begun); section nav;
 * the sections the sport's adapter builds for that state; sources.
 *
 * Which adapter runs is decided once, in `gameResearchFor`; nothing below it
 * knows the sport.
 */

export const GAME_RESEARCH_SPORTS = ['mlb', 'nfl', 'cfb', 'soccer_epl', 'soccer_mls', 'tennis_atp', 'tennis_wta'] as const;

function gameResearchFor(sport: string, payload: GameResearchPayload, requestedState: string | null): GameResearchData | null {
  switch (sport) {
    case 'mlb':
      return toMlbGameResearchData({ payload: payload as MlbGameResearchPayload, requestedState });
    case 'nfl':
      return toNflGameResearchData({ payload: payload as FootballGameResearchPayload, requestedState });
    case 'cfb':
      return toCfbGameResearchData({ payload: payload as FootballGameResearchPayload, requestedState });
    case 'soccer_epl':
    case 'soccer_mls':
      return toSoccerGameResearchData({ payload: payload as SoccerGameResearchPayload, requestedState });
    case 'tennis_atp':
    case 'tennis_wta':
      return toTennisGameResearchData({ payload: payload as TennisGameResearchPayload, requestedState });
    default:
      return null;
  }
}

const STATE_LABEL: Record<GameState, string> = { pre: 'Before start', live: 'Live', final: 'Final', postponed: 'Postponed' };

export interface GameResearchPageProps {
  sport: string;
  gameId: string;
  onReadyChange?: (ready: boolean) => void;
}

export function GameResearchPage({ sport, gameId, onReadyChange }: GameResearchPageProps) {
  const research = useGameResearch(sport, gameId);
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = search?.get('state') ?? null;
  const stickyTop = useStickyHeaderHeight(true);

  const data = useMemo(() => (research.data ? gameResearchFor(sport, research.data, requested) : null), [sport, research.data, requested]);
  const ready = !research.loading || research.data != null;
  useEffect(() => onReadyChange?.(ready), [ready, onReadyChange]);
  const navItems = useMemo(() => [...(data?.sections ?? []).map((s) => ({ id: s.id, label: s.navLabel })), { id: 'sources', label: 'Sources' }], [data]);

  const setState = (next: GameState) => {
    const params = new URLSearchParams(search?.toString() ?? '');
    if (next === research.data?.state) params.delete('state');
    else params.set('state', next);
    const q = params.toString();
    router.replace(`${pathname}${q ? `?${q}` : ''}`, { scroll: false });
  };

  if (research.error && !research.data) return <ErrorState message={research.error} onRetry={research.reload} />;
  if (!data) {
    return (
      <section className="rounded-card-hero border border-line-soft bg-card p-5 shadow-card" aria-busy>
        <div className="flex items-center justify-between gap-4">
          <Skeleton w={200} h={56} />
          <Skeleton w={120} h={40} />
          <Skeleton w={200} h={56} />
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <GameHero data={data} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-overline uppercase text-ink-muted">Game state</span>
        {data.states.length > 1 ? (
          <SegmentedToggle label="Game state" size="sm" value={data.state} onChange={setState} options={data.states.map((s) => ({ value: s, label: STATE_LABEL[s] }))} />
        ) : (
          <Chip>{STATE_LABEL[data.state]}</Chip>
        )}
        <span className="text-label text-ink-secondary">{data.stateNote}</span>
      </div>
      <SectionNav items={navItems} top={stickyTop} label="Game sections" />
      {data.sections.map((sec) => (
        <Section key={sec.id} id={sec.id} title={sec.title} sub={sec.sub}>
          <ResearchSectionBody section={sec} onSeason={() => {}} />
        </Section>
      ))}
      <Section id="sources" title="Sources">
        <SourcesCard items={data.sources.map((s) => ({ label: s.label, detail: `${s.detail} · ${asOfText(s.asOf)}` }))} />
      </Section>
    </div>
  );
}

function TeamSide({ side, home }: { side: GameSide; home?: boolean }) {
  const name = side.href ? (
    <Link href={side.href} className="text-heading text-ink underline-offset-2 hover:underline">
      {side.name}
    </Link>
  ) : (
    <span className="text-heading text-ink">{side.name}</span>
  );
  return (
    <div className={cx('flex min-w-0 items-center gap-3', home && 'flex-row-reverse text-right')}>
      <Avatar kind="logo" label={side.name} src={side.logoUrl ?? undefined} size={56} decorative />
      <div className="min-w-0">
        <div className="truncate">{name}</div>
        <div className="text-label text-ink-muted">
          {[side.record, side.sideLabel === undefined ? (home ? 'Home' : 'Away') : side.sideLabel].filter(Boolean).join(' · ')}
        </div>
      </div>
      {side.score != null ? <div className="px-2 text-display tabular-nums text-ink">{side.score}</div> : null}
    </div>
  );
}

function GameHero({ data }: { data: GameResearchData }) {
  const { hero } = data;
  const ls = hero.lineScore;
  return (
    <section aria-label={`${hero.away.name} at ${hero.home.name}`} className="rounded-card-hero border border-line-soft bg-card p-5 shadow-card">
      <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <TeamSide side={hero.away} />
        <div className="text-center">
          <Chip tone={data.state === 'live' ? 'good' : undefined}>{hero.statusText}</Chip>
          <h1 className="mt-1.5 text-body-sm font-semibold text-ink">{hero.when}</h1>
          {hero.place ? <div className="text-label text-ink-muted">{hero.place}</div> : null}
          {hero.notes.length ? <div className="mt-1 text-label text-ink-secondary">{hero.notes.join(' · ')}</div> : null}
        </div>
        <TeamSide side={hero.home} home />
      </div>
      {ls ? (
        <div className="mt-4 overflow-x-auto border-t border-line-soft pt-3">
          <table className="mx-auto text-body-sm tabular-nums">
            <caption className="sr-only">Line score</caption>
            <thead>
              <tr className="text-label text-ink-muted">
                <th className="px-2 text-left font-normal" scope="col" />
                {ls.periods.map((p) => (
                  <th key={p} className="w-7 px-1 text-center font-normal" scope="col">
                    {p}
                  </th>
                ))}
                {ls.totals.map((t) => (
                  <th key={t} className="w-9 px-1 text-center font-semibold text-ink-secondary" scope="col">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {([
                [hero.away.abbr, ls.away],
                [hero.home.abbr, ls.home],
              ] as const).map(([abbr, row]) => (
                <tr key={abbr}>
                  <th className="px-2 text-left font-semibold text-ink" scope="row">
                    {abbr}
                  </th>
                  {row.map((v, i) => (
                    <td key={i} className={cx('px-1 text-center', i >= ls.periods.length ? 'font-semibold text-ink' : 'text-ink-secondary')}>
                      {v ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {hero.chips.length ? (
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {hero.chips.map((c) => (
            <Chip key={c.label}>{c.label}</Chip>
          ))}
        </div>
      ) : null}
    </section>
  );
}

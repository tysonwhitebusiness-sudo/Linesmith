'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Avatar, cx, ErrorState, Section, SectionNav, SegmentedToggle, Skeleton } from './ui';
import { asOfText, ResearchSectionBody, SourcesCard } from './PlayerResearchSections';
import { useTeamResearch } from './useTeamResearch';
import { useStickyHeaderHeight } from './useStickyHeaderHeight';
import type { TeamResearchData, TeamResearchPayload } from '@/lib/sports/shared/teamResearchShapes';
import { toTeamResearchData as toMlbTeamResearchData } from '@/lib/sports/mlb/adapters/teamDetailAdapter';
import type { MlbTeamResearchPayload } from '@/lib/sports/mlb/teamResearch';
import { toTeamResearchData as toNflTeamResearchData } from '@/lib/sports/nfl/adapters/teamDetailAdapter';
import { toTeamResearchData as toCfbTeamResearchData } from '@/lib/sports/cfb/adapters/teamDetailAdapter';
import type { FootballTeamResearchPayload } from '@/lib/sports/multiSport/footballTeamResearch';

/**
 * The team page — R7. One component for every sport: a hero with the record
 * and standing, ONE season switch that scopes every section below it, then the
 * sections the sport's adapter builds (results & schedule, standings, team
 * stats, roster production, the sport's own), then sources.
 *
 * Which adapter runs is decided once, in `teamResearchFor`, the way
 * `PlayerDetail` picks a sport's `toPlayerResearchData`; nothing below it
 * knows the sport.
 */

export const TEAM_RESEARCH_SPORTS = ['mlb', 'nfl', 'cfb'] as const;

function teamResearchFor(sport: string, payload: TeamResearchPayload, season: number | null): TeamResearchData | null {
  switch (sport) {
    case 'mlb':
      return toMlbTeamResearchData({ payload: payload as MlbTeamResearchPayload, season });
    case 'nfl':
      return toNflTeamResearchData({ payload: payload as FootballTeamResearchPayload, season });
    case 'cfb':
      return toCfbTeamResearchData({ payload: payload as FootballTeamResearchPayload, season });
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
  const [season, setSeason] = useState<number | null>(null);
  useEffect(() => setSeason(null), [sport, teamId]);
  const stickyTop = useStickyHeaderHeight(true);

  const data = useMemo(() => (research.data ? teamResearchFor(sport, research.data, season) : null), [sport, research.data, season]);
  const ready = !research.loading;
  useEffect(() => onReadyChange?.(ready), [ready, onReadyChange]);

  const navItems = useMemo(() => [...(data?.sections ?? []).map((s) => ({ id: s.id, label: s.navLabel })), { id: 'sources', label: 'Sources' }], [data]);

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
      <TeamHero data={data} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-overline uppercase text-ink-muted">Season</span>
        <SegmentedToggle label="Season" size="sm" value={data.scope.season} onChange={setSeason} options={data.scope.options} />
        <span className="text-label text-ink-secondary">
          {data.scope.reason ? `${data.scope.reason} ` : ''}Every section below follows this switch.
        </span>
      </div>
      <SectionNav items={navItems} top={stickyTop} label="Team sections" />
      {data.sections.map((sec) => (
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

function TeamHero({ data }: { data: TeamResearchData }) {
  const { team, hero, scope } = data;
  return (
    <section aria-label={team.name} className="rounded-card-hero border border-line-soft bg-card p-5 shadow-card">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar kind="logo" label={team.name} src={team.logoUrl ?? undefined} size={88} decorative />
          <div className="min-w-0">
            <h1 className="text-heading text-ink">{team.name}</h1>
            <div className="mt-1 text-body-sm text-ink-secondary">{[hero.standing, team.venue].filter(Boolean).join(' · ')}</div>
            {hero.lastTen.length ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-overline uppercase text-ink-muted">Last {hero.lastTen.length}</span>
                <span className="flex flex-wrap gap-1">
                  {hero.lastTen.map((g, i) => (
                    <span
                      key={i}
                      title={g.tip}
                      className={cx(
                        'grid h-6 min-w-6 place-items-center rounded-ctl px-1 text-label font-semibold',
                        g.result === 'W' ? 'bg-good/12 text-good' : g.result === 'D' ? 'bg-card-sunk text-ink-secondary' : 'bg-bad/10 text-bad',
                      )}
                    >
                      {g.result}
                    </span>
                  ))}
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <div className="lg:border-l lg:border-line-soft lg:pl-5">
          <div className="text-overline uppercase text-ink-muted">{scope.label}</div>
          <div className="mt-0.5 text-title tabular-nums text-ink">
            {hero.record} <span className="text-label font-normal text-ink-muted">{hero.recordShape}</span>
          </div>
          {hero.next ? (
            <div className="mt-3 flex items-center gap-2.5">
              <Avatar kind="logo" label={hero.next.opponent.name} src={hero.next.opponent.logoUrl ?? undefined} size={32} decorative />
              <div className="min-w-0">
                {hero.next.href ? (
                  <Link href={hero.next.href} className="text-body-sm font-semibold text-ink underline-offset-2 hover:underline">
                    {hero.next.label}
                  </Link>
                ) : (
                  <div className="text-body-sm font-semibold text-ink">{hero.next.label}</div>
                )}
                <div className="text-label text-ink-muted">{hero.next.when}</div>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-label text-ink-muted">No upcoming game on the schedule</div>
          )}
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line-soft pt-4 sm:grid-cols-4 lg:grid-cols-8">
        {hero.tiles.map((t) => (
          <div key={t.label} title={t.info}>
            <dt className="truncate text-overline uppercase text-ink-muted">{t.label}</dt>
            <dd className="mt-0.5 text-title tabular-nums text-ink">{t.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

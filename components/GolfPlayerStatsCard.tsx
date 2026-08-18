'use client';

import { useState } from 'react';
import type { AdvancedStat, AdvancedStatCategory, GolferStrokesGained } from '@/lib/sports/golf/pgatourStats';
import type { PlayerSeasonLog } from '@/lib/sports/golf/playerSeason';
import { StatRankRow } from './StatRankRow';
import { ordinal, type OpposingStarterStat } from './PlayerDetail';
import { SegmentedToggle } from './SegmentedToggle';
import { SubjectAvatar } from './SubjectAvatar';

/**
 * A bar whose length was this golfer's own rank-percentile reads, at a
 * glance, like it's tracking raw stat magnitude instead — two stats with
 * similar rank can carry wildly different underlying numbers, and the
 * color ramp compounds that (rank 60/164 vs 90/164 land on visually
 * unrelated hues). This is a plot instead: a track spanning the field's
 * actual worst-to-best value range for that stat, a tick for the tour
 * average, and this golfer's headshot placed at their actual number's
 * position in that range — so position now means "where their number
 * literally falls," not an abstracted rank transform.
 */
function GolfStatRangeRow({
  stat,
  headshotUrl,
  name,
}: {
  stat: AdvancedStat;
  headshotUrl?: string;
  name: string;
}) {
  if (stat.value == null || stat.rank == null) return null;

  // The field range isn't available for every row (see the SG:Total
  // synthetic row below, sourced from a different fetch than the other 19
  // stats) — falls back to the plain rank bar rather than dropping the row.
  if (stat.bestValue == null || stat.worstValue == null || stat.bestValue === stat.worstValue) {
    const fallback: OpposingStarterStat = { key: stat.key, label: stat.label, value: stat.value, decimals: stat.decimals, rank: stat.rank, poolSize: stat.poolSize };
    return <StatRankRow stat={fallback} />;
  }

  const span = stat.bestValue - stat.worstValue;
  const pctOf = (v: number) => Math.max(0, Math.min(100, ((v - stat.worstValue!) / span) * 100));
  const playerPct = pctOf(stat.value);
  const avgPct = stat.avgValue != null ? pctOf(stat.avgValue) : null;

  return (
    <div className="py-1">
      <div className="flex items-center justify-between text-[9px] uppercase tracking-wide text-ink-faint">
        <span className="truncate">{stat.label}</span>
        <span className="shrink-0 tabular-nums" title={`${stat.rank} of ${stat.poolSize}`}>
          {ordinal(stat.rank)} of {stat.poolSize}
        </span>
      </div>

      {/* Tour-average number sits directly above its tick, this golfer's
          number directly below their dot — same %-left as the marker it
          labels (not a fixed left/center/right row), so which number
          belongs to which mark is never ambiguous. */}
      <div className="relative mx-2.5 h-3">
        {avgPct != null ? (
          <span
            className="absolute -translate-x-1/2 whitespace-nowrap text-[8px] font-medium text-ink-faint"
            style={{ left: `${avgPct}%` }}
          >
            {stat.avgValue!.toFixed(stat.decimals)}
          </span>
        ) : null}
      </div>
      <div className="relative mx-2.5 h-4">
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-gradient-to-r from-bad/35 via-line-hair to-good/45" />
        {avgPct != null ? (
          <span
            className="absolute top-1/2 h-3 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-faint"
            style={{ left: `${avgPct}%` }}
            title={`Tour average: ${stat.avgValue!.toFixed(stat.decimals)}`}
          />
        ) : null}
        <div
          className="absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border-2 border-card shadow-card"
          style={{ left: `${playerPct}%` }}
          title={`${name}: ${stat.value.toFixed(stat.decimals)}`}
        >
          <SubjectAvatar name={name} headshotUrl={headshotUrl} size={14} />
        </div>
      </div>
      <div className="relative mx-2.5 h-3">
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold tabular-nums text-ink"
          style={{ left: `${playerPct}%` }}
        >
          {stat.value.toFixed(stat.decimals)}
        </span>
      </div>

      <div className="mx-2.5 mt-0.5 flex items-center justify-between text-[9px] tabular-nums text-ink-faint">
        <span>{stat.worstValue.toFixed(stat.decimals)}</span>
        <span>{stat.bestValue.toFixed(stat.decimals)}</span>
      </div>
    </div>
  );
}

const CATEGORY_TABS: Array<{ key: AdvancedStatCategory; label: string }> = [
  { key: 'strokesGained', label: 'SG' },
  { key: 'driving', label: 'Driving' },
  { key: 'approach', label: 'Approach' },
  { key: 'shortGame', label: 'Short Game' },
  { key: 'putting', label: 'Putting' },
  { key: 'scoring', label: 'Scoring' },
  { key: 'rankings', label: 'Rankings' },
];

export function GolfPlayerStatsCard({
  name,
  headshotUrl,
  strokesGained,
  seasonLog,
  advancedStats,
  loading,
}: {
  /** Golfer identity for the range-plot rows' headshot dot — falls back to initials via SubjectAvatar when there's no photo. */
  name: string;
  headshotUrl?: string;
  strokesGained: GolferStrokesGained | null;
  seasonLog: PlayerSeasonLog | null;
  advancedStats: AdvancedStat[];
  loading: boolean;
}) {
  const [tab, setTab] = useState<AdvancedStatCategory>('strokesGained');

  if (loading && !strokesGained && !seasonLog && advancedStats.length === 0) {
    return <div className="lb-card h-32 animate-pulse" />;
  }

  const recentEvents = (seasonLog?.events ?? []).slice(-8).reverse();

  // SG:Total comes from the season-strokes-gained fetch (already used for the
  // Strokes Gained header everywhere else in the app), not `advancedStats` —
  // merged into the SG tab here so all 5 strokes-gained components sit
  // together instead of Total living somewhere else. No field range comes
  // with it (that fetch only ever carried this one golfer's row), so it
  // always renders through GolfStatRangeRow's plain-bar fallback.
  const sgTotalRow: AdvancedStat | null =
    strokesGained && strokesGained.avgPerRound != null
      ? {
          key: 'sgTotal',
          label: 'SG: Total',
          category: 'strokesGained',
          value: strokesGained.avgPerRound,
          decimals: 2,
          rank: strokesGained.rank,
          poolSize: strokesGained.poolSize,
          bestValue: null,
          worstValue: null,
          avgValue: null,
        }
      : null;

  const tabRows: AdvancedStat[] = [
    ...(tab === 'strokesGained' && sgTotalRow ? [sgTotalRow] : []),
    ...advancedStats.filter((s) => s.category === tab && s.value != null && s.rank != null),
  ];

  return (
    <div className="lb-card lb-card-interactive space-y-3 p-3">
      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          Advanced stats · {new Date().getFullYear()} season
        </h3>

        <div className="lb-scroll-x mb-3 overflow-x-auto">
          <SegmentedToggle
            options={CATEGORY_TABS}
            value={tab}
            onChange={setTab}
            className="w-max rounded-lg border border-line p-0.5 text-[11px]"
            buttonClassName="whitespace-nowrap rounded-md px-2.5 py-1"
            gliderClassName="rounded-md"
          />
        </div>

        {tabRows.length === 0 ? (
          <p className="text-[12px] text-ink-faint">
            {loading ? 'Loading…' : 'No PGA Tour data matched to this golfer yet for this category.'}
          </p>
        ) : (
          <div className="space-y-2.5">
            {tabRows.map((r) => (
              <GolfStatRangeRow key={r.key} stat={r} name={name} headshotUrl={headshotUrl} />
            ))}
          </div>
        )}

        <p className="mt-2 text-[10px] text-ink-faint">Source: pgatour.com official stats, not a documented API — see /diagnostics for freshness.</p>
      </div>

      <div className="border-t border-line-soft pt-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Recent tournaments</h3>
        {recentEvents.length === 0 ? (
          <p className="text-[12px] text-ink-faint">No tournament history found for this golfer this season.</p>
        ) : (
          <ul className="divide-y divide-line">
            {recentEvents.map((e) => (
              <li key={e.eventId} className="flex items-center justify-between py-1.5 text-[12px]">
                <span className="min-w-0 truncate text-ink">{e.eventName}</span>
                <span className="ml-2 flex shrink-0 items-center gap-2 tabular-nums">
                  <span className={e.madeCut ? 'text-ink-muted' : 'text-ink-faint'}>{e.madeCut ? e.position : 'CUT'}</span>
                  <span className="text-ink-faint">{e.scoreDisplay}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default GolfPlayerStatsCard;

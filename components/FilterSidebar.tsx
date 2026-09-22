'use client';

import { useState, type ReactNode } from 'react';
import type { SlateGame } from '@/lib/odds/matching';
import { ChevronDownIcon, PeopleIcon, ShieldIcon, TargetIcon, BarsIcon, FlameIcon, SlidersIcon, SnowflakeIcon, CheckCircleIcon } from './icons';
import { Button } from './ui';
import { FilterDropdown, CheckboxList, BooleanCheckboxRow, FilterOddsRangeInputs, HitRatePicker, FilterSelect } from './FilterBar';
import { GameMatchupLabel } from './SubjectAvatar';

/**
 * The Redesign Brief's alternate filter layout: the same underlying filter
 * state as the button row, just relocated into a collapsible left sidebar
 * with accordion sections. Team/Market/Hit-rate reuse FilterDropdown's exact
 * popover (via its `fullWidth` variant) rather than a second implementation,
 * so switching between button-row and sidebar can never leave the two modes
 * disagreeing about what's selected.
 *
 * The approved mockup's sidebar has three sections (Player, Performance,
 * Odds range) and doesn't include a Games section at all — added here as a
 * fourth section since dropping the Games filter entirely while the sidebar
 * is open would be a real functionality regression, not just a visual one.
 */

function AccordionSection({
  icon,
  title,
  defaultOpen = true,
  children,
}: {
  icon: ReactNode;
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-5">
      <Button variant="tertiary" size="md" onPress={() => setOpen(!open)} className="mb-3 w-full justify-between">
        <span className="flex items-center gap-2 text-body font-semibold text-ink">
          {icon}
          {title}
        </span>
        <ChevronDownIcon className={`text-ink-muted transition-transform ${open ? '' : '-rotate-90'}`} />
      </Button>
      {open ? <div className="flex flex-col gap-2.5">{children}</div> : null}
    </div>
  );
}

export interface FilterSidebarProps {
  games: SlateGame[];
  gamePks: Set<number>;
  onToggleGame: (gamePk: number) => void;
  onClearGames: () => void;

  marketOptions: Array<{ value: string; label: string }>;
  dimensions: Set<string>;
  onToggleDimension: (d: string) => void;
  onClearDimensions: () => void;

  teamOptions: Array<{ value: string; label: string; icon?: ReactNode }>;
  teams: Set<string>;
  onToggleTeam: (t: string) => void;
  onClearTeams: () => void;

  bookOptions?: Array<{ value: string; label: string }>;
  sportsbook?: string | null;
  onSetSportsbook?: (v: string | null) => void;

  hitRateMin: number | null;
  onSetHitRateMin: (v: number | null) => void;

  hotStreak: boolean;
  coldStreak: boolean;
  consistentOnly: boolean;
  onToggleHotStreak: () => void;
  onToggleColdStreak: () => void;
  onToggleConsistentOnly: () => void;

  oddsMin: number | null;
  oddsMax: number | null;
  onSetOddsRange: (min: number | null, max: number | null) => void;
  showNoOdds: boolean;
  onToggleShowNoOdds: () => void;
}

export function FilterSidebar({
  games,
  gamePks,
  onToggleGame,
  onClearGames,
  marketOptions,
  dimensions,
  onToggleDimension,
  onClearDimensions,
  teamOptions,
  teams,
  onToggleTeam,
  onClearTeams,
  bookOptions,
  sportsbook,
  onSetSportsbook,
  hitRateMin,
  onSetHitRateMin,
  hotStreak,
  coldStreak,
  consistentOnly,
  onToggleHotStreak,
  onToggleColdStreak,
  onToggleConsistentOnly,
  oddsMin,
  oddsMax,
  onSetOddsRange,
  showNoOdds,
  onToggleShowNoOdds,
}: FilterSidebarProps) {
  return (
    <aside className="w-[260px] shrink-0 border-r border-line bg-card px-4 py-5">
      <AccordionSection icon={<PeopleIcon size={16} />} title="Games">
        <CheckboxList
          options={games.map((g) => ({
            value: String(g.gamePk ?? ''),
            label: <GameMatchupLabel label={g.matchup ?? ''} awayTeamId={g.awayTeamId} homeTeamId={g.homeTeamId} />,
          }))}
          selected={new Set([...gamePks].map(String))}
          onToggle={(v) => onToggleGame(Number(v))}
          onClear={onClearGames}
        />
      </AccordionSection>

      <AccordionSection icon={<ShieldIcon size={16} />} title="Player">
        <FilterDropdown icon={<ShieldIcon size={14} />} label="Team" badge={teams.size > 0 ? teams.size : undefined} active={teams.size > 0} fullWidth>
          <CheckboxList options={teamOptions} selected={teams} onToggle={onToggleTeam} onClear={onClearTeams} />
        </FilterDropdown>
        <FilterDropdown icon={<BarsIcon size={14} />} label="Market" badge={dimensions.size > 0 ? dimensions.size : undefined} active={dimensions.size > 0} fullWidth>
          <CheckboxList options={marketOptions} selected={dimensions} onToggle={onToggleDimension} onClear={onClearDimensions} />
        </FilterDropdown>
        {bookOptions && bookOptions.length > 1 && onSetSportsbook ? (
          <FilterSelect label="Book" value={sportsbook ?? ''} onChange={(v) => onSetSportsbook(v || null)} options={bookOptions} />
        ) : null}
        <FilterDropdown icon={<TargetIcon size={14} />} label="Hit rate" badge={hitRateMin != null ? `≥${hitRateMin}%` : undefined} active={hitRateMin != null} fullWidth>
          <HitRatePicker value={hitRateMin} onChange={onSetHitRateMin} />
        </FilterDropdown>
      </AccordionSection>

      <AccordionSection icon={<FlameIcon size={16} />} title="Performance">
        <BooleanCheckboxRow label="Hot streak" checked={hotStreak} onChange={onToggleHotStreak} icon={<FlameIcon size={14} className="text-ink-muted" />} />
        <BooleanCheckboxRow label="Cold streak" checked={coldStreak} onChange={onToggleColdStreak} icon={<SnowflakeIcon size={14} className="text-ink-muted" />} />
        <BooleanCheckboxRow label="Consistent" checked={consistentOnly} onChange={onToggleConsistentOnly} icon={<CheckCircleIcon size={14} className="text-ink-muted" />} />
      </AccordionSection>

      <AccordionSection icon={<SlidersIcon size={16} />} title="Odds range">
        <FilterOddsRangeInputs min={oddsMin} max={oddsMax} onChange={onSetOddsRange} />
        <BooleanCheckboxRow label="Show players with no odds" checked={showNoOdds} onChange={onToggleShowNoOdds} />
      </AccordionSection>
    </aside>
  );
}

export default FilterSidebar;

/**
 * The R3 design-system primitives — one of each (research-pages plan §R3 3b).
 *
 * New and rebuilt cards (R6–R8) compose these instead of hand-rolling a
 * header, toggle, chip, table or empty state. Rules they encode, enforced by
 * `tests/ui-primitives.test.ts`: no hand-typed `text-[Npx]` sizes, no color
 * literals outside the shared palette, and no text lighter than `ink-muted`.
 */
export { cx } from './cx';
export { Tooltip, TipRow, type TooltipProps } from './Tooltip';
export { Skeleton, SkeletonLines, EmptyState, ErrorState, type EmptyStateProps, type ErrorStateProps } from './States';
export { Card, type CardProps, type CardState } from './Card';
export { SegmentedToggle, Tabs, SelectBox, type Option } from './Controls';
export { Chip, StatusPill, type ChipProps, type ChipTone, type ChipSize, type ChipShape } from './Chip';
export { Avatar, type AvatarProps } from './Avatar';
export { StatValue, StatGrid, RankRow, LeagueStripRow, FactList, VizLegend, goodness, percentileColor, ordinal, type StatDirection, type StatValueProps, type RankRowProps } from './Stats';
export { DataTable, type Column, type DataTableProps } from './DataTable';
export { DrillDownPanel, type DrillDownPanelProps } from './DrillDownPanel';
export { Section, SectionNav } from './Section';
export { BackLink, useUrlState } from './Navigation';

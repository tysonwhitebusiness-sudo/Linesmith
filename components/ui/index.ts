/**
 * The R3 design-system primitives — one of each (research-pages plan §R3 3b).
 *
 * New and rebuilt cards (R6–R8) compose these instead of hand-rolling a
 * header, toggle, chip, table or empty state. Rules they encode, enforced by
 * `tests/ui-primitives.test.ts`: no hand-typed `text-[Npx]` sizes, no color
 * literals outside the shared palette, and no text lighter than `ink-muted`.
 */
export { cx } from './cx';
export { Button, IconButton, CloseButton, iconPx, type ButtonProps, type IconButtonProps, type ButtonVariant, type ButtonSize } from './Button';
export { Tooltip, TipRow, type TooltipProps } from './Tooltip';
export { Skeleton, SkeletonLines, EmptyState, ErrorState, type EmptyStateProps, type ErrorStateProps } from './States';
export { Card, type CardProps, type CardState } from './Card';
export { SegmentedToggle, Tabs, SelectBox, type Option } from './Controls';
export {
  Field,
  Input,
  Textarea,
  Checkbox,
  RadioGroup,
  Toggle,
  Select,
  ComboBox,
  PickList,
  FileTrigger,
  SearchIcon,
  FIELD_TEXT,
  type FieldProps,
  type InputProps,
  type TextareaProps,
  type FieldSize,
  type SelectOption,
  type SelectProps,
  type ComboBoxProps,
  type PickItem,
} from './Fields';
export { Chip, StatusPill, type ChipProps, type ChipTone, type ChipSize, type ChipShape } from './Chip';
export { Avatar, type AvatarProps } from './Avatar';
export { Tag, AvatarLabel, AvatarGroup, FeaturedIcon, type TagProps, type AvatarLabelProps, type AvatarGroupProps, type FeaturedIconProps, type FeaturedIconTone } from './Pieces';
export { StatValue, StatGrid, RankRow, LeagueStripRow, FactList, VizLegend, goodness, percentileColor, ordinal, type StatDirection, type StatValueProps, type RankRowProps } from './Stats';
export { DataTable, type Column, type DataTableProps, type Density, type HeatSpec } from './DataTable';
export { Pagination, type PaginationProps, type PagingOptions, type PagingMode } from './Pagination';
export { DrillDownPanel, type DrillDownPanelProps } from './DrillDownPanel';
export {
  Modal,
  SlideoutMenu,
  Dropdown,
  Popover,
  type ModalProps,
  type ModalWidth,
  type SlideoutMenuProps,
  type DropdownItem,
  type DropdownSection,
} from './Overlays';
export { Section, SectionNav } from './Section';
export { BackLink, useUrlState } from './Navigation';

/**
 * R3: the chip moved to the design-system primitives (`components/ui/Chip.tsx`).
 * This file re-exports it so the existing callers use the one implementation
 * rather than a second recipe. New code imports from `@/components/ui`.
 */
export { Chip, StatusPill, type ChipProps, type ChipTone, type ChipSize, type ChipShape } from './ui/Chip';
export { default } from './ui/Chip';

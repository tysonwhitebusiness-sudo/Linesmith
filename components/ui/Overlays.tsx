'use client';

/*
 * Adapted from Untitled UI React (`components/application/modals`,
 * `slideout-menus`, `base/dropdown`), github.com/untitleduico/react
 * @ c981a73bcd6b6c68d2a54070f20f020191212828, MIT. Rewritten to our tokens,
 * our type ramp, our sizes and our `cx`.
 */

import type { ReactNode } from 'react';
import {
  Dialog,
  DialogTrigger,
  Heading,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Modal as AriaModal,
  ModalOverlay,
  Popover as AriaPopover,
  Separator,
  Header as AriaHeader,
} from 'react-aria-components';
import { CloseButton } from './Button';
import { cx } from './cx';

/**
 * U4 — overlays. A page never hand-builds a scrim, a focus trap or a portal
 * again (U spec §4).
 *
 * All four are React Aria's, which is the point: focus moves in on open and
 * back to the opener on close, Tab stays inside, Escape and the scrim close,
 * the page behind stops scrolling, and each announces as what it is — a
 * dialog or a menu. The hand-built versions this replaced each re-implemented
 * a subset of that, differently (the slip had no focus trap at all; the
 * account menu had no Escape).
 *
 * Motion is `smooth` in and `quick` out; reduced motion turns the moving ones
 * into a fade (`.lb-overlay-move` in globals.css).
 */

/**
 * Ink at 40%, no blur (§4). An exiting scrim takes no clicks: React Aria keeps
 * it mounted until its exit animation reports finished, and in a throttled tab
 * that report can lag well behind the fade.
 */
const SCRIM = 'fixed inset-0 z-[80] bg-ink/40 data-entering:animate-lb-fade-in data-exiting:animate-lb-fade-out data-exiting:pointer-events-none';

/* ---------------------------------------------------------------- Modal */

export type ModalWidth = 400 | 560 | 720;

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** A `FeaturedIcon` above the title. */
  icon?: ReactNode;
  /** 400 · 560 · 720 from 768px up. Below 768px a Modal is a bottom sheet. */
  width?: ModalWidth;
  /** Buttons: right-aligned on desktop, stacked full-width on a phone. */
  footer?: ReactNode;
  /** Extra header controls beside the close button (e.g. a Clear link). */
  headerExtra?: ReactNode;
  children: ReactNode;
}

const MODAL_W: Record<ModalWidth, string> = { 400: 'md:max-w-[400px]', 560: 'md:max-w-[560px]', 720: 'md:max-w-[720px]' };

export function Modal({ isOpen, onClose, title, description, icon, width = 560, footer, headerExtra, children }: ModalProps) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()} isDismissable className={cx(SCRIM, 'flex items-end justify-center md:items-center md:p-4')}>
      <AriaModal
        className={cx(
          'lb-overlay-move flex max-h-[90dvh] w-full flex-col overflow-hidden bg-paper shadow-pop outline-hidden',
          // Bottom sheet below 768: full width, top corners only, slides up.
          'rounded-t-[16px] data-entering:animate-lb-sheet-in data-exiting:animate-lb-sheet-out',
          'md:max-h-[85vh] md:rounded-[16px] md:data-entering:animate-lb-pop-in md:data-exiting:animate-lb-pop-out',
          MODAL_W[width],
        )}
      >
        <Dialog className="flex min-h-0 flex-1 flex-col outline-hidden">
          <header className="flex items-start gap-3 border-b border-line px-4 py-3">
            {icon ? <span className="shrink-0">{icon}</span> : null}
            <div className="min-w-0 flex-1">
              <Heading slot="title" className="text-title text-ink">
                {title}
              </Heading>
              {description ? <p className="mt-0.5 text-body-sm text-ink-muted">{description}</p> : null}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {headerExtra}
              <CloseButton size="sm" onPress={onClose} aria-label="Close" />
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
          {footer ? (
            <footer className="flex flex-col-reverse gap-2 border-t border-line p-4 md:flex-row md:justify-end [&>*]:w-full md:[&>*]:w-auto">{footer}</footer>
          ) : null}
        </Dialog>
      </AriaModal>
    </ModalOverlay>
  );
}

/* ---------------------------------------------------------------- SlideoutMenu */

export interface SlideoutMenuProps {
  isOpen: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Default 560 (DrillDownPanel's). Full width below 768px. */
  width?: number;
  footer?: ReactNode;
  children: ReactNode;
}

/** A right-edge panel: header, a scrolling body, an optional sticky footer. */
export function SlideoutMenu({ isOpen, onClose, title, subtitle, width = 560, footer, children }: SlideoutMenuProps) {
  return (
    <ModalOverlay isOpen={isOpen} onOpenChange={(o) => !o && onClose()} isDismissable className={SCRIM}>
      <AriaModal
        style={{ width: `min(${width}px, 100vw)` }}
        className="lb-overlay-move fixed inset-y-0 right-0 z-[90] flex flex-col bg-card shadow-pop outline-hidden data-entering:animate-lb-slide-in data-exiting:animate-lb-slide-out"
      >
        <Dialog className="flex min-h-0 flex-1 flex-col outline-hidden">
          <div className="flex min-h-[60px] items-center gap-2 border-b border-line py-3 pl-6 pr-3">
            <div className="min-w-0 flex-1">
              <Heading slot="title" className="truncate text-title text-ink">
                {title}
              </Heading>
              {subtitle ? <div className="truncate text-label text-ink-muted">{subtitle}</div> : null}
            </div>
            <CloseButton onPress={onClose} aria-label="Close" />
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-6">{children}</div>
          {footer ? <div className="border-t border-line p-4">{footer}</div> : null}
        </Dialog>
      </AriaModal>
    </ModalOverlay>
  );
}

/* ---------------------------------------------------------------- Dropdown */

export interface DropdownItem {
  id: string;
  label: ReactNode;
  /** Plain text for typeahead when `label` is not a string. */
  textValue?: string;
  icon?: ReactNode;
  shortcut?: string;
  onAction: () => void;
  isDisabled?: boolean;
}

export interface DropdownSection {
  id: string;
  /** An `overline` header; omit for an unlabelled group. */
  title?: string;
  items: DropdownItem[];
}

/**
 * A menu of actions from a trigger. `trigger` must be a kit Button (React
 * Aria wires the press and `aria-expanded` into it). Sections are separated;
 * a section with a `title` gets an overline header. Min width 240.
 */
export function Dropdown({
  trigger,
  sections,
  label,
  header,
  placement = 'bottom end',
}: {
  trigger: ReactNode;
  sections: DropdownSection[];
  label: string;
  /** Static text above the items — who is signed in, say. Not an item. */
  header?: ReactNode;
  placement?: 'bottom end' | 'bottom start';
}) {
  return (
    <MenuTrigger>
      {trigger}
      <AriaPopover
        placement={placement}
        offset={6}
        className="min-w-60 rounded-[8px] bg-card p-1 shadow-pop ring-1 ring-line-soft outline-hidden data-entering:animate-lb-fade-in data-exiting:animate-lb-fade-out"
      >
        {header ? <div className="truncate px-2 py-1.5 text-label text-ink-muted">{header}</div> : null}
        <Menu aria-label={label} className="outline-hidden">
          {sections.map((s, i) => (
            <MenuSection key={s.id} id={s.id}>
              {i > 0 ? <Separator className="my-1 h-px bg-line-soft" /> : null}
              {s.title ? <AriaHeader className="px-2 pb-1 pt-1.5 text-overline uppercase text-ink-muted">{s.title}</AriaHeader> : null}
              {s.items.map((it) => (
                <MenuItem
                  key={it.id}
                  id={it.id}
                  textValue={it.textValue ?? (typeof it.label === 'string' ? it.label : it.id)}
                  onAction={it.onAction}
                  isDisabled={it.isDisabled}
                  className="flex h-9 cursor-pointer items-center gap-2 rounded-ctl px-2 text-body-sm font-medium text-ink-secondary outline-hidden data-disabled:cursor-not-allowed data-disabled:opacity-50 data-focused:bg-card-sunk data-focused:text-ink"
                >
                  {it.icon ? <span className="flex shrink-0 text-ink-muted">{it.icon}</span> : null}
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.shortcut ? <kbd className="shrink-0 font-sans text-label text-ink-muted">{it.shortcut}</kbd> : null}
                </MenuItem>
              ))}
            </MenuSection>
          ))}
        </Menu>
      </AriaPopover>
    </MenuTrigger>
  );
}

/* ---------------------------------------------------------------- Popover */

/**
 * Non-modal content from a trigger — a small form, a legend, a note. `trigger`
 * must be a kit Button. Dismisses on Escape and outside press; focus returns.
 */
export function Popover({ trigger, label, children, placement = 'bottom start' }: { trigger: ReactNode; label: string; children: ReactNode; placement?: 'bottom start' | 'bottom end' | 'top start' }) {
  return (
    <DialogTrigger>
      {trigger}
      <AriaPopover
        placement={placement}
        offset={6}
        className="max-w-[min(360px,calc(100vw-32px))] rounded-[8px] bg-card p-3 shadow-pop ring-1 ring-line-soft outline-hidden data-entering:animate-lb-fade-in data-exiting:animate-lb-fade-out"
      >
        <Dialog aria-label={label} className="outline-hidden">
          {children}
        </Dialog>
      </AriaPopover>
    </DialogTrigger>
  );
}

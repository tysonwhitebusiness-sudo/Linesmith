'use client';

import { createContext, createElement, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ValueChange } from '../ui';
import { advance, marketOfKey, rowOf, type LiveDiff, type OddsSnapshotKeys } from '@/lib/odds/section/liveDiff';

/**
 * The live layer's memory for one odds section (odds build P9 §3). The hooks
 * in `useOdds.ts` feed each refresh's keys in; `lib/odds/section/liveDiff.ts`
 * says what changed; this remembers it long enough to animate — a value's
 * trail (2 min), a new move's "just now" (2 min), what changed since the page
 * opened, and what each market tab has not been looked at since. Pure state:
 * no fetching (the hooks do that), no rendering beyond the provider.
 */
export const FLASH_CAP = 12;
const TRAIL_MS = 120_000;
const MOVE_NEW_MS = 120_000;

interface Seen { at: number }

export interface LiveTracker {
  /** Whether keys are the game payload's (`fg_sp` → period + market) or a player's. */
  game: boolean;
  openedAt: number;
  /** When the newest diff arrived; null before the second refresh. */
  diffAt: number | null;
  diff: LiveDiff;
  change(key: string): ValueChange | null;
  /** Changed (or pulled) since the page opened: the header's outline. */
  recent(key: string): boolean;
  rowState(row: string): { state: 'pulled' | 'returned' | 'new'; at: number } | null;
  sinceOpened: { changed: number; pulled: number };
  showRecent: boolean;
  toggleRecent(): void;
  /** Changes in a market (`period|market`) since its tab was last looked at. */
  newIn(market: string): number;
  look(market: string): void;
  /** When a move (`book|period|market|at`) arrived on this page, if within 2 minutes. */
  moveSeen(key: string): number | null;
  /** The newest diff's time, if it touched this market (`period|market`): the card's ping. */
  pingFor(market: string): number | null;
  /** More than 12 values changed in this market (every line) in the newest diff. Cards cap on what they SHOW (PriceBoard). */
  capped(market: string): boolean;
}

export const STILL: LiveTracker = {
  game: false, openedAt: 0, diffAt: null, diff: { changes: [], pulled: [], returned: [], added: [], newMoves: [] },
  change: () => null, recent: () => false, rowState: () => null, sinceOpened: { changed: 0, pulled: 0 }, showRecent: false,
  toggleRecent: () => {}, newIn: () => 0, look: () => {}, moveSeen: () => null, pingFor: () => null, capped: () => false,
};

interface Store {
  snap: OddsSnapshotKeys | null;
  diff: LiveDiff;
  diffAt: number | null;
  changes: Map<string, ValueChange>;
  log: { market: string; at: number }[];
  recentChanged: Set<string>;
  recentPulled: Set<string>;
  rows: Map<string, { state: 'pulled' | 'returned' | 'new'; at: number }>;
  moves: Map<string, number>;
  looked: Map<string, number>;
}

const fresh = (): Store => ({ snap: null, diff: STILL.diff, diffAt: null, changes: new Map(), log: [], recentChanged: new Set(),
  recentPulled: new Set(), rows: new Map(), moves: new Map(), looked: new Map() });

/** Owns one section's store; `push` each refresh's keys, `reset` when the page's subject changes. */
export function useLiveTracker(game: boolean): { tracker: LiveTracker; push: (keys: OddsSnapshotKeys) => void; reset: () => void } {
  const store = useRef<Store>(fresh());
  const opened = useRef<number>(0);
  if (!opened.current) opened.current = Date.now();
  const [version, setVersion] = useState(0);
  const [showRecent, setShowRecent] = useState(false);

  const push = useCallback((keys: OddsSnapshotKeys) => {
    const s = store.current;
    const before = s.snap?.rows ?? null;
    const { diff, snap } = advance(s.snap, keys);
    s.snap = snap;
    if (!s.diffAt && !diff.changes.length && !diff.pulled.length && !diff.returned.length && !diff.added.length && !diff.newMoves.length) {
      // The first payload, or a refresh with nothing new: no re-render needed beyond the data's own.
      s.diff = diff;
      return;
    }
    const at = Date.now();
    s.diff = diff;
    s.diffAt = at;
    for (const c of diff.changes) {
      s.changes.set(c.key, { dir: c.dir, seenAt: at });
      s.recentChanged.add(c.key);
      s.log.push({ market: marketOfKey(c.key), at });
    }
    for (const k of diff.pulled) { s.rows.set(rowOf(k), { state: 'pulled', at }); s.recentPulled.add(k); }
    for (const k of diff.returned) { s.rows.set(rowOf(k), { state: 'returned', at }); s.recentPulled.delete(k); }
    // A NEW row is a book that was not on the board at all before — not a book posting another alt line.
    for (const r of new Set(diff.added.map(rowOf))) if (before && !before.has(r) && !s.rows.has(r)) s.rows.set(r, { state: 'new', at });
    for (const k of diff.newMoves) s.moves.set(k, at);
    // Forget what no longer animates.
    for (const [k, v] of s.changes) if (at - v.seenAt > TRAIL_MS) s.changes.delete(k);
    for (const [k, v] of s.moves) if (at - v > MOVE_NEW_MS) s.moves.delete(k);
    for (const [k, v] of s.rows) if (v.state !== 'pulled' && at - v.at > MOVE_NEW_MS) s.rows.delete(k);
    if (s.log.length > 5000) s.log.splice(0, s.log.length - 5000);
    setVersion(v => v + 1);
  }, []);

  const reset = useCallback(() => { store.current = fresh(); opened.current = Date.now(); setVersion(v => v + 1); }, []);

  const tracker = useMemo<LiveTracker>(() => {
    const s = store.current;
    const perMarket = new Map<string, number>();
    for (const c of s.diff.changes) { const m = marketOfKey(c.key); perMarket.set(m, (perMarket.get(m) ?? 0) + 1); }
    const touched = new Set([...s.diff.changes.map(c => c.key), ...s.diff.pulled, ...s.diff.returned, ...s.diff.added].map(k => marketOfKey(k)));
    for (const k of s.diff.newMoves) touched.add(marketOfKey(k, 'move'));
    return {
      game,
      openedAt: opened.current,
      diffAt: s.diffAt,
      diff: s.diff,
      change: key => s.changes.get(key) ?? null,
      recent: key => s.recentChanged.has(key) || s.recentPulled.has(key),
      rowState: row => s.rows.get(row) ?? null,
      sinceOpened: { changed: s.recentChanged.size, pulled: s.recentPulled.size },
      showRecent,
      toggleRecent: () => setShowRecent(v => !v),
      newIn: market => {
        const since = s.looked.get(market) ?? opened.current;
        let n = 0;
        for (let i = s.log.length - 1; i >= 0 && s.log[i].at > since; i--) if (s.log[i].market === market) n++;
        return n;
      },
      look: market => { s.looked.set(market, Date.now()); },
      moveSeen: key => s.moves.get(key) ?? null,
      pingFor: market => (s.diffAt && touched.has(market) ? s.diffAt : null),
      capped: market => (perMarket.get(market) ?? 0) > FLASH_CAP,
    };
    // `version` is the store's change counter: the memo recomputes once per real diff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, showRecent, game]);
  return { tracker, push, reset };
}

const LiveCtx = createContext<LiveTracker>(STILL);

export function LiveProvider({ value, children }: { value: LiveTracker; children: ReactNode }) {
  return createElement(LiveCtx.Provider, { value }, children);
}

/** The section's live memory; outside a provider (the Slate's static cards, /kit) nothing animates. */
export function useLive(): LiveTracker {
  return useContext(LiveCtx);
}

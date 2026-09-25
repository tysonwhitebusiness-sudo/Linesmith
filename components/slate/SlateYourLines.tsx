'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Chip, DataTable, type Column, type ChipTone, SectionBand } from '@/components/ui';
import { AlertList } from '../AlertsBell';
import { useTrackedAlerts } from '../useTrackedAlerts';
import { createClient } from '@/lib/supabase/client';
import type { BetLeg, TrackedLeg, YourLineRow } from '@/lib/slate/yourLines';

/**
 * "Your lines" (S5) — the signed-in reader's bets, slip legs, tracked lines
 * and watched players on today's slate. SIGNED OUT, THE SECTION DOES NOT
 * EXIST: not an empty card, not a sign-in prompt — the shell renders nothing
 * and the nav has no entry.
 *
 * Price then and price now sit side by side with nothing between them.
 */

const STATUS: Record<YourLineRow['status'], { label: string; tone: ChipTone }> = {
  pre: { label: 'Not started', tone: 'neutral' },
  live: { label: 'Live', tone: 'live' },
  done: { label: 'Final', tone: 'neutral' },
  unknown: { label: '—', tone: 'neutral' },
  won: { label: 'Won', tone: 'good' },
  lost: { label: 'Lost', tone: 'bad' },
  push: { label: 'Push', tone: 'neutral' },
};

const COLUMNS: Column<YourLineRow>[] = [
  { key: 'kind', label: 'Kind', sortable: false, render: (r) => r.kind },
  {
    key: 'subject',
    label: 'Player',
    sortable: false,
    render: (r) => (
      <span className="flex flex-col leading-tight">
        <span className="text-ink">{r.subjectName}</span>
        {r.market ? <span className="text-label text-ink-muted">{r.market}</span> : null}
      </span>
    ),
  },
  { key: 'then', label: 'Price then', numeric: true, sortable: false, info: 'The price when you added it.', render: (r) => r.priceThen ?? '—' },
  { key: 'now', label: 'Best now', numeric: true, sortable: false, info: 'The best price on the board for the same line now.', render: (r) => r.priceNow ?? '—' },
  {
    key: 'status',
    label: 'Status',
    sortable: false,
    render: (r) => (
      <Chip tone={STATUS[r.status].tone} size="sm">
        {STATUS[r.status].label}
      </Chip>
    ),
  },
  {
    key: 'link',
    label: '',
    sortable: false,
    render: (r) =>
      r.href ? (
        <Link href={r.href} className="text-ink underline underline-offset-2">
          Bets →
        </Link>
      ) : null,
  },
];

export function SlateYourLines({ rows, signedIn = null }: { rows: YourLineRow[] | null; signedIn?: boolean | null }) {
  const { alerts, unread, isSeen, markSeen } = useTrackedAlerts(signedIn);
  if ((!rows || rows.length === 0) && alerts.length === 0) return null;
  return (
    <section id="slate-your-lines" className="mb-6 scroll-mt-[150px]">
      <SectionBand title="Your lines" />
      {alerts.length ? (
        <Card title="Alerts" count={unread || undefined} scope={unread ? `${unread} unread` : 'all read'} className="mb-3"
          info="On your tracked lines: the line moved, a book beats yours by 5¢ or more, your book pulled it, or steam hit it.">
          {unread ? (
            <div className="-mt-1 mb-1 flex justify-end">
              <Button size="sm" variant="tertiary" onPress={() => markSeen(alerts.map((a) => a.id))}>Mark all read</Button>
            </div>
          ) : null}
          <AlertList alerts={alerts} isSeen={isSeen} />
        </Card>
      ) : null}
      {rows && rows.length ? (
        <Card title="On today's slate" count={rows.length} flush>
          <DataTable caption="Your lines on today's slate" columns={COLUMNS} rows={rows} rowKey={(r) => r.key} />
        </Card>
      ) : null}
    </section>
  );
}

/** `null` while unknown, then true/false. Same session read `AccountMenu` uses. */
export function useSignedIn(): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setSignedIn(data.session != null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(session != null));
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);
  return signedIn;
}

/**
 * Bets and tracked lines for the sport — fetched ONLY when signed in, so a
 * signed-out load makes no request that would 401.
 */
export function useYourLineSources(sport: string, signedIn: boolean | null) {
  const [bets, setBets] = useState<BetLeg[]>([]);
  const [tracked, setTracked] = useState<TrackedLeg[]>([]);
  useEffect(() => {
    if (!signedIn) {
      setBets([]);
      setTracked([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const q = `sport=${encodeURIComponent(sport)}`;
      const [b, t] = await Promise.all([
        fetch(`/api/bets?${q}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { bets: [] })).catch(() => ({ bets: [] })),
        fetch(`/api/tracked-lines?${q}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { trackedLines: [] })).catch(() => ({ trackedLines: [] })),
      ]);
      if (cancelled) return;
      setBets((b.bets ?? []) as BetLeg[]);
      setTracked((t.trackedLines ?? []) as TrackedLeg[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [sport, signedIn]);
  return { bets, tracked };
}

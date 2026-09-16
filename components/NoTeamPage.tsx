'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PickCandidate, TennisTour } from '@/lib/core/types';
import { useSlip } from './useSlip';
import { TopBar } from './TopBar';
import SlipModal from './SlipModal';

/**
 * What a team URL shows for a sport with no teams — R7 ("Tennis, golf: no
 * team page; the route explains why").
 *
 * Nothing in the app links here: `TopBar` hides the Teams tab for both sports.
 * The page exists for the typed or shared URL (`/golf/teams`,
 * `/tennis/atp/team/…`), which 404'd, and it sends the reader to where that
 * sport's research actually lives. The wording is G2's (`team-sports.js`).
 */

type Props = { sport: 'golf' } | { sport: 'tennis'; tour: TennisTour };

export function NoTeamPage(props: Props) {
  const router = useRouter();
  const slip = useSlip(props.sport);
  const [slipOpen, setSlipOpen] = useState(false);
  const home = props.sport === 'tennis' ? `/tennis/${props.tour}` : '/golf';
  const tourName = props.sport === 'tennis' ? (props.tour === 'wta' ? 'WTA' : 'ATP') : null;

  const copy =
    props.sport === 'tennis'
      ? {
          title: 'Tennis has no teams',
          reason:
            'Every match is one player against another, so the research is on the players: surface splits, serve and return, ranking and form on each player page, and head-to-head on each match page.',
          links: [
            { href: `${home}?tab=Players`, label: `${tourName} players`, note: 'Surface, serve and return, ranking, form' },
            { href: `${home}/schedule`, label: `${tourName} schedule`, note: 'Draws, rankings and season leaders' },
          ],
        }
      : {
          title: 'Golf has no teams',
          reason:
            'A golfer plays for himself or herself, so the research is on the players: rounds, hole scoring and shot data on each player page. The tournament, not a team, is what a week is organised around.',
          links: [
            { href: '/golf?tab=Players', label: 'Golfers', note: 'Rounds, scoring by par, shot profile' },
            { href: '/golf/schedule', label: 'Schedule', note: 'The season’s events and the course for this week' },
          ],
        };

  const onAdd = (candidate: PickCandidate, oddsInfo?: { americanOdds: string; source: string }) => {
    void slip.addPick(candidate, null, oddsInfo);
  };

  return (
    <div className="min-h-screen pb-10">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
        <TopBar
          sport={props.sport}
          league={props.sport === 'tennis' ? props.tour : undefined}
          onLeagueChange={props.sport === 'tennis' ? (next) => router.push(`/tennis/${next}/teams`) : undefined}
          tab="Players"
          onTabChange={(t) => router.push(t === 'Players' ? `${home}?tab=Players` : t === 'Schedule' ? `${home}/schedule` : home)}
          slipCount={slip.picks.length}
          onOpenSlip={() => setSlipOpen(true)}
          onRefresh={() => {}}
          loading={false}
          lastFetched={null}
        />
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10">
        <section className="rounded-card-hero border border-line-soft bg-card p-6 shadow-card">
          <h1 className="text-heading text-ink">{copy.title}</h1>
          <p className="mt-2 text-body text-ink-secondary">{copy.reason}</p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {copy.links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="block rounded-card border border-line-soft bg-card-sunk p-4 hover:border-line">
                  <span className="block text-body font-semibold text-ink">{l.label} →</span>
                  <span className="mt-0.5 block text-body-sm text-ink-muted">{l.note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <SlipModal
        sport={props.sport}
        picks={slip.picks}
        candidates={[]}
        subjects={[]}
        open={slipOpen}
        onClose={() => setSlipOpen(false)}
        onRemove={slip.removePick}
        onClear={slip.clearSlip}
        onSetOdds={slip.setOdds}
        onAdd={onAdd}
        onSubmit={slip.submitPicks}
      />
    </div>
  );
}

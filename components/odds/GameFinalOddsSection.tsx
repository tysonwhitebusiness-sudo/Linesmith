'use client';

import { useMemo } from 'react';
import { BookLogo } from '../BookLogo';
import { Card, DataTable, Tooltip } from '../ui';
import { LineMovement } from './LineMovement';
import { OpenNow } from './OpenNow';
import { useGameOdds } from './useOdds';
import { closingResearch, type ClosingRow, type FinalScore } from '@/lib/odds/section/closing';
import { fmtAmerican, fmtLine, fmtPct } from '@/lib/odds/section/format';
import { marketSpec } from '@/lib/odds/section/types';
import type { GameTeams } from './GameOddsSection';

const SPECS = { ml: marketSpec('ml'), sp: marketSpec('sp'), tot: marketSpec('tot') };

/**
 * A finished game's "Lines" (odds build P8, O3; the mockup's final surface,
 * "O-F closing-line research"): the three result tiles, every book's close
 * against the result, the sharp close against each book's, and the opener's
 * value at Pinnacle's fair close. Then the moneyline's movement to the close
 * and the total from open to close. Sport-agnostic: the sides are the payload's
 * home and away; the closes are what `lib/odds/section/closing.ts` finds.
 * Research, not a pick.
 */
export function GameFinalOddsSection({ sport, gameId, teams, start, score }: {
  sport: string;
  gameId: string;
  teams: GameTeams;
  start: string;
  score: FinalScore;
}) {
  const odds = useGameOdds(sport, gameId, { live: false });
  const byKey = useMemo(() => new Map((odds.data?.markets ?? []).map(m => [m.key, m])), [odds.data]);
  const r = useMemo(() => closingResearch(byKey, start, score, SPECS), [byKey, start, score]);
  if (odds.loading && !odds.data) return <Card title="Closing lines" state={{ kind: 'loading', lines: 6 }} />;
  if (!r.rows.length) {
    return <Card title="Closing lines" state={{ kind: 'empty', title: 'No closing prices held', reason: odds.error ? 'The lines could not be read just now.' : 'No book\'s price before the start was recorded for this game.' }} />;
  }
  const H = teams.home.abbr, A = teams.away.abbr;
  const side = (s: 'home' | 'away') => (s === 'home' ? H : A);
  const closeAt = Date.parse(start);
  const ml = byKey.get('fg_ml'), tot = byKey.get('fg_tot');
  const spHome = r.spread.line;
  const pinSp = r.spread.pinnacle;
  return (
    <div className="space-y-3">
      <p className="text-label text-ink-muted">Closing-line research · closed at the start · {r.books} books · research, not a pick</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card title="Moneyline" dense>
          <p className="text-heading">{r.ml.winner === 'draw' ? 'Draw' : `${side(r.ml.winner)} won`}</p>
          <p className="text-body-sm text-ink-secondary">
            {r.ml.pinOpen != null || r.ml.pinClose != null ? (
              <>Pinnacle opened {r.ml.winner === 'draw' ? H : side(r.ml.winner)} {fmtAmerican(r.ml.pinOpen)}, closed <b>{fmtAmerican(r.ml.pinClose)}</b>
                {r.ml.towardResult != null ? <> — the close moved <b className={r.ml.towardResult ? 'text-good-ink' : 'text-bad-ink'}>{r.ml.towardResult ? 'toward' : 'away from'}</b> the result</> : null}.</>
            ) : 'No Pinnacle moneyline held.'}
            {r.fairClose != null ? ` Fair close ${H} ${fmtPct(r.fairClose)}.` : ''}
          </p>
        </Card>
        <Card title="Spread" dense>
          <p className="text-heading">
            {r.spread.covered == null || spHome == null ? 'No closing spread'
              : r.spread.covered === 'push' ? `Push at ${H} ${fmtLine(spHome, true)}`
                : r.spread.covered === 'home' ? `${H} ${fmtLine(spHome, true)} covered` : `${A} ${fmtLine(-spHome, true)} covered`}
          </p>
          <p className="text-body-sm text-ink-secondary">
            {r.spread.margin === 0 ? 'Level.' : `${side(r.spread.margin > 0 ? 'home' : 'away')} by ${Math.abs(r.spread.margin)}.`}
            {pinSp && pinSp.line != null ? ` Pinnacle closed ${H} ${fmtLine(pinSp.line, true)} ${fmtAmerican(pinSp.a)}.` : ''}
          </p>
        </Card>
        <Card title="Total" dense>
          <p className="text-heading">
            {r.total.went == null ? 'No closing total' : r.total.went === 'push' ? `Push ${fmtLine(r.total.line)}` : `${r.total.went === 'over' ? 'Over' : 'Under'} ${fmtLine(r.total.line)}`}
          </p>
          <p className="text-body-sm text-ink-secondary">{r.total.points} against a consensus close of {fmtLine(r.total.line) || '—'}.</p>
        </Card>
      </div>
      <Card title="Every book at the close" scope={`moneyline ${H} / ${A}, spread, total`} flush
        caption={`"vs sharp close" is the book's closing ${H} implied probability minus Pinnacle's no-vig close (positive: the book charged more for ${H}). "Opener CLV" is the value of that book's ${H} opener at Pinnacle's fair close. A flagged opener is not used. Research, not a pick.`}>
        <DataTable<ClosingRow>
          caption="Every book's close"
          density="compact"
          rows={r.rows}
          rowKey={x => x.book}
          highlight={x => x.book === 'pinnacle'}
          columns={[
            { key: 'b', label: 'Book', sortable: false, render: x => <BookLogo bookId={x.book} size={14} withLabel /> },
            { key: 'o', label: `${H} open`, numeric: true, sortable: false, render: x => x.openFlagged
              ? <Tooltip content="This opener failed the sanity check against the other books."><span className="text-warn-ink">⚠ check</span></Tooltip>
              : fmtAmerican(x.openA) },
            { key: 'c', label: 'Close', numeric: true, sortable: false, render: x => <span><b>{fmtAmerican(x.closeA)}</b> <span className="text-ink-muted">/ {fmtAmerican(x.closeB)}</span></span> },
            { key: 'v', label: 'vs sharp close', numeric: true, sortable: false, render: x => x.vsSharp == null ? '—'
              : `${x.vsSharp >= 0 ? '+' : ''}${(x.vsSharp * 100).toFixed(1)} pts` },
            { key: 'clv', label: 'Opener CLV', numeric: true, sortable: false, render: x => x.openerClv == null ? '—'
              : <span className={x.openerClv > 0 ? 'text-good-ink' : 'text-bad-ink'}>{x.openerClv >= 0 ? '+' : ''}{fmtPct(x.openerClv)}</span> },
            { key: 's', label: 'Spread', numeric: true, sortable: false, render: x => x.spread && x.spread.line != null
              ? `${H} ${fmtLine(x.spread.line, true)} ${fmtAmerican(x.spread.a)}` : '—' },
            { key: 't', label: 'Total', numeric: true, sortable: false, render: x => x.total && x.total.line != null
              ? <span>{fmtLine(x.total.line)} <span className="text-ink-muted">{fmtAmerican(x.total.a)}</span></span> : '—' },
          ]}
        />
      </Card>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {ml && Object.keys(ml.hist).length ? <LineMovement market={ml} spec={SPECS.ml} sideLabels={[H, A]} now={closeAt} closed /> : null}
        {tot ? <OpenNow market={tot} spec={SPECS.tot} now={closeAt} title="Total: opening → close" /> : null}
      </div>
    </div>
  );
}

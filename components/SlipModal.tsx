'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PickCandidate, Sport, SubjectSummary } from '@/lib/core/types';
import { SPORT_LABEL } from '@/lib/core/types';
import type { PickRow } from './useSlip';
import { SubjectAvatar } from './SubjectAvatar';
import { MarketLabel } from './MarketLabel';
import { BookLogo, bookLabel } from './BookLogo';

/**
 * Popup replacement for the old bottom `SlipDrawer` — a centered modal
 * rather than a full-height sheet, with a real open/close transition (the
 * drawer had none — `if (!open) return null`). No animation library exists
 * anywhere in this app yet, so the transition is hand-rolled: `open` mounts
 * the panel immediately at scale-95/opacity-0, then a rAF flips it to its
 * resting state so the CSS transition actually has a starting frame to
 * animate from; closing reverses that and only unmounts after the
 * transition's own duration.
 */

interface ImportResponse {
  matched: Array<{ subjectId: string; matchedName: string; dimensionLabel: string; categoryLabel: string; americanOdds: string; confidence: number }>;
  unmatched: Array<{ subjectName: string; dimensionLabel: string; categoryLabel: string; americanOdds: string; suggestions: Array<{ subjectId: string; subjectName: string }> }>;
  warnings: string[];
  error?: string;
}

export interface SlipModalProps {
  sport: Sport;
  picks: PickRow[];
  candidates: PickCandidate[];
  subjects: SubjectSummary[];
  open: boolean;
  onClose: () => void;
  onRemove: (id: number) => void;
  onClear: () => void;
  onSetOdds: (id: number, odds: string, source?: string) => void;
  onAdd: (candidate: PickCandidate, odds?: { americanOdds: string; source: string }) => void;
  onSubmit: (ids: number[]) => Promise<unknown>;
}

const TRANSITION_MS = 180;

function collisions(picks: PickRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const pick of picks) counts.set(pick.subjectId, (counts.get(pick.subjectId) ?? 0) + 1);
  return counts;
}

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Entered by hand',
  screenshot: 'From screenshot',
};

/** Where a pick's price came from — a book mark when a real book resolved it, otherwise a short provenance label, otherwise nothing to report (the "needs odds" state renders separately). */
function OddsProvenance({ pick }: { pick: PickRow }) {
  if (!pick.americanOdds) return null;
  if (pick.bookmaker) {
    return <BookLogo bookId={pick.bookmaker} size={13} withLabel className="text-[10px]" />;
  }
  const label = pick.oddsSource ? (SOURCE_LABEL[pick.oddsSource] ?? (bookLabel(pick.oddsSource) || pick.oddsSource)) : null;
  return label ? <span className="text-[10px] text-ink-faint">{label}</span> : null;
}

function OddsField({ pick, onSetOdds }: { pick: PickRow; onSetOdds: SlipModalProps['onSetOdds'] }) {
  const [value, setValue] = useState(pick.americanOdds ?? '');
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== (pick.americanOdds ?? '')) onSetOdds(pick.id, value);
      }}
      inputMode="text"
      placeholder="+250"
      aria-label={`Odds for ${pick.subjectName}`}
      className="w-20 rounded-lg border border-line px-2 py-1 text-right text-sm tabular-nums focus:border-masters focus:outline-none"
    />
  );
}

/** Best candidate on the live slate for one scanned leg, ranked by how closely its category/dimension label reads like what the screenshot said. Never auto-picked — the user confirms via the dropdown before anything is added. */
function candidatesForSubject(candidates: PickCandidate[], subjectId: string): PickCandidate[] {
  return candidates.filter((c) => c.subjectId === subjectId);
}

function ScanLegRow({
  subjectId,
  matchedName,
  americanOdds,
  dimensionLabel,
  categoryLabel,
  candidates,
  onAdd,
}: {
  subjectId: string;
  matchedName: string;
  americanOdds: string;
  dimensionLabel: string;
  categoryLabel: string;
  candidates: PickCandidate[];
  onAdd: SlipModalProps['onAdd'];
}) {
  const options = useMemo(() => candidatesForSubject(candidates, subjectId), [candidates, subjectId]);
  const [selectedKey, setSelectedKey] = useState(options[0] ? `${options[0].dimension}:${options[0].category}` : '');
  const [added, setAdded] = useState(false);

  if (options.length === 0) return null; // subject matched, but nothing of theirs is on today's slate to attach the price to

  const selected = options.find((c) => `${c.dimension}:${c.category}` === selectedKey) ?? options[0];

  return (
    <li className="lb-card flex items-center gap-2 p-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold">{matchedName}</p>
        <p className="truncate text-[11px] text-ink-faint">
          Screenshot said “{dimensionLabel} {categoryLabel}” @ {americanOdds}
        </p>
        {options.length > 1 ? (
          <select
            value={selectedKey || `${options[0].dimension}:${options[0].category}`}
            onChange={(e) => setSelectedKey(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-card px-1.5 py-1 text-[11px]"
          >
            {options.map((c) => (
              <option key={`${c.dimension}:${c.category}`} value={`${c.dimension}:${c.category}`}>
                {c.dimensionLabel} — {c.categoryLabel}
              </option>
            ))}
          </select>
        ) : (
          <p className="mt-0.5 text-[11px] text-ink-muted">
            Attach to: {selected.dimensionLabel} — {selected.categoryLabel}
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={added}
        onClick={() => {
          onAdd(selected, { americanOdds, source: 'screenshot' });
          setAdded(true);
        }}
        className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold ${
          added ? 'bg-accent-soft text-masters' : 'bg-masters text-white'
        }`}
      >
        {added ? 'Added ✓' : 'Add'}
      </button>
    </li>
  );
}

export function SlipModal({
  sport,
  picks,
  candidates,
  subjects,
  open,
  onClose,
  onRemove,
  onClear,
  onSetOdds,
  onAdd,
  onSubmit,
}: SlipModalProps) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const timeout = setTimeout(() => setMounted(false), TRANSITION_MS);
    return () => clearTimeout(timeout);
  }, [open]);

  const counts = useMemo(() => collisions(picks), [picks]);

  const imageIndex = useMemo(() => {
    const map = new Map<string, { headshotUrl?: string; fallbackUrl?: string }>();
    for (const subject of subjects) {
      map.set(subject.subjectId, {
        headshotUrl: subject.meta?.headshotUrl as string | undefined,
        fallbackUrl: (subject.meta?.flagUrl ?? subject.meta?.teamLogoUrl) as string | undefined,
      });
    }
    return map;
  }, [subjects]);
  const imagesFor = (subjectId: string) => imageIndex.get(subjectId) ?? {};

  const copyList = async () => {
    const lines = picks.map((p) => {
      const odds = p.americanOdds ? ` @ ${p.americanOdds}` : '';
      return `${p.subjectName} — ${p.dimensionLabel} — ${p.categoryLabel}${odds}`;
    });
    const text = [`Linesmith slip (${SPORT_LABEL[sport]})`, ...lines].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; leave the user to select the text manually.
    }
  };

  const runImport = async (file: File) => {
    setImporting(true);
    setImportResult(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read the file.'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/odds/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: dataUrl, mediaType: file.type, subjects }),
      });
      const json = (await res.json()) as ImportResponse;
      setImportResult(json);

      // Auto-fill odds for any slip leg whose subject was confidently
      // matched. Legs with no existing slip counterpart surface below as
      // "From your screenshot" instead, for the user to attach to a market.
      if (res.ok) {
        for (const leg of json.matched ?? []) {
          const target = picks.find((p) => p.subjectId === leg.subjectId && !p.americanOdds);
          if (target && leg.americanOdds) onSetOdds(target.id, leg.americanOdds, 'screenshot');
        }
      }
    } catch (error) {
      setImportResult({
        matched: [],
        unmatched: [],
        warnings: [],
        error: error instanceof Error ? error.message : 'Import failed.',
      });
    } finally {
      setImporting(false);
    }
  };

  const submit = async () => {
    if (picks.length === 0) return;
    setSubmitting(true);
    try {
      await onSubmit(picks.map((p) => p.id));
      onClose();
      router.push('/bets');
    } finally {
      setSubmitting(false);
    }
  };

  // Screenshot legs matched to a subject but not already sitting on the slip
  // with a price — these are the ones the scan can *create* a pick for, not
  // just back-fill odds onto.
  const creatableLegs = (importResult?.matched ?? []).filter(
    (leg) => !picks.some((p) => p.subjectId === leg.subjectId && p.americanOdds),
  );

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close slip"
        onClick={onClose}
        className={`absolute inset-0 bg-ink/40 backdrop-blur-[2px] transition-opacity duration-[180ms] ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <section
        className={`relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-paper shadow-drawer transition-all duration-[180ms] ${
          shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-95 opacity-0'
        }`}
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-base font-semibold">Slip · {picks.length}</h2>
          <div className="flex items-center gap-3">
            {picks.length > 0 ? (
              <button type="button" onClick={onClear} className="text-sm text-bad">
                Clear
              </button>
            ) : null}
            <button type="button" onClick={onClose} aria-label="Close" className="text-lg leading-none text-ink-faint">
              ×
            </button>
          </div>
        </header>

        <div className="space-y-3 overflow-y-auto p-4">
          {/* Scan is the primary way in — promoted above the pick list rather than buried under it. */}
          <div>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={importing}
              className="lb-btn-primary flex w-full items-center justify-center gap-2 rounded-xl bg-masters px-3 py-3 text-[14px] font-semibold text-white shadow-card disabled:opacity-60"
            >
              {importing ? 'Reading your screenshot…' : 'Scan a bet slip'}
            </button>
            <p className="mt-1.5 text-center text-[11px] text-ink-faint">
              Reads odds from a screenshot you took. Never connects to a sportsbook.
            </p>
          </div>

          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void runImport(file);
              e.target.value = '';
            }}
          />

          {importResult ? (
            <div className="space-y-2">
              {importResult.error ? <p className="text-xs text-bad">{importResult.error}</p> : null}
              {importResult.warnings?.map((w) => (
                <p key={w} className="text-xs text-warn">
                  {w}
                </p>
              ))}

              {creatableLegs.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-meta font-semibold uppercase tracking-wide text-ink-muted">
                    From your screenshot
                  </p>
                  <ul className="space-y-1.5">
                    {creatableLegs.map((leg, i) => (
                      <ScanLegRow
                        key={`${leg.subjectId}-${i}`}
                        subjectId={leg.subjectId}
                        matchedName={leg.matchedName}
                        americanOdds={leg.americanOdds}
                        dimensionLabel={leg.dimensionLabel}
                        categoryLabel={leg.categoryLabel}
                        candidates={candidates}
                        onAdd={onAdd}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}

              {importResult.unmatched?.length ? (
                <div className="lb-card space-y-1 p-3 text-xs">
                  <p className="font-semibold text-ink">Needs confirming</p>
                  <ul className="space-y-1">
                    {importResult.unmatched.map((leg, i) => (
                      <li key={`${leg.subjectName}-${i}`} className="text-ink-muted">
                        “{leg.subjectName}” {leg.categoryLabel} {leg.americanOdds}
                        {leg.suggestions.length > 0 ? (
                          <span className="text-ink-faint"> — did you mean {leg.suggestions.map((s) => s.subjectName).join(' / ')}?</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {picks.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-muted">Nothing on the slip yet. Add picks from the scan tabs.</p>
          ) : (
            <ul className="space-y-2">
              {picks.map((pick) => (
                <li key={pick.id} className="lb-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <SubjectAvatar
                        name={pick.subjectName}
                        headshotUrl={imagesFor(pick.subjectId).headshotUrl}
                        fallbackUrl={imagesFor(pick.subjectId).fallbackUrl}
                        size={30}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{pick.subjectName}</p>
                        <p className="truncate text-xs text-ink-muted">
                          <MarketLabel sport={sport} dimension={pick.dimension} category={pick.category} />
                        </p>
                        {(counts.get(pick.subjectId) ?? 0) > 1 ? (
                          <p className="mt-1 text-[11px] text-warn">Same subject appears more than once on this slip.</p>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <div className="flex items-center gap-2">
                        <OddsField pick={pick} onSetOdds={onSetOdds} />
                        <button
                          type="button"
                          onClick={() => onRemove(pick.id)}
                          aria-label={`Remove ${pick.subjectName}`}
                          className="px-1 text-lg leading-none text-ink-faint"
                        >
                          ×
                        </button>
                      </div>
                      {pick.americanOdds ? (
                        <OddsProvenance pick={pick} />
                      ) : (
                        <span className="text-[10px] font-semibold text-warn">Needs odds — enter manually</span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {picks.length > 0 ? (
            <button
              type="button"
              onClick={copyList}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-muted"
            >
              {copied ? 'Copied ✓' : 'Copy list'}
            </button>
          ) : null}
        </div>

        {picks.length > 0 ? (
          <footer className="border-t border-line p-4">
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="lb-btn-primary w-full rounded-xl bg-masters px-3 py-3 text-[14px] font-semibold text-white shadow-card disabled:opacity-60"
            >
              {submitting ? 'Submitting…' : `Submit ${picks.length} to Live Bets`}
            </button>
          </footer>
        ) : null}
      </section>
    </div>
  );
}

export default SlipModal;

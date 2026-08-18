'use client';

/**
 * Golf's "field not released yet" empty state — shown on Scan, Players and
 * Schedule whenever ESPN hasn't published tee times/pairings for the
 * upcoming event. Before that happens `event.golfers` (adapter.ts) is empty,
 * so `subjects`/`candidates` are genuinely empty rather than filtered down —
 * a plain "no results" message reads as a bug, this reads as a known,
 * temporary state.
 */
export function TournamentNotStartedNotice({
  eventName,
  detail,
  className = '',
}: {
  eventName?: string | null;
  /** Pre-formatted date range or round label, e.g. "Aug 20–23" — callers own their own date formatting. */
  detail?: string | null;
  className?: string;
}) {
  return (
    <div className={`lb-card flex flex-col items-center gap-4 px-6 py-14 text-center ${className}`}>
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-soft">
        <img
          src="/brand/linesmith-mark.png"
          alt=""
          width={44}
          height={28}
          className="h-[28px] w-auto select-none"
        />
      </div>
      <div className="max-w-sm space-y-1.5">
        <span className="lb-chip bg-accent-soft text-masters">Pre-tournament</span>
        <h2 className="text-[15px] font-semibold text-ink">
          {eventName ? `${eventName} hasn't started yet` : "This tournament hasn't started yet"}
        </h2>
        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          {detail ? `Tees off ${detail}. ` : ''}
          Player data, matchups and props show up here as soon as the field goes live — check back once the
          tournament has started.
        </p>
      </div>
    </div>
  );
}

export default TournamentNotStartedNotice;

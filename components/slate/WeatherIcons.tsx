import { cx } from '@/components/ui';
import type { SpotlightWeather } from '@/lib/slate/spotlights';

/** Compass point -> degrees the wind comes FROM. */
const FROM: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

/**
 * A forecast as three icons and their numbers (slate-polish v4): the wind with
 * an arrow pointing where it BLOWS (its "from" point turned round), the chance
 * of rain, the temperature. A number is coloured only where it is the reason
 * the game is on the card: wind over 15 mph, rain over 50% (amber from 25%).
 */
export function WeatherIcons({ w, fallback }: { w: SpotlightWeather | null | undefined; fallback?: string }) {
  if (!w) return <span className="text-body-sm text-ink-secondary">{fallback ?? '—'}</span>;
  const deg = w.windDir != null && FROM[w.windDir] != null ? FROM[w.windDir] + 180 : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm tabular-nums">
      {w.windMph != null ? (
        <span className="inline-flex items-center gap-1" aria-label={`Wind ${Math.round(w.windMph)} mph${w.windDir ? ` from the ${w.windDir}` : ''}`}>
          <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" className="shrink-0 text-ink-secondary" style={deg != null ? { transform: `rotate(${deg}deg)` } : undefined}>
            <path d="M8 2v12M8 2l-3.5 3.5M8 2l3.5 3.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <b className={cx('font-bold', w.windMph > 15 ? 'text-warn-ink' : 'text-ink')}>{Math.round(w.windMph)}</b>
          <span className="text-ink-muted">mph{w.windDir ? ` ${w.windDir}` : ''}</span>
        </span>
      ) : null}
      {w.rainPct != null ? (
        <span className="inline-flex items-center gap-1" aria-label={`Chance of rain ${Math.round(w.rainPct)}%`}>
          <svg aria-hidden width="14" height="15" viewBox="0 0 16 16" className="shrink-0">
            <path d="M8 1.8S3.5 7 3.5 10a4.5 4.5 0 0 0 9 0C12.5 7 8 1.8 8 1.8z" className="fill-ink-muted" />
          </svg>
          <b className={cx('font-bold', w.rainPct > 50 ? 'text-bad-ink' : w.rainPct >= 25 ? 'text-warn-ink' : 'text-ink')}>{Math.round(w.rainPct)}%</b>
        </span>
      ) : null}
      {w.tempF != null ? (
        <span className="inline-flex items-center gap-1" aria-label={`${Math.round(w.tempF)} degrees`}>
          <svg aria-hidden width="13" height="15" viewBox="0 0 14 16" className="shrink-0 text-ink-secondary">
            <path d="M5 2.5a2 2 0 0 1 4 0v6.3a3.5 3.5 0 1 1-4 0z" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="7" cy="11.5" r="1.8" className="fill-bad" />
          </svg>
          <b className="font-bold text-ink">{Math.round(w.tempF)}°</b>
        </span>
      ) : null}
    </span>
  );
}

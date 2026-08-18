/**
 * Small inline icon set for the Linesmith Pick system — stroke-based SVGs
 * (same idiom as GameDetail's existing wind-direction arrow) instead of
 * emoji, so the pick UI reads as part of the app's own visual language
 * rather than borrowing the OS's emoji rendering.
 */

export function SunIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden className={className}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.9 3.1l-1.05 1.05M4.15 11.8l-1.05 1.05M12.9 12.9l-1.05-1.05M4.15 4.15L3.1 3.1" />
    </svg>
  );
}

export function CloudIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M4.5 12.5a3 3 0 0 1-.4-5.98A3.5 3.5 0 0 1 11 5.55a2.75 2.75 0 0 1 1.5 6.95h-8Z" />
    </svg>
  );
}

export function CloudRainIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M4.2 10.5a2.7 2.7 0 0 1-.3-5.38A3.2 3.2 0 0 1 10.2 4a2.5 2.5 0 0 1 1.3 6.5h-7.3Z" />
      <path d="M5 13v1M8 13v1.5M11 13v1" />
    </svg>
  );
}

export function WindIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden className={className}>
      <path d="M1.5 5.5h8.25a1.75 1.75 0 1 0-1.65-2.35" />
      <path d="M1.5 8.5h10.75a2 2 0 1 1-1.9 2.7" />
      <path d="M1.5 11.5h6.25a1.5 1.5 0 1 1-1.4 2" />
    </svg>
  );
}

export function StarIcon({ size = 12, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M10 1.5l2.47 5.51 5.97.6-4.5 4.03 1.29 5.86L10 14.9l-5.23 2.6 1.29-5.86-4.5-4.03 5.97-.6z" />
    </svg>
  );
}

export function LockIcon({ size = 11, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <rect x="3" y="7" width="10" height="7" rx="1.4" />
      <path d="M5.2 7V4.8a2.8 2.8 0 0 1 5.6 0V7" />
    </svg>
  );
}

export function ClockIcon({ size = 11, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.8V8l2.4 1.4" />
    </svg>
  );
}

/**
 * Scan filter-bar redesign icon set — one shared stroke idiom (1.7 weight,
 * round caps/joins) so a uniform row of filter buttons actually reads as
 * uniform, matching the approved Linesmith Redesign Brief mockup.
 */
function outlineSvg({ size = 15, className = '' }: { size?: number; className?: string }, children: React.ReactNode) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {children}
    </svg>
  );
}

export function PeopleIcon(props: { size?: number; className?: string }) {
  return outlineSvg(props, (
    <>
      <circle cx="8" cy="8" r="3" />
      <circle cx="16" cy="8" r="3" />
      <path d="M3 20c0-3 2-5 5-5s5 2 5 5" />
      <path d="M11 20c0-3 2-5 5-5s5 2 5 5" />
    </>
  ));
}

export function BarsIcon(props: { size?: number; className?: string }) {
  return outlineSvg(props, (
    <>
      <rect x="4" y="12" width="4" height="8" />
      <rect x="10" y="7" width="4" height="13" />
      <rect x="16" y="3" width="4" height="17" />
    </>
  ));
}

export function ShieldIcon(props: { size?: number; className?: string }) {
  return outlineSvg(props, <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />);
}

export function TargetIcon(props: { size?: number; className?: string }) {
  return outlineSvg(props, (
    <>
      <circle cx="7" cy="7" r="3" />
      <circle cx="17" cy="17" r="3" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </>
  ));
}

export function SlidersIcon(props: { size?: number; className?: string }) {
  return outlineSvg(props, (
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <circle cx="14" cy="7" r="2" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="9" cy="17" r="2" />
    </>
  ));
}

export function FlameIcon(props: { size?: number; className?: string }) {
  return outlineSvg(props, <polygon points="12,4 20,20 4,20" />);
}

export function BookIcon(props: { size?: number; className?: string }) {
  return outlineSvg(props, (
    <>
      <path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" />
      <line x1="17" y1="20" x2="17" y2="7" />
    </>
  ));
}

export function SnowflakeIcon(props: { size?: number; className?: string }) {
  return outlineSvg(props, (
    <>
      <line x1="12" y1="2" x2="12" y2="22" />
      <line x1="4.2" y1="7" x2="19.8" y2="17" />
      <line x1="19.8" y1="7" x2="4.2" y2="17" />
    </>
  ));
}

export function CheckCircleIcon(props: { size?: number; className?: string }) {
  return outlineSvg(props, (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9" />
    </>
  ));
}

export function CalendarIcon(props: { size?: number; className?: string }) {
  return outlineSvg(props, (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <line x1="4" y1="10" x2="20" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
    </>
  ));
}

export function GridIcon(props: { size?: number; className?: string }) {
  return outlineSvg(props, (
    <>
      <rect x="4" y="4" width="7" height="7" />
      <rect x="13" y="4" width="7" height="7" />
      <rect x="4" y="13" width="7" height="7" />
      <rect x="13" y="13" width="7" height="7" />
    </>
  ));
}

export function ListIcon(props: { size?: number; className?: string }) {
  return outlineSvg(props, (
    <>
      <line x1="8" y1="6" x2="20" y2="6" />
      <line x1="8" y1="12" x2="20" y2="12" />
      <line x1="8" y1="18" x2="20" y2="18" />
      <line x1="4" y1="6" x2="4.01" y2="6" />
      <line x1="4" y1="12" x2="4.01" y2="12" />
      <line x1="4" y1="18" x2="4.01" y2="18" />
    </>
  ));
}

export function MoreIcon(props: { size?: number; className?: string }) {
  return outlineSvg(props, (
    <>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </>
  ));
}

export function SidebarIcon(props: { size?: number; className?: string }) {
  return outlineSvg(props, (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </>
  ));
}

export function ChevronDownIcon({ size = 13, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <polyline points="6,9 12,15 18,9" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 13, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <polyline points="15,6 9,12 15,18" />
    </svg>
  );
}

export function PlayIcon({ size = 12, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden className={className}>
      <polygon points="7,4 20,12 7,20" />
    </svg>
  );
}

export function PauseIcon({ size = 12, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden className={className}>
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}

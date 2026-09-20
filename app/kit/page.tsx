import { notFound } from 'next/navigation';
import KitPage from './KitPage';

/**
 * The kit page (U spec §5) — every primitive in every state, in one place.
 *
 * DEV ONLY. It is not in any nav, and it 404s in production rather than
 * shipping a page that documents the design system to whoever finds the URL.
 *
 * U0 builds the skeleton: the tokens (type ramp, palette, radius, shadow,
 * motion), the primitives that exist today, and the six Tailwind 4 traps from
 * the U spec §9 laid out so they can be checked by eye. U1–U5 each add their
 * own components and, from U2, the fifteen reference tables.
 */
export const dynamic = 'force-static';

export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <KitPage />;
}

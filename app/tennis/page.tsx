import { redirect } from 'next/navigation';

// Tennis is the second sport with more than one competition (after soccer)
// — `/tennis` alone has no snapshot of its own, so it redirects to a
// default tour the same way `/soccer` redirects to `/soccer/epl`.
export default function TennisIndexPage() {
  redirect('/tennis/atp');
}

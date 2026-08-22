import { redirect } from 'next/navigation';

// Soccer is the first sport with more than one competition — `/soccer`
// alone has no snapshot of its own, so it redirects to a default league
// the same way a bare sport switch always needs a real page to land on.
export default function SoccerIndexPage() {
  redirect('/soccer/epl');
}

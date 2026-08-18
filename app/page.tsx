import { redirect } from 'next/navigation';

export default function Home() {
  // The client shell remembers the last sport and redirects from /golf if needed.
  redirect('/golf');
}

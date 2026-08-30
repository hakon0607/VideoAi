import { getUser } from '@/lib/supabase/server';
import { LandingView } from '@/components/landing/landing-view';

export default async function HomePage() {
  // Signed-in visitors still get the page, with the buttons pointing at their
  // projects instead of the sign-up form.
  const user = await getUser().catch(() => null);
  return <LandingView signedIn={Boolean(user)} />;
}

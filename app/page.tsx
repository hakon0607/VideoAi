import { redirect } from 'next/navigation';
import { getUser } from '@/lib/supabase/server';

export default async function HomePage() {
  const user = await getUser().catch(() => null);
  redirect(user ? '/dashboard' : '/login');
}

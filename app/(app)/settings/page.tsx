import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { loadProfile } from '@/lib/actions/queries';
import { SettingsView } from '@/components/dashboard/settings-view';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await loadProfile();
  if (!session) redirect('/login');
  return (
    <SettingsView
      email={session.user.email ?? ''}
      username={session.profile?.username ?? ''}
      displayName={session.profile?.display_name ?? ''}
      locale={session.profile?.locale ?? 'en'}
      isAdmin={Boolean(session.profile?.is_admin)}
    />
  );
}

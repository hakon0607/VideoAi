import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/dashboard/sidebar';
import { ProfileMenu } from '@/components/dashboard/profile-menu';
import { CreditBadge } from '@/components/dashboard/credit-badge';
import { loadProfile } from '@/lib/actions/queries';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await loadProfile();
  if (!session) redirect('/login');
  const { user, profile } = session;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar isAdmin={Boolean(profile?.is_admin)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-line px-5">
          <CreditBadge />
          <ProfileMenu
            displayName={profile?.display_name ?? ''}
            username={profile?.username ?? ''}
            email={user.email ?? ''}
            isAdmin={Boolean(profile?.is_admin)}
          />
        </header>
        <main className="min-w-0 flex-1 px-5 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}

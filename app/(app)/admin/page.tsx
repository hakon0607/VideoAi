import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadAdminData } from '@/lib/actions/admin';
import { loadProfile } from '@/lib/actions/queries';
import { AdminView } from '@/components/admin/admin-view';

export const metadata: Metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await loadProfile();
  if (!session?.profile?.is_admin) notFound();

  const data = await loadAdminData();
  return <AdminView data={data} />;
}

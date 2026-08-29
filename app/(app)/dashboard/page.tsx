import type { Metadata } from 'next';
import { loadProfile, loadProjects } from '@/lib/actions/queries';
import { DashboardView } from '@/components/dashboard/dashboard-view';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [session, projects] = await Promise.all([loadProfile(), loadProjects()]);
  const name = session?.profile?.display_name || session?.profile?.username || '';
  return <DashboardView name={name} projects={projects} />;
}

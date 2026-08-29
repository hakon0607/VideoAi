import type { Metadata } from 'next';
import { loadProjects } from '@/lib/actions/queries';
import { ProjectsView } from '@/components/dashboard/projects-view';

export const metadata: Metadata = { title: 'Projects' };
export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const projects = await loadProjects(200);
  return <ProjectsView projects={projects} />;
}

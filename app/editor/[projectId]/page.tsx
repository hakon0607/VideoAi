import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadEditorProject } from '@/lib/actions/editor-data';
import { loadProfile } from '@/lib/actions/queries';
import { touchProjectAction } from '@/lib/actions/projects';
import { EditorRoot } from '@/components/editor/editor-root';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>;
}): Promise<Metadata> {
  const { projectId } = await params;
  const data = await loadEditorProject(projectId).catch(() => null);
  return { title: data?.state.name ?? 'Editor' };
}

export default async function EditorPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const [bootstrap, session] = await Promise.all([loadEditorProject(projectId), loadProfile()]);
  if (!bootstrap || !session) notFound();

  // Fire and forget: keeps "recent projects" meaningful.
  void touchProjectAction(projectId).catch(() => undefined);

  return (
    <EditorRoot
      bootstrap={bootstrap}
      user={{
        id: session.user.id,
        email: session.user.email ?? '',
        displayName: session.profile?.display_name ?? '',
        username: session.profile?.username ?? '',
      }}
    />
  );
}

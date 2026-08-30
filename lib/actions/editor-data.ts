import 'server-only';
import type { Clip, EditorState, Effect, Keyframe, MediaAnalysis } from '@/types/editor';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  analysisFromRow,
  assetFromRow,
  clipFromRow,
  effectFromRow,
  folderFromRow,
  keyframeFromRow,
  markerFromRow,
  trackFromRow,
} from '@/lib/editor/serialize';

export interface AiMessageDto {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  descriptions: string[];
  status: string;
  createdAt: string;
  creditsCharged: number;
}

export interface EditorBootstrap {
  state: EditorState;
  /** assetId -> signed URL, valid for an hour. */
  mediaUrls: Record<string, string>;
  conversationId: string | null;
  messages: AiMessageDto[];
  exportFormat: string;
  exportQuality: string;
}

/** Loads everything the editor needs for one project, in a handful of queries. */
export async function loadEditorProject(projectId: string): Promise<EditorBootstrap | null> {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data: project } = await supabase.from('projects').select('*').eq('id', projectId).maybeSingle();
  if (!project) return null;

  const { data: timeline } = await supabase
    .from('timelines')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_primary', true)
    .maybeSingle();
  if (!timeline) return null;

  const [
    tracksRes,
    clipsRes,
    effectsRes,
    keyframesRes,
    assetsRes,
    analysisRes,
    conversationRes,
    foldersRes,
    markersRes,
  ] = await Promise.all([
      supabase.from('tracks').select('*').eq('timeline_id', timeline.id).order('layer_index'),
      supabase.from('clips').select('*').eq('timeline_id', timeline.id).order('start_time'),
      supabase.from('effects').select('*').eq('project_id', projectId).order('order_index'),
      supabase.from('keyframes').select('*').eq('project_id', projectId).order('time_offset'),
      supabase.from('media_assets').select('*').eq('project_id', projectId).order('created_at'),
      supabase.from('media_analysis').select('*').eq('project_id', projectId),
      supabase
        .from('ai_conversations')
        .select('id')
        .eq('project_id', projectId)
        .eq('user_id', auth.user.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('media_folders').select('*').eq('project_id', projectId).order('name'),
      supabase.from('markers').select('*').eq('timeline_id', timeline.id).order('time_seconds'),
    ]);

  const effectsByClip = new Map<string, Effect[]>();
  for (const row of effectsRes.data ?? []) {
    const list = effectsByClip.get(row.clip_id) ?? [];
    list.push(effectFromRow(row));
    effectsByClip.set(row.clip_id, list);
  }

  const keyframesByClip = new Map<string, Keyframe[]>();
  for (const row of keyframesRes.data ?? []) {
    const list = keyframesByClip.get(row.clip_id) ?? [];
    list.push(keyframeFromRow(row));
    keyframesByClip.set(row.clip_id, list);
  }

  const clips: Clip[] = (clipsRes.data ?? []).map((row) =>
    clipFromRow(row, effectsByClip.get(row.id) ?? [], keyframesByClip.get(row.id) ?? []),
  );

  const assets = (assetsRes.data ?? []).map(assetFromRow);

  const analysis: Record<string, MediaAnalysis> = {};
  for (const row of analysisRes.data ?? []) analysis[row.asset_id] = analysisFromRow(row);

  const folders = (foldersRes.data ?? []).map(folderFromRow);
  const markers = (markersRes.data ?? []).map(markerFromRow);

  const mediaUrls: Record<string, string> = {};
  if (assets.length) {
    const { data: signed } = await supabase.storage
      .from('media')
      .createSignedUrls(assets.map((a) => a.storagePath), 60 * 60);
    const byPath = new Map((signed ?? []).map((s) => [s.path ?? '', s.signedUrl]));
    for (const asset of assets) {
      const url = byPath.get(asset.storagePath);
      if (url) mediaUrls[asset.id] = url;
    }
  }

  let messages: AiMessageDto[] = [];
  if (conversationRes.data?.id) {
    const { data: rows } = await supabase
      .from('ai_messages')
      .select('id, role, content, descriptions, status, created_at, credits_charged')
      .eq('conversation_id', conversationRes.data.id)
      .order('created_at')
      .limit(200);
    messages = (rows ?? []).map((m) => ({
      id: m.id,
      role: m.role as AiMessageDto['role'],
      content: m.content,
      descriptions: Array.isArray(m.descriptions) ? (m.descriptions as string[]) : [],
      status: m.status,
      createdAt: m.created_at,
      creditsCharged: m.credits_charged,
    }));
  }

  const state: EditorState = {
    projectId: project.id,
    timelineId: timeline.id,
    name: project.name,
    settings: {
      aspectRatio: project.aspect_ratio as EditorState['settings']['aspectRatio'],
      width: project.width,
      height: project.height,
      fps: Number(project.fps),
      backgroundColor: project.background_color,
      sampleRate: project.sample_rate,
    },
    tracks: (tracksRes.data ?? []).map(trackFromRow),
    clips,
    assets,
    analysis,
    markers,
    folders,
    revision: Number(timeline.revision ?? 0),
  };

  return {
    state,
    mediaUrls,
    conversationId: conversationRes.data?.id ?? null,
    messages,
    exportFormat: project.export_format,
    exportQuality: project.export_quality,
  };
}

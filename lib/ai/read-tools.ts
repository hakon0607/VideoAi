import { z } from 'zod';
import type { EditorState } from '@/types/editor';
import { clipEnd } from '@/lib/editor/time';
import { gapsOnTrack, timelineDuration } from '@/lib/editor/selectors';
import { EditorError } from '@/lib/editor/errors';
import { SFX_LIBRARY_INFO } from '@/lib/editor/actions/sfx-info';
import { findHighlights, inverseRanges } from './highlights';
import {
  buildProjectContext,
  findInTranscript,
  timelineSilences,
  transcriptOnTimeline,
} from './project-context';

export interface ReadToolContext {
  state: EditorState;
  selection: string[];
  playhead: number;
}

export interface ReadToolDef {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (params: never, ctx: ReadToolContext) => unknown;
}

function def<S extends z.ZodType>(tool: {
  name: string;
  description: string;
  schema: S;
  run: (params: z.infer<S>, ctx: ReadToolContext) => unknown;
}): ReadToolDef {
  return tool as unknown as ReadToolDef;
}

/**
 * Read-only tools. These are what stop the model from guessing: it can always
 * look at the real timeline, the real transcript and the real silence map
 * before it decides which editing commands to run.
 */
export const READ_TOOLS: ReadToolDef[] = [
  def({
    name: 'get_project_state',
    description:
      'Return the current project: settings, tracks, clips with their ids and times, media assets, the selection and the playhead. Call this first if you are unsure about anything.',
    schema: z.object({}),
    run: (_params, ctx) => buildProjectContext(ctx.state, ctx.selection, ctx.playhead),
  }),

  def({
    name: 'get_clips',
    description:
      'List clips with full detail, optionally filtered. Use this when the project summary collapsed something, for example a long run of caption lines.',
    schema: z.object({
      trackId: z.string().optional(),
      role: z.enum(['default', 'caption']).optional(),
      kind: z.enum(['video', 'audio', 'image', 'text']).optional(),
      groupId: z.string().optional(),
      start: z.number().optional().describe('Only clips that overlap from this timeline second.'),
      end: z.number().optional(),
      limit: z.number().int().min(1).max(400).default(80),
      offset: z.number().int().min(0).default(0),
    }),
    run: (params, ctx) => {
      let clips = [...ctx.state.clips];
      if (params.trackId) clips = clips.filter((c) => c.trackId === params.trackId);
      if (params.role) clips = clips.filter((c) => c.role === params.role);
      if (params.kind) clips = clips.filter((c) => c.kind === params.kind);
      if (params.groupId) clips = clips.filter((c) => c.groupId === params.groupId);
      if (params.start !== undefined) clips = clips.filter((c) => clipEnd(c) >= (params.start as number));
      if (params.end !== undefined) clips = clips.filter((c) => c.start <= (params.end as number));
      clips.sort((a, b) => a.start - b.start);
      const page = clips.slice(params.offset, params.offset + params.limit);
      return {
        total: clips.length,
        returned: page.length,
        clips: page.map((c) => ({
          id: c.id,
          trackId: c.trackId,
          kind: c.kind,
          role: c.role,
          groupId: c.groupId,
          name: c.name,
          start: c.start,
          end: clipEnd(c),
          duration: c.duration,
          ...(c.kind === 'text' ? { text: c.text } : { assetId: c.assetId, sourceIn: c.sourceIn, speed: c.speed }),
        })),
      };
    },
  }),

  def({
    name: 'get_transcript',
    description:
      'Return the transcript of a media asset with timestamps already converted to TIMELINE seconds. Use segments for captions and words when you need exact word boundaries.',
    schema: z.object({
      assetId: z.string(),
      granularity: z.enum(['segments', 'words']).default('segments'),
      start: z.number().optional(),
      end: z.number().optional(),
      limit: z.number().int().min(1).max(1500).default(400),
    }),
    run: (params, ctx) => {
      const analysis = ctx.state.analysis[params.assetId];
      if (!analysis) {
        throw new EditorError('asset_not_found', `No analysis stored for asset ${params.assetId}.`, {
          hint: 'The user has to run "Transcribe" on that media first.',
        });
      }
      if (analysis.words.length === 0 && analysis.segments.length === 0) {
        return {
          transcribed: false,
          message:
            'This asset has not been transcribed yet. Tell the user to press Transcribe on the clip, or ask whether they want you to work without a transcript.',
          silences: analysis.silences.length,
        };
      }
      const range = params.start !== undefined || params.end !== undefined
        ? { start: params.start ?? 0, end: params.end ?? Number.MAX_SAFE_INTEGER }
        : undefined;
      const items = transcriptOnTimeline(ctx.state, params.assetId, params.granularity, range);
      return {
        transcribed: true,
        language: analysis.language,
        total: items.length,
        items: items.slice(0, params.limit),
      };
    },
  }),

  def({
    name: 'find_silences',
    description:
      'Return the silent stretches of the project, already converted to TIMELINE seconds and merged across tracks. Feed these straight into remove_ranges to cut pauses.',
    schema: z.object({
      minDuration: z.number().min(0.05).max(30).default(0.6).describe('Ignore pauses shorter than this.'),
      assetId: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(200),
    }),
    run: (params, ctx) => {
      const ranges = timelineSilences(ctx.state, params.minDuration, params.assetId);
      const total = ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
      return {
        count: ranges.length,
        totalSeconds: Math.round(total * 100) / 100,
        timelineDuration: timelineDuration(ctx.state),
        ranges: ranges.slice(0, params.limit).map((r) => ({
          start: Math.round(r.start * 1000) / 1000,
          end: Math.round(r.end * 1000) / 1000,
        })),
        note:
          ranges.length === 0
            ? 'No silences were detected. The media may not be analysed yet, or the recording has no clear pauses.'
            : 'These are timeline seconds. Pass them to remove_ranges exactly as given.',
      };
    },
  }),

  def({
    name: 'find_in_transcript',
    description:
      'Find where a word or phrase is spoken, returned as TIMELINE ranges. Use it for requests like "cut the part where I say ehm" or "find where he mentions the price".',
    schema: z.object({
      query: z.string().min(1).max(200),
      padding: z.number().min(0).max(2).default(0.05),
      assetId: z.string().optional(),
      limit: z.number().int().min(1).max(300).default(100),
    }),
    run: (params, ctx) => {
      const hits = findInTranscript(ctx.state, params.query, {
        padding: params.padding,
        assetId: params.assetId,
      });
      return {
        count: hits.length,
        hits: hits.slice(0, params.limit).map((h) => ({
          start: Math.round(h.start * 1000) / 1000,
          end: Math.round(h.end * 1000) / 1000,
          text: h.text,
          clipId: h.clipId,
        })),
      };
    },
  }),

  def({
    name: 'find_gaps',
    description: 'List empty stretches on a track, so you can close them or fill them.',
    schema: z.object({ trackId: z.string(), minGap: z.number().min(0).default(0.05) }),
    run: (params, ctx) => ({ gaps: gapsOnTrack(ctx.state, params.trackId, params.minGap) }),
  }),

  def({
    name: 'get_media_assets',
    description: 'List the media in this project with duration, resolution, audio info and analysis status.',
    schema: z.object({}),
    run: (_params, ctx) =>
      ctx.state.assets.map((asset) => {
        const analysis = ctx.state.analysis[asset.id];
        return {
          id: asset.id,
          name: asset.name,
          kind: asset.kind,
          duration: asset.duration,
          width: asset.width,
          height: asset.height,
          fps: asset.fps,
          hasAudio: asset.hasAudio,
          transcribed: Boolean(analysis?.words.length),
          silenceCount: analysis?.silences.length ?? 0,
          usedByClips: ctx.state.clips.filter((c) => 'assetId' in c && c.assetId === asset.id).map((c) => c.id),
        };
      }),
  }),

  def({
    name: 'find_highlights',
    description:
      'Rank the moments most worth keeping, scored on speech density, loudness, reaction words and dead air. Returns TIMELINE ranges with the spoken text, so you can read them and decide which are actually good. Pair with `remove_ranges` on the inverse to cut everything else.',
    schema: z.object({
      targetSeconds: z.number().min(2).max(60).default(9).describe('Roughly how long each candidate should be.'),
      limit: z.number().int().min(1).max(40).default(12),
      assetId: z.string().optional(),
    }),
    run: (params, ctx) => {
      const highlights = findHighlights(ctx.state, {
        targetSeconds: params.targetSeconds,
        limit: params.limit,
        assetId: params.assetId,
      });
      if (highlights.length === 0) {
        return {
          count: 0,
          message:
            'No transcript to score. Ask the user to transcribe the media first, or work from find_silences instead.',
        };
      }
      return {
        count: highlights.length,
        note: 'Ranked best first. These are timeline seconds.',
        highlights: highlights.map((h) => ({
          start: Math.round(h.start * 1000) / 1000,
          end: Math.round(h.end * 1000) / 1000,
          score: h.score,
          why: h.reasons,
          text: h.text,
        })),
      };
    },
  }),

  def({
    name: 'plan_shortened_cut',
    description:
      'Given the highlights you want to keep, returns the ranges to REMOVE so only those survive. Feed the result straight into remove_ranges. This is the reliable way to build a short version from a long recording.',
    schema: z.object({
      keep: z.array(z.object({ start: z.number().min(0), end: z.number().min(0) })).min(1).max(100),
      padding: z.number().min(0).max(3).default(0.15).describe('Seconds of breathing room kept around each piece.'),
    }),
    run: (params, ctx) => {
      const duration = timelineDuration(ctx.state);
      const remove = inverseRanges(params.keep, duration, params.padding);
      const kept = params.keep.reduce((sum, r) => sum + (r.end - r.start), 0);
      return {
        timelineDuration: duration,
        keptSeconds: Math.round(kept * 100) / 100,
        removeRanges: remove.map((r) => ({
          start: Math.round(r.start * 1000) / 1000,
          end: Math.round(r.end * 1000) / 1000,
        })),
        note: 'Pass removeRanges to remove_ranges with ripple true.',
      };
    },
  }),

  def({
    name: 'get_sound_effects',
    description:
      'The built-in sound effect catalogue. Every sound is synthesised on demand, so any of these can be used immediately with add_sound_effect or add_sound_effects.',
    schema: z.object({ category: z.string().optional() }),
    run: (params) => {
      const all = SFX_LIBRARY_INFO;
      const filtered = params.category ? all.filter((s) => s.category === params.category) : all;
      return { count: filtered.length, sounds: filtered };
    },
  }),

  def({
    name: 'get_markers',
    description: 'Named points the user (or you) placed on the timeline.',
    schema: z.object({}),
    run: (_params, ctx) => ctx.state.markers.map((m) => ({ id: m.id, time: m.time, label: m.label })),
  }),

  def({
    name: 'get_selection',
    description: 'What the user currently has selected, and where the playhead is.',
    schema: z.object({}),
    run: (_params, ctx) => ({
      selectedClipIds: ctx.selection,
      playhead: ctx.playhead,
      selectedClips: ctx.state.clips
        .filter((c) => ctx.selection.includes(c.id))
        .map((c) => ({ id: c.id, name: c.name, kind: c.kind, start: c.start, end: clipEnd(c) })),
    }),
  }),
];

export const READ_TOOL_MAP = new Map(READ_TOOLS.map((tool) => [tool.name, tool]));

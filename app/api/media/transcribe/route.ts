import { NextResponse, type NextRequest } from 'next/server';
import OpenAI from 'openai';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  describeOpenAIError,
  getOpenAI,
  isModelUnavailable,
  rememberTranscribeModel,
  transcribeModelCandidates,
} from '@/lib/openai/client';
import type { Json } from '@/types/database';
import type { TranscriptSegment, TranscriptWord } from '@/types/editor';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_CHUNK_BYTES = 24 * 1024 * 1024;

interface VerboseTranscription {
  text?: string;
  language?: string;
  words?: { word: string; start: number; end: number }[];
  segments?: { id: number; start: number; end: number; text: string }[];
}

/**
 * Transcribes one audio chunk with word-level timestamps.
 *
 * The browser extracts 16 kHz mono WAV and sends it in slices, so a two-hour
 * recording still fits inside the per-request upload limit and nothing is
 * silently truncated. Timestamps are shifted by the chunk offset before they
 * are merged into media_analysis.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'not_authenticated' }, { status: 401 });

  const form = await request.formData();
  const file = form.get('file');
  const assetId = String(form.get('assetId') ?? '');
  const offset = Number(form.get('offset') ?? 0);
  const isFirst = String(form.get('isFirst') ?? 'false') === 'true';
  const isLast = String(form.get('isLast') ?? 'false') === 'true';
  const language = (form.get('language') as string | null) || undefined;

  if (!(file instanceof File) || !assetId) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  if (file.size > MAX_CHUNK_BYTES) {
    return NextResponse.json({ error: 'chunk_too_large' }, { status: 413 });
  }

  const { data: asset } = await supabase
    .from('media_assets')
    .select('id, project_id, name')
    .eq('id', assetId)
    .maybeSingle();
  if (!asset) return NextResponse.json({ error: 'asset_not_found' }, { status: 404 });

  let charged = 0;
  if (isFirst) {
    const { data: charge, error: chargeError } = await supabase.rpc('consume_credits', {
      p_reason: 'transcription',
      p_project_id: asset.project_id,
      p_metadata: { assetId } as unknown as Json,
    });
    if (chargeError) {
      if (chargeError.message.includes('insufficient_credits')) {
        let detail: unknown = null;
        try {
          detail = JSON.parse(chargeError.details ?? 'null');
        } catch {
          detail = null;
        }
        return NextResponse.json({ error: 'insufficient_credits', detail }, { status: 402 });
      }
      return NextResponse.json({ error: 'credit_error', message: chargeError.message }, { status: 500 });
    }
    charged = Number((charge as { charged?: number } | null)?.charged ?? 0);
    await supabase.from('media_assets').update({ analysis_status: 'transcribing', analysis_error: null }).eq('id', assetId);
  }

  try {
    const openai = getOpenAI();
    let result: VerboseTranscription | null = null;
    let lastError: unknown = null;

    for (const model of transcribeModelCandidates()) {
      try {
        const response = await openai.audio.transcriptions.create({
          file,
          model,
          response_format: 'verbose_json',
          timestamp_granularities: ['word', 'segment'],
          ...(language ? { language } : {}),
        });
        result = response as unknown as VerboseTranscription;
        rememberTranscribeModel(model);
        break;
      } catch (error) {
        lastError = error;
        const unsupportedFormat =
          error instanceof OpenAI.APIError &&
          error.status === 400 &&
          String(error.message).toLowerCase().includes('timestamp');
        if (!isModelUnavailable(error) && !unsupportedFormat) throw error;
      }
    }
    if (!result) throw lastError ?? new Error('No usable transcription model was found.');

    const words: TranscriptWord[] = (result.words ?? []).map((w) => ({
      word: w.word,
      start: Math.round((w.start + offset) * 1000) / 1000,
      end: Math.round((w.end + offset) * 1000) / 1000,
    }));
    const segments: TranscriptSegment[] = (result.segments ?? []).map((s, index) => ({
      id: index,
      start: Math.round((s.start + offset) * 1000) / 1000,
      end: Math.round((s.end + offset) * 1000) / 1000,
      text: s.text.trim(),
    }));

    // Merge into whatever earlier chunks already stored.
    const { data: existing } = await supabase
      .from('media_analysis')
      .select('words, segments, transcript_text')
      .eq('asset_id', assetId)
      .maybeSingle();

    const previousWords = isFirst ? [] : ((existing?.words as unknown as TranscriptWord[]) ?? []);
    const previousSegments = isFirst ? [] : ((existing?.segments as unknown as TranscriptSegment[]) ?? []);
    const previousText = isFirst ? '' : (existing?.transcript_text ?? '');

    const mergedWords = [...previousWords, ...words];
    const mergedSegments = [...previousSegments, ...segments].map((s, index) => ({ ...s, id: index }));
    const mergedText = [previousText, result.text?.trim() ?? ''].filter(Boolean).join(' ');

    const transcriptFields = {
      language: result.language ?? null,
      transcript_text: mergedText,
      words: mergedWords as unknown as Json,
      segments: mergedSegments as unknown as Json,
      model: 'openai',
    };
    if (existing) {
      // Update rather than upsert so the locally computed silence map survives.
      await supabase.from('media_analysis').update(transcriptFields).eq('asset_id', assetId);
    } else {
      await supabase
        .from('media_analysis')
        .insert({ asset_id: assetId, project_id: asset.project_id, ...transcriptFields });
    }

    if (isLast) {
      await supabase.from('media_assets').update({ analysis_status: 'analyzed' }).eq('id', assetId);
    }

    return NextResponse.json({
      ok: true,
      charged,
      language: result.language ?? null,
      words: mergedWords,
      segments: mergedSegments,
      text: mergedText,
    });
  } catch (error) {
    if (charged > 0) {
      await supabase.rpc('refund_credits', {
        p_reason: 'transcription',
        p_amount: charged,
        p_project_id: asset.project_id,
      });
    }
    const described = describeOpenAIError(error);
    await supabase
      .from('media_assets')
      .update({ analysis_status: 'failed', analysis_error: described.message })
      .eq('id', assetId);
    return NextResponse.json({ error: described.code, message: described.message }, { status: described.status });
  }
}

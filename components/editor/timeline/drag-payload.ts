/** Mime type used when dragging media from the library onto the timeline. */
export const MEDIA_DRAG_TYPE = 'application/x-videoai-asset';

export interface MediaDragPayload {
  assetId: string;
  kind: 'video' | 'audio' | 'image';
  duration: number;
  name: string;
}

export function writeMediaDrag(event: React.DragEvent, payload: MediaDragPayload): void {
  event.dataTransfer.setData(MEDIA_DRAG_TYPE, JSON.stringify(payload));
  // A plain-text fallback keeps the drag legible to other drop targets.
  event.dataTransfer.setData('text/plain', payload.name);
  event.dataTransfer.effectAllowed = 'copy';
}

export function readMediaDrag(event: React.DragEvent): MediaDragPayload | null {
  const raw = event.dataTransfer.getData(MEDIA_DRAG_TYPE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as MediaDragPayload;
    return parsed && typeof parsed.assetId === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** True while a media drag is in flight, even before the data can be read. */
export function isMediaDrag(event: React.DragEvent): boolean {
  return event.dataTransfer.types.includes(MEDIA_DRAG_TYPE);
}

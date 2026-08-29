# Export

## What happens today

Export runs **in the browser**, in the tab the user has open, and produces a real
video file.

```
timeline state
   ↓
for each output frame:
   decode the exact source frame for every visible clip   (mediabunny → WebCodecs)
   composeFrame(...)                                       (the same function the preview uses)
   encode the canvas                                       (VideoEncoder)
   ↓
mix the audio in 30-second segments                        (OfflineAudioContext)
encode it                                                   (AudioEncoder)
   ↓
mux                                                         (MP4 or WebM)
   ↓
Blob → download, and optionally uploaded to the exports bucket
```

Concretely:

- **Frames are decoded, not seeked.** Each clip gets its own decoder stream fed
  the exact list of timestamps that clip needs, in order. That is the fast path
  for every codec, and it is frame-accurate — unlike seeking a `<video>` element,
  which is what the preview does.
- **Reversed and frozen clips** fall back to direct seeking, because their
  timestamps are not monotonic.
- **Audio is mixed in segments** so a one-hour export never holds more than
  thirty seconds of PCM at a time. Volume, keyframed volume and fades become a
  gain envelope sampled 20 times a second.
- **Codec support is checked first.** H.264 is preferred; VP9/WebM is the
  automatic fallback. If the browser cannot decode a *source* file, the dialog
  says so by name before the render starts rather than failing halfway through.

Verified end to end: `scripts/harness/export.html` runs the real exporter against
local test clips and the output was probed with ffprobe — correct duration,
frame rate, resolution, a real audio track, and the crossfade, keyframed zoom and
captions all present in the pixels.

### Limits, stated plainly

- It needs WebCodecs. Recent Chrome, Edge and Safari have it; Firefox's support
  is newer and less complete. The dialog refuses rather than pretending.
- The tab has to stay open. Rendering a ten-minute 1080p timeline takes minutes.
- Very long projects are bounded by browser memory, since the finished file is
  assembled in an ArrayBuffer before download.

## The seam for a server renderer

`exports` rows already carry `engine` (`browser` | `server`), `status`,
`progress`, `output_path`, `size_bytes` and `error_message`, and the UI reads
them. `RENDER_WORKER_URL` and `RENDER_WORKER_TOKEN` are reserved in
`.env.example`. **Nothing today writes `engine: 'server'`** — that path is not
implemented, and the UI does not offer it.

To add one, a worker needs to:

1. Accept `{ projectId, timelineId, settings, exportId }` plus a service-role token.
2. Load the timeline with the same queries as `lib/actions/editor-data.ts`.
3. Render it. Two honest options:
   - **Headless Chromium**, reusing `lib/render/export.ts` verbatim. Same code,
     same output, no second implementation to keep in sync. Slower per frame but
     correct by construction.
   - **FFmpeg**, translating the timeline into a filter graph. Much faster, but a
     second renderer that will drift from the compositor unless carefully tested
     against it. If you go this way, snapshot-test its frames against
     `composeFrame` output.
4. Upload to the `exports` bucket at `user/{userId}/projects/{projectId}/{exportId}.mp4`.
5. Update the `exports` row: `progress` while working, then `status = 'completed'`
   with `output_path` and `size_bytes`, or `failed` with `error_message`.

The client side is then a matter of posting to the worker instead of calling
`exportProject`, and polling the row. The dialog's states (queued, rendering with
progress, completed with a download, failed with a message) already exist.

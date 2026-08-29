# Architecture

The whole product rests on one decision: **there is exactly one way to change a project.**

```
     UI (click, drag, keyboard)            AI assistant
                  │                             │
                  └──────────┬──────────────────┘
                             ▼
                   Editor Command Engine
             (Zod validation → pure reducer)
                             │
                  ┌──────────┴──────────┐
                  ▼                     ▼
             Editor state          History (transactions)
                  │
                  ▼
            Persistence (save_timeline RPC)
```

A user trimming a clip and the assistant trimming a clip produce the identical
`trim_clip` command, validated by the identical schema, applied by the identical
reducer. There is no "AI mode" that shadows the editor.

## The command engine

`lib/editor/actions/` holds ~50 action definitions. Each one is:

```ts
{
  type: 'split_clip',
  category: 'clip',
  schema: z.object({ clipId: uuidLike, time: z.number().min(0), newClipId: uuidLike.optional() }),
  summary: 'Cut a clip in two at a timeline timestamp…',   // this is what the model reads
  prepare(params, ctx) { … },                              // fills in generated ids
  apply(state, params, ctx) { … },                         // pure, immutable
}
```

Three properties follow from that shape and matter a lot:

**Validation happens once, in one place.** `applyAction` parses the parameters
with the action's schema and then resolves every referenced id through helpers
that throw a structured `EditorError`. The AI cannot reach the reducer with a
malformed command, and it cannot invent an id, because the lookup fails with a
machine-readable code the model can act on.

**Generated ids are normalised into the action.** `prepare` fills in the id for
anything the action creates. The server therefore returns an action list that
replays byte-for-byte identically on the client. That is what lets the AI run
server-side and still hand the browser a command list rather than a new state.

**Actions compose.** `applyActions` runs a list and bumps the revision once.
Nothing is committed unless the whole list succeeds — an AI request either lands
completely or not at all.

## Undo and redo

`lib/editor/history.ts` stores transactions as `{ before, after, actions }`.
Undo restores `before`; redo restores `after`.

Snapshots sound expensive. They are not, because every reducer is written
immutably with structural sharing: changing one clip's opacity produces a new
clips array where 499 of 500 entries are *the same object*. `tests/history.test.ts`
asserts this directly. So a hundred-deep history costs roughly what the changed
objects cost, not a hundred copies of the project.

The important consequence: an assistant request that runs twelve commands is one
history entry. `Ctrl+Z` reverses the whole thing.

Note that undo/redo is per session, in memory. The database keeps the *audit*
trail (`editor_history`) — what happened and in what order — not the snapshots.

## State and persistence

`lib/editor/store.ts` is a Zustand store holding the editor state, the history,
the selection, the playhead and the save status. Autosave subscribes to state
changes, debounces 1.4 s, and sends the whole timeline to the `save_timeline`
Postgres function.

Sending the whole timeline in one call is deliberate. The alternative — diffing
and issuing per-row writes — is more code, more round trips, and can leave a
project half-saved if one write fails. `save_timeline` upserts every track and
clip, deletes what is no longer there, replaces the clip-scoped effects and
keyframes, and bumps the revision, all in one transaction under the caller's own
RLS. A project of a few hundred clips is a small JSON payload.

## Rendering

`lib/render/compose.ts` exports `composeFrame(ctx, state, time, provider)`. It is
the only code that decides what a frame looks like. Two things implement the
`FrameProvider` interface it draws from:

- **the preview** (`lib/render/media-pool.ts`) backs it with `<video>` elements,
  which give hardware decoding and real audio for free;
- **the exporter** (`lib/render/export.ts`) backs it with frames decoded by
  mediabunny at exact timestamps.

Because both go through the same drawing code, the preview is not an
approximation of the export — it is the export at a lower resolution with a
sloppier clock.

## Media analysis

Everything cheap happens in the browser, once, at upload time:

- container metadata (duration, resolution, frame rate) read by demuxing, not guessed;
- a poster frame;
- a 1200-bucket waveform;
- **silence detection** from RMS windows over the decoded audio.

Only transcription costs money, and it is the user's explicit choice. The
silence map is what makes "remove all the pauses" work with no AI call at all —
the assistant just reads `find_silences` and issues one `remove_ranges`.

## Trust boundaries

- The **anon key** is public. RLS is the security boundary, and `supabase/test/10_rls_test.sql` proves it.
- The **service role key** and the **OpenAI key** are server-only and never reach the bundle.
- The AI receives a project snapshot from the client. It is validated with Zod, but it is *not* trusted for authorisation: the server independently checks that the caller may edit the project id, and the assistant's output is a command list, not a database write. Persistence still goes through `save_timeline` under RLS.
- The assistant can only run defined, validated editor actions. It cannot execute code, run SQL, read secrets, or touch anything outside the project it was invoked on.

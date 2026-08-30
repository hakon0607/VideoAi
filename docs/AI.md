# How the assistant works

## The pipeline

```
user message
   ↓
project snapshot + system prompt + conversation history
   ↓
OpenAI, with tools = 8 read tools + every editor command
   ↓
   ├── read tool  → answered from the working copy
   └── editor command → Zod validated → applied to the working copy
   ↓                                          │
   └──────────── loop until the model stops ──┘
   ↓
validated command list returned to the browser
   ↓
replayed through the same engine as ONE transaction
   ↓
autosaved
```

The loop runs on the server against a *working copy* of the project. That is
what makes error recovery real: when the model calls `split_clip` with a clip id
that no longer exists, it gets

```json
{ "error": "clip_not_found",
  "message": "No clip with id … exists on this timeline.",
  "details": { "availableClipIds": ["…"] } }
```

back as the tool result, in the same turn, and can fix itself. The browser never
sees an invalid command.

## The tools

Read tools exist so the model never has to guess:

| Tool | Why it exists |
| --- | --- |
| `get_project_state` | The whole project: settings, tracks, clips with real ids, assets, selection, playhead |
| `get_clips` | Detail for clips the summary collapsed (long caption runs, for instance) |
| `get_transcript` | Words or segments, **already converted to timeline seconds** |
| `find_silences` | Pauses, merged across tracks, in timeline seconds |
| `find_in_transcript` | Where a word or phrase is spoken, in timeline seconds |
| `find_gaps` | Empty stretches on a track |
| `get_media_assets` | Durations, resolutions, what is transcribed |
| `get_selection` | What the user has selected and where the playhead is |
| `find_highlights` | Scores windows of the transcript on word density, loudness, reaction words and dead air, so "take the best bits" starts from evidence rather than a guess |
| `plan_shortened_cut` | Turns a target length into the exact ranges to remove, in timeline seconds |
| `get_sound_effects` | The synthesised sound catalogue, with a line on what each one is for |
| `get_markers` | Markers the user placed, so "fix the bit I flagged" resolves to a time |

The conversions matter more than they look. Source time and timeline time differ
by the clip's in-point, its speed and whether it is reversed. Asking a language
model to do that arithmetic is asking for off-by-a-second edits. So the server
does it, and every timestamp the model ever sees or sends is timeline time.

Write tools are generated from the action registry. Adding an action to
`lib/editor/actions/` exposes it to the assistant automatically — there is no
second list to keep in sync. `tests/ai-tools.test.ts` asserts that.

## Context size

A project with a 400-line subtitle track would otherwise crowd out everything
else. `buildProjectContext` collapses caption runs into a summary
(`captionGroups: [{ groupId, lines: 400, start, end }]`) and tells the model how
to expand it with `get_clips`. Tool results are capped at 24 KB.

## Confirmation

Actions marked `destructive` (`remove_asset`, `delete_track`) are not executed.
The server emits a `confirm` event, the assistant explains what it wants to do,
and the request is only re-run with `allowDestructive: true` after the user
agrees. Everything else is reversible through the history, so it just runs.

## Cost

One AI request costs `ai_command` credits, charged before the work starts. If it
fails the charge is refunded. If it turns out the model only read and answered —
zero commands executed — the charge is refunded and re-billed at the cheaper
`ai_question` price.

## Prompting

`lib/ai/system-prompt.ts` is deliberately about *judgement*, not mechanics: the
tool schemas already say what each command does. The prompt says what "more
energetic" should mean, how long a caption line should be, that "clearer voice"
means lowering the music rather than maximising everything, and — importantly —
that it should say so plainly when something is not possible instead of claiming
it did it.

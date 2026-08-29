# Database

Every table uses UUID primary keys, `created_at`/`updated_at` timestamps, foreign
keys with `on delete cascade` toward the project, and Row Level Security.

## Tables

| Table | Holds |
| --- | --- |
| `profiles` | Username, display name, avatar, locale, admin flag. One per auth user |
| `projects` | Name, aspect ratio, resolution, fps, background, export defaults, thumbnail, duration |
| `project_members` | Sharing. The owner is an implicit member |
| `media_assets` | Uploaded files: kind, storage path, duration, resolution, fps, waveform, poster frame, analysis status |
| `media_analysis` | Transcript text, word timestamps, segments, detected silences, loudness |
| `timelines` | One primary timeline per project, with a revision counter |
| `tracks` | Kind, name, layer index, mute/hide/lock, volume, row height |
| `clips` | Every clip — video, audio, image and text — with timing, source in-point, speed, volume, fades, opacity, transform, crop, text content and style, and both transitions |
| `effects` | One row per effect on a clip, with JSONB parameters |
| `keyframes` | One row per keyframe: property, time, value, easing |
| `editor_history` | Audit trail: which commands ran, in what order, from the UI or the AI |
| `ai_conversations` / `ai_messages` | Chat per project and user, including the commands each answer produced |
| `exports` | Render jobs: status, progress, settings, output path |
| `user_credits`, `credit_costs`, `credit_ledger` | The credit system |

## Views

The spec asks for `text_elements`, `captions`, `audio_elements` and
`transitions` as first-class concepts. They are **views over `clips`** rather
than separate tables, because a caption *is* a text clip: it is trimmed, moved,
restyled and deleted by exactly the same commands. Splitting them across tables
would mean four code paths for one behaviour, and joins on every timeline read.

The views give the vocabulary without the duplication, and they are
`security_invoker`, so they inherit the RLS of `clips`.

## Why some things are JSONB

Real columns for anything queried or constrained: timing, ids, flags, volumes.
JSONB for shapes that evolve with the editor and are always read as a unit:
`transform`, `crop`, `text_style`, `transition_in`/`transition_out`, effect
`params`, and the transcript arrays. Adding a text style property should not
require a migration; changing how clips are timed should.

## Row Level Security

Two `SECURITY DEFINER` helpers decide everything:

- `is_project_member(project_id)` — owner or member. Gates reads.
- `can_edit_project(project_id)` — owner or member with role `owner`/`editor`. Gates writes.

They are `SECURITY DEFINER` deliberately: a policy on `project_members` that
queried `project_members` would recurse.

Every project-scoped table gets the same four policies, generated in a loop so
they cannot drift apart. AI conversations carry an extra condition — they are
private to the user who wrote them, even inside a shared project.

Storage is locked by path: `media` and `exports` objects must live under
`user/{auth.uid()}/…`, enforced by policies on `storage.objects`, so a signed
URL is the only way anyone else's file is ever reachable.

`supabase/test/10_rls_test.sql` proves the guarantees against a real Postgres:
33 assertions covering cross-user reads, writes and deletes on every table,
self-service credit top-ups, spending past zero, refills, admin grants and
storage paths. Run it with `bash scripts/db-test.sh`.

## save_timeline

The editor writes through one function:

```sql
select public.save_timeline('{"projectId":"…","timelineId":"…","tracks":[…],"clips":[…]}'::jsonb);
```

It is `SECURITY INVOKER`, so RLS applies. It updates the project settings,
upserts tracks and clips, deletes what the payload no longer contains, replaces
the clip-scoped effects and keyframes, and bumps the timeline revision — in one
transaction. Either the whole timeline is saved or none of it is.

## Useful queries

```sql
-- biggest projects
select name, duration_seconds, (select count(*) from clips where project_id = p.id) as clips
from projects p order by duration_seconds desc limit 20;

-- what the AI has been doing
select created_at, label, jsonb_array_length(actions) as commands
from editor_history where source = 'ai' order by created_at desc limit 50;

-- storage used per user
select owner_id, pg_size_pretty(sum(size_bytes)) from media_assets group by owner_id;

-- credit spend, last 24 hours
select reason, count(*), sum(-delta) as spent
from credit_ledger where delta < 0 and created_at > now() - interval '1 day'
group by reason;
```

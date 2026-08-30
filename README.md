# VideoAI

A video editor where the AI assistant is not a chatbot bolted on the side — it drives the same editor you do, through the same validated commands.

Built with Next.js (App Router), TypeScript, Tailwind, Supabase (Auth, Postgres, Storage, RLS) and the OpenAI API. Renders real video files in the browser with WebCodecs.

---

## What it actually does

- **A public front page** at `/` describing the product, in both languages, with the editor behind sign-in.
- **Multitrack timeline** — video, audio, text and overlay tracks; drag, trim, split, ripple delete, close gaps, detach audio, freeze, reverse, snap (toggleable), markers, per-kind track naming, reorder and rename in place, zoom from frame level out to a two-hour project, and a minimap.
- **A CapCut-shaped library** — a vertical icon rail with Media, Text, Sounds, Stickers, Audio, Effects and Transitions, and an inspector that shares the right column with the assistant.
- **Media folders** — bins you create, rename and drag files into, plus search across the whole library and a grid or list view.
- **A built-in sound library** — 16 effects synthesised in the browser (whooshes, impacts, pops, comedy, musical). Nothing is downloaded or licensed, and the same id always renders the same waveform, so a project sounds identical everywhere.
- **Emoji stickers** with pop, bounce, shake and zoom animations.
- **Real audio processing** — voice presets built from biquad filters, compression, make-up gain and automatic ducking under speech. The preview and the exporter run the same graph.
- **Preview that matches the export** — the preview and the exporter run the *same* compositing function, so what you see is what the file contains.
- **Real media analysis** — on upload, VideoAI reads duration, resolution and frame rate straight out of the container, grabs a poster frame, computes a waveform and detects every pause. All locally, at no cost.
- **Real transcription** — word-level timestamps from OpenAI, chunked so a two-hour recording is never truncated. This is what makes "remove all the pauses", "cut where I say ehm" and genuine captions possible.
- **AI that edits** — the assistant has ~70 editor commands and 12 read tools, including highlight-finding for "take the best bits of this".
- **An engine that refuses to corrupt itself** — every action is checked *after* it runs against the things the renderer, the timeline and the database all assume: no duplicate ids, no clip on a missing or wrong-kind track, no NaN, nothing shorter than a frame. A bad parameter becomes a clear error the assistant can recover from, never a broken project.
- **Nothing is ever hidden behind something else** — adding, moving, duplicating, captioning, detaching audio and dropping a sound all land on a free lane, adding one if they have to. Locked clips and locked tracks stay put, and a ripple edit settles around them instead of sliding clips underneath. It inspects the real timeline, plans, executes, and everything it does in one request is **one** undo step.
- **Real export** — H.264/MP4 or VP9/WebM rendered in the browser from the timeline, with a mixed audio track. Not a stub, not a screen recording.
- **Credits** — every user gets a balance that refills on a schedule; you control the price list and per-user balances from the admin panel or the Supabase dashboard.
- **An admin panel** — every user, project and file in one place, with storage totals, credit history, and the controls to change any of it.
- **Norwegian and English** interface.

## What is *not* built (deliberately, and honestly)

- **Server-side rendering of video.** Export runs in the browser. The architecture has a clean seam for a server renderer (`lib/render/export.ts` + the `exports` table + `RENDER_WORKER_URL`), and `docs/EXPORT.md` describes exactly what a worker has to implement. Nothing in the UI pretends a server render exists.
- **Real-time collaboration.** `project_members` and the RLS policies are in place so two people *can* have access to a project, but there is no presence, no cursors and no operational transform. Two people editing at once will overwrite each other's autosaves.
- **Scene detection and speaker diarisation.** The transcript and silence map are real; "find the best parts" is the model reasoning over those, not a vision model watching the footage.
- **Reverse playback in the preview** is seek-based and therefore choppy. The export renders it correctly.

---

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in the values below
npm run dev
```

Open http://localhost:3000.

### 1. Supabase

Create a project at [supabase.com](https://supabase.com), then:

1. **Run the schema.** In the SQL editor, paste and run `supabase/setup_all_in_one.sql`. That is every migration in `supabase/migrations/` concatenated in order, and it is safe to re-run. (If you add a migration, `npm run build:sql` rebuilds that file.)
2. **Check the buckets.** The migration creates `media` (private), `exports` (private) and `avatars` (public). Confirm them under Storage.
3. **Set the auth URLs.** Authentication → URL Configuration:
   - Site URL: your deployed URL (e.g. `https://videoai.vercel.app`), or `http://localhost:3000` locally.
   - Redirect URLs: add `http://localhost:3000/auth/callback` and `https://<your-domain>/auth/callback`.
4. **Copy the keys.** Settings → API gives you the project URL, the anon key and the service role key.

To run the migrations one at a time instead, apply `supabase/migrations/0001_schema.sql` through `0005_storage.sql` in order.

### 2. OpenAI

Create an API key at [platform.openai.com](https://platform.openai.com). The key is only ever read server-side, inside API routes. The app walks a fallback chain of chat models, so it keeps working when a model name is retired; pin one with `OPENAI_MODEL` if you want.

### 3. Environment variables

| Variable | Where | What it is |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Public anon key. Safe to expose; RLS is the real boundary |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Bypasses RLS. Never prefix with `NEXT_PUBLIC_` |
| `OPENAI_API_KEY` | **server only** | Used by `/api/ai/*` and `/api/media/transcribe` |
| `OPENAI_MODEL` | server, optional | Pin a chat model instead of using the fallback chain |
| `OPENAI_TRANSCRIBE_MODEL` | server, optional | Pin a transcription model |
| `NEXT_PUBLIC_SITE_URL` | client | Base URL used for auth redirects |
| `RENDER_WORKER_URL` / `RENDER_WORKER_TOKEN` | server, optional | Reserved for a future server-side renderer |

`.env.example` lists them all. `.env.local` is gitignored — do not commit secrets.

### 4. Raise the upload limit

Supabase enforces a maximum upload size per project, and on the free plan it
defaults to **50 MB** — which is almost always the reason a video upload fails.
Raise it in the dashboard under **Storage → Settings → Upload file size limit**.
The buckets inherit the project limit, so nothing else needs changing.

VideoAI reads that limit and refuses a too-large file up front with the exact
numbers, rather than uploading for ten minutes and failing. Files over 6 MB go
up with the resumable protocol, so a dropped connection costs one 6 MB chunk
instead of the whole upload.

### 5. Make yourself an admin

After signing up once:

```sql
update public.profiles set is_admin = true where username = 'your-username';
update public.user_credits set unlimited = true
where user_id = (select user_id from public.profiles where username = 'your-username');
```

Reload the app and you will see an **Admin** entry in the sidebar, a shield on
your avatar, and your credit badge showing **Unlimited** in the accent colour.
Everything below can then be done from `/admin` instead of SQL.

## The admin panel

`/admin` is visible only to users with `is_admin`, and every action is checked
again inside the database, so the panel is a convenience rather than the
security boundary.

| Tab | What it shows |
| --- | --- |
| Overview | Users, projects, storage, AI usage, exports, credits spent, who is active |
| Users | Every account with its email, credits, project count, storage and AI usage. Click a row to set a balance, grant unlimited credits, change the refill, or promote to admin |
| Projects | Every project with its owner's email, length, clip count, size and AI edits. Delete a project and its files from here |
| Media | Every uploaded file with its owner, project, size and analysis status |
| Credits | The price list, editable in place, and the full credit ledger |
| Storage | Scans the buckets for files no database row points at, and removes them |

Deleting another user's files needs `SUPABASE_SERVICE_ROLE_KEY` to be set in the
environment. Without it the rows are still removed and the panel says plainly
that the files were left behind.

### Finding what belongs to whom in Supabase

Migration `0006` adds descriptions to every table and four admin views you can
query straight from the SQL editor:

```sql
select * from admin_users;             -- everyone, with credits and storage
select * from admin_projects;          -- every project, with its owner's email
select * from admin_media;             -- every file, with owner and project
select * from admin_credit_activity;   -- the ledger, with names attached
select * from project_storage;         -- bytes per project (any user, own rows)
```

They return rows only for an admin, so they are safe to leave in place.

---

## Credits

Every user has a wallet in `public.user_credits`. It refills lazily — there is no cron job; the balance is topped up the first time it is read after the interval has passed.

| Column | Default | Meaning |
| --- | --- | --- |
| `balance` | 1000 | Current credits |
| `refill_amount` | 1000 | Topped up to this each period |
| `refill_interval` | `8 hours` | How often |
| `unlimited` | `false` | When true, nothing is ever charged |

Prices live in `public.credit_costs` and can be edited in the dashboard without a deploy:

| Key | Default | When |
| --- | --- | --- |
| `ai_command` | 250 | An AI request that changes the project |
| `ai_question` | 60 | An AI request that only reads and answers |
| `transcription` | 300 | Transcribing one media asset, however long |
| `export` | 0 | Rendering (it happens in the browser) |

With the defaults, 1000 credits is three to four AI edits per eight-hour period.

**Common operations, straight from the SQL editor:**

```sql
-- give one user more credits
update public.user_credits set balance = 5000 where user_id = '<uuid>';

-- give one user unlimited credits
update public.user_credits set unlimited = true where user_id = '<uuid>';

-- change what everyone gets per period
update public.user_credits set refill_amount = 2000;

-- make AI edits cheaper
update public.credit_costs set cost = 150 where key = 'ai_command';

-- see where someone's credits went
select * from public.credit_ledger where user_id = '<uuid>' order by created_at desc;
```

A failed AI request is refunded automatically, and a request that turns out to be a question rather than an edit is re-billed at the cheaper `ai_question` price.

---

## Deleting things

Deleting a project removes its rows **and** the files behind it: the app asks
the database which storage objects only that project references, deletes the
project, then clears those objects and walks the project's folder in both
buckets for anything left over. Files shared with a duplicated project are kept.

Deleting a single media file works the same way — the object is only removed
once no surviving row points at it.

If something ever does get orphaned (an upload interrupted halfway, say), the
admin panel's Storage tab finds it and cleans it up.

## Deploying to Vercel

1. Push the repository to GitHub.
2. Import it at [vercel.com/new](https://vercel.com/new). Framework preset: Next.js. No build settings need changing.
3. Add all the environment variables from the table above under Settings → Environment Variables.
4. Deploy, then go back to Supabase and add `https://<your-domain>/auth/callback` to the redirect URLs.

Things that matter on Vercel and are already handled:

- **Uploads never touch a serverless function.** The browser uploads straight to Supabase Storage through a signed upload URL, so the 4.5 MB request limit is irrelevant and a 2 GB file is fine.
- **Export never touches a serverless function.** It runs in the browser, so there is no 60/300 second timeout to hit.
- **The AI route streams** and declares `maxDuration = 300`, so long tool-calling turns are not cut off.
- **Transcription is chunked** client-side into pieces well under the body limit.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (Vitest) |
| `npm run verify` | typecheck + lint + test + build |
| `bash scripts/db-test.sh` | Applies the whole schema to a throwaway Postgres and runs the RLS and admin suites |
| `node scripts/build-harness.mjs` | Builds the compositor / export harnesses in `scripts/harness/` |

---

## Testing

**Unit tests** (`npm test`) cover the parts where a bug is expensive:

- the editor engine: split, trim, ripple cuts, speed, timeline fitting, id normalisation
- undo/redo, including "one AI request of twelve commands is one undo step"
- the store: batch atomicity, lenient mode, selection cleanup
- AI tool generation, parameter validation, and structured error recovery
- source-time ↔ timeline-time mapping under trimming, speed and reversal
- transcript search and silence detection mapped onto the timeline
- serialisation to and from the database shape
- compositing: transition windows, draw order, keyframe interpolation, effect resolution
- **whole requests**: `tests/scenario.test.ts` replays "lag denne bra for TikTok" against a synthetic twelve-minute bake-along — highlight scoring, the ripple cut, captions, sound effects, a sticker, a zoom punch, voice enhancement — and checks the result is vertical, under a third of the length, free of overlaps and exactly one undo step. It also cuts 200 silences out of an hour-long timeline and builds 1000 clips across ten tracks, so a regression in either shows up as a failing test rather than a slow editor.

**Fuzzing** (`tests/fuzz.test.ts`) pours ~22 000 semi-random but schema-valid actions through the registry from a fixed set of seeds and checks the timeline never reaches a state the rest of the app cannot render. Every bug it found is now also a named test in `tests/regressions.test.ts`.

**Database and RLS tests** (`bash scripts/db-test.sh`) apply every migration to a real Postgres and then assert the isolation guarantees: that user B cannot read, change or delete user A's projects, media, clips, history or AI conversations; that nobody can top up their own wallet; that credits actually run out; and that the refill and admin grant work.

**Manual verification harnesses** (`scripts/harness/`) render the real compositor and run a real export against local test files, so the rendering path can be inspected in a browser without a Supabase project. `window.stressCompose()` on the compositor harness draws every effect at both ends of its range, every transition and every text animation — about 8 000 frames — and reports anything that threw.

---

## Project layout

```
app/
  (auth)/            sign in, sign up, password reset
  (app)/             dashboard, projects, templates, settings
  editor/[projectId] the editor
  api/ai/chat        AI tool-calling loop (streams NDJSON)
  api/media/transcribe
  (app)/admin        the admin panel
  auth/              OAuth-style callback and sign-out
components/
  editor/            topbar, panels, timeline, preview, AI, export
  landing/           the public front page
  dashboard/         project grid, cards, credits, profile
  ui/                buttons, inputs, modal, tooltip
lib/
  editor/            the command engine: types, actions, reducer, history, store
  render/            compositor, media pool, audio mixer, exporter
  ai/                tools, project context, system prompt, runner
  media/             probing, audio analysis, upload, transcription, sound effects
  supabase/          browser, server, admin clients and middleware
  i18n/              dictionaries and provider
types/               editor and database types
supabase/
  migrations/        schema, RLS, functions, credits, storage
  test/              Postgres stub and the RLS test suite
```

`docs/` has the deeper explanations: `ARCHITECTURE.md`, `DATABASE.md`, `AI.md`, `EXPORT.md`.

---

## Licence

Private project. All rights reserved.

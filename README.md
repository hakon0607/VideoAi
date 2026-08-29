# VideoAI

A video editor where the AI assistant is not a chatbot bolted on the side — it drives the same editor you do, through the same validated commands.

Built with Next.js (App Router), TypeScript, Tailwind, Supabase (Auth, Postgres, Storage, RLS) and the OpenAI API. Renders real video files in the browser with WebCodecs.

---

## What it actually does

- **Multitrack timeline** — video, audio, text and overlay tracks; drag, trim, split, snap, ripple, zoom, keyboard shortcuts.
- **Preview that matches the export** — the preview and the exporter run the *same* compositing function, so what you see is what the file contains.
- **Real media analysis** — on upload, VideoAI reads duration, resolution and frame rate straight out of the container, grabs a poster frame, computes a waveform and detects every pause. All locally, at no cost.
- **Real transcription** — word-level timestamps from OpenAI, chunked so a two-hour recording is never truncated. This is what makes "remove all the pauses", "cut where I say ehm" and genuine captions possible.
- **AI that edits** — the assistant has ~50 editor commands and 8 read tools. It inspects the real timeline, plans, executes, and everything it does in one request is **one** undo step.
- **Real export** — H.264/MP4 or VP9/WebM rendered in the browser from the timeline, with a mixed audio track. Not a stub, not a screen recording.
- **Credits** — every user gets a balance that refills on a schedule; you control the price list and per-user balances from the Supabase dashboard.
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

1. **Run the schema.** In the SQL editor, paste and run `supabase/setup_all_in_one.sql`. That is every migration in `supabase/migrations/` concatenated in order, and it is safe to re-run.
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

### 4. Make yourself an admin

After signing up once:

```sql
update public.profiles set is_admin = true where username = 'your-username';
update public.user_credits set unlimited = true
where user_id = (select user_id from public.profiles where username = 'your-username');
```

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
| `bash scripts/db-test.sh` | Applies the whole schema to a throwaway Postgres and runs the RLS suite |
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

**Database and RLS tests** (`bash scripts/db-test.sh`) apply every migration to a real Postgres and then assert the isolation guarantees: that user B cannot read, change or delete user A's projects, media, clips, history or AI conversations; that nobody can top up their own wallet; that credits actually run out; and that the refill and admin grant work.

**Manual verification harnesses** (`scripts/harness/`) render the real compositor and run a real export against local test files, so the rendering path can be inspected in a browser without a Supabase project.

---

## Project layout

```
app/
  (auth)/            sign in, sign up, password reset
  (app)/             dashboard, projects, templates, settings
  editor/[projectId] the editor
  api/ai/chat        AI tool-calling loop (streams NDJSON)
  api/media/transcribe
  auth/              OAuth-style callback and sign-out
components/
  editor/            topbar, panels, timeline, preview, AI, export
  dashboard/         project grid, cards, credits, profile
  ui/                buttons, inputs, modal, tooltip
lib/
  editor/            the command engine: types, actions, reducer, history, store
  render/            compositor, media pool, audio mixer, exporter
  ai/                tools, project context, system prompt, runner
  media/             probing, audio analysis, upload, transcription
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

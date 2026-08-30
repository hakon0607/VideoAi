# Working on VideoAI

## The one rule

**Every change to a project goes through the command engine.** If you add a
feature that changes the timeline, add an action in `lib/editor/actions/` and
call it from the UI. Do not reach into the store and mutate state directly, and
do not add a code path the assistant cannot reach.

The payoff is automatic: the new capability gets validation, undo, autosave,
persistence and AI control for free, because all of those hang off the registry.

## Adding an editor command

1. Write the action in the right file under `lib/editor/actions/`:

```ts
const setClipTint = defineAction({
  type: 'set_clip_tint',
  category: 'clip',
  summary: 'Tint a clip toward a colour. Use for grading requests like "make it warmer".',
  schema: z.object({ clipId: uuidLike, color: z.string(), amount: z.number().min(0).max(1) }),
  apply: (state, params) => ({
    state: updateClip(state, params.clipId, (clip) => ({ ... })),
    description: `Tinted "${clip.name}"`,
  }),
});
```

2. Add it to the exported array at the bottom of the file. It is now in the
   registry, in the AI's toolbox, and undoable.
3. Render it if the compositor needs to know about it (`lib/render/compose.ts`).
4. Persist it if it needs a column — `supabase/migrations/`, `save_timeline`,
   and `lib/editor/serialize.ts` in both directions.
5. Add a test. `tests/editor-engine.test.ts` is the pattern.

`summary` is what the language model reads. Write it for someone who has never
seen the codebase: what it does, when to reach for it, and what the units are.

## Adding a read tool

`lib/ai/read-tools.ts`. The rule of thumb: if the model would otherwise have to
do arithmetic on source offsets, speed or reversal, do that arithmetic in the
tool and hand back timeline seconds.

## Admin surface

Anything that reads or writes across users goes through `supabase/migrations/`:
an admin view ending in `where public.is_admin()`, or a `SECURITY DEFINER`
function that checks `is_admin()` first. Do not reach for the service-role key
to answer a request from the browser — it is for storage objects in other
users' folders and nothing else.

## Before you push

```bash
npm run verify        # typecheck, lint, tests, build
bash scripts/db-test.sh   # only if you touched supabase/
```

## Conventions

- No `any`. The lint config enforces it.
- Reducers are pure and immutable — history depends on structural sharing.
- Comments explain *why*, not *what*. If a line needs a comment to say what it
  does, rename something instead.
- Interface strings go in `lib/i18n/dictionaries.ts`, in both languages. A key
  missing from `nb` is a type error.

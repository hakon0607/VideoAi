/**
 * Concatenates supabase/migrations/*.sql into supabase/setup_all_in_one.sql —
 * the single file a user pastes into the Supabase SQL editor. Running it after
 * adding a migration is what keeps the two in step.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'supabase/migrations';
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const header = `-- ===========================================================================
-- VideoAI · complete setup
-- ---------------------------------------------------------------------------
-- Paste this whole file into the Supabase SQL editor and run it.
-- It is every migration in supabase/migrations/ concatenated in order, and it
-- is safe to run more than once.
-- ===========================================================================

`;

const body = files
  .map((file) => `\n-- ==================== ${file} ====================\n\n${readFileSync(join(dir, file), 'utf8')}`)
  .join('\n');

writeFileSync('supabase/setup_all_in_one.sql', `${header}${body}`);
console.log(`setup_all_in_one.sql rebuilt from ${files.length} migrations`);

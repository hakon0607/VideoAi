// Bundles the compositor harness so it can be opened directly in a browser.
import { build } from 'esbuild';

// The app reads its Supabase configuration from the environment; the harness
// never calls Supabase, but the bundle still has to define the names.
const define = {
  'process.env.NEXT_PUBLIC_SUPABASE_URL': '"http://127.0.0.1:54321"',
  'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '"harness"',
  'process.env.NEXT_PUBLIC_MEDIA_STORAGE': '"local"',
  'process.env.NODE_ENV': '"production"',
};

const common = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  logLevel: 'info',
  define,
};

await build({
  ...common,
  entryPoints: ['scripts/harness/export-harness.ts'],
  outfile: 'scripts/harness/export-harness.js',
});

await build({
  ...common,
  entryPoints: ['scripts/harness/harness.ts'],
  outfile: 'scripts/harness/harness.js',
});

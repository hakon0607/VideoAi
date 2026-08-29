// Bundles the compositor harness so it can be opened directly in a browser.
import { build } from 'esbuild';

const common = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: ['scripts/harness/export-harness.ts'],
  outfile: 'scripts/harness/export-harness.js',
});

await build({
  entryPoints: ['scripts/harness/harness.ts'],
  outfile: 'scripts/harness/harness.js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  logLevel: 'info',
});

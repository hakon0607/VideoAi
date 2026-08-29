import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';


export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    globals: true,
  },
  resolve: {
    alias: {
      '@': new URL('.', import.meta.url).pathname,
      // The server-only guard is a Next.js build-time marker; under Vitest it
      // just needs to resolve to something harmless.
      'server-only': new URL('./tests/stubs/server-only.ts', import.meta.url).pathname,
    },
  },
});

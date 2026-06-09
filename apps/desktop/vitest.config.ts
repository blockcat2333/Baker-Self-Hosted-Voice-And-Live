import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@baker/client': fileURLToPath(
        new URL('../../packages/client/src', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts'],
  },
});

import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      coverage: {
        provider: 'v8',
        reportsDirectory: './coverage',
      },
      environment: 'node',
      include: ['apps/**/*.test.ts', 'packages/**/*.test.ts', 'docker/**/*.test.ts'],
      name: 'workspace',
    },
  },
]);

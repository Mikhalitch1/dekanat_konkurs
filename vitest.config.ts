import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
    coverage: {
      provider: 'v8',
      include: ['scripts/import-schedule/**/*.ts', 'scripts/lib/**/*.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      thresholds: { statements: 80, lines: 80, functions: 80, branches: 70 },
    },
  },
});

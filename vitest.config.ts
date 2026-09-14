import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.mjs'],
    // Tests in a file share the D1 database and verification mock.
    sequence: { concurrent: false },
    restoreMocks: true,
    unstubGlobals: true,
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/**/*.test.mjs', 'tests/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          environmentOptions: { jsdom: { url: 'https://famala.test/' } },
          include: ['tests/components/**/*.test.tsx'],
          setupFiles: ['tests/components/setup.ts'],
        },
      },
    ],
    // Tests in a file share the D1 database and verification mock.
    sequence: { concurrent: false },
    restoreMocks: true,
    unstubGlobals: true,
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});

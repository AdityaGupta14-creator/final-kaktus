import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['kaktus2/**', 'node_modules/**', '.next/**', '**/*.test.mjs'],
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

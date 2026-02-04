import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'bun',
    globals: true,
  },
});

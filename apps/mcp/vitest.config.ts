import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `tsc` emits compiled `*.test.js` into `dist/`; without this, vitest's own
    // defaults (which dropped a `dist` entry) run every test twice.
    exclude: [...configDefaults.exclude, 'e2e/**', '**/dist/**'],
  },
});

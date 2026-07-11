import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    // `tsc` emits compiled `*.test.js` into each package's `dist/`; without this,
    // vitest's own defaults (which dropped a `dist` entry) run every test twice.
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
});

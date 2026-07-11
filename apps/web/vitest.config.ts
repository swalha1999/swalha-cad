import { mergeConfig } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      passWithNoTests: true,
      exclude: [...configDefaults.exclude, 'e2e/**', '**/dist/**'],
    },
  }),
);

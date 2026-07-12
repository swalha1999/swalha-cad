import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const isCI = !!process.env['CI'];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  ...(isCI ? { workers: 1 } : {}),
  reporter: isCI ? 'line' : 'list',
  // Committed visual baselines live in a single tracked, platform-agnostic folder
  // (e.g. e2e/screenshots/part-studio.png) so the release gate diffs against a
  // stable artifact rather than per-OS files. The 3D WebGL canvas is masked in the
  // visual spec, so only the deterministic DOM chrome is compared.
  snapshotPathTemplate: '{testDir}/screenshots/{arg}{ext}',
  expect: {
    toHaveScreenshot: {
      // With the WebGL canvas hidden the remaining DOM is deterministic (Linux
      // CI and the baseline env both resolve the generic `sans-serif` stack to
      // DejaVu Sans via the pinned Chromium). This ratio absorbs any residual
      // sub-pixel text anti-aliasing while a real layout regression — which
      // shifts far more than 5% of pixels — still fails. Precise overlap/overflow
      // is additionally asserted via bounding boxes in part-studio-visual.spec.ts.
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    acceptDownloads: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
});

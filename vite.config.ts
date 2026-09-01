import path from 'path';
import { execFileSync } from 'node:child_process';
import { defineConfig } from '@lark-apaas/fullstack-vite-preset';

function sourceCommit(): string {
  const configured =
    process.env.MIAODA_DEPLOYED_COMMIT ??
    process.env.GIT_COMMIT ??
    process.env.COMMIT_SHA;
  if (configured?.trim()) return configured.trim();
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'UNAVAILABLE';
  }
}

const buildFingerprint = {
  sourceCommit: sourceCommit(),
  buildTime: new Date().toISOString(),
  visualVersion: 'R06.0-candidate',
};

export default defineConfig({
  define: {
    __WISELINK_SOURCE_COMMIT__: JSON.stringify(buildFingerprint.sourceCommit),
    __WISELINK_BUILD_TIME__: JSON.stringify(buildFingerprint.buildTime),
    __WISELINK_VISUAL_VERSION__: JSON.stringify(buildFingerprint.visualVersion),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
    },
  },
});

/**
 * node:test loader hook for running the applicability-fleet TypeScript
 * sources directly from the worktree without a build step.
 *
 * Node's native type stripping requires explicit file extensions on relative
 * imports, but the server sources use the repo-standard extensionless style
 * that tsc/nest resolves. This hook resolves extensionless relative imports
 * to their .ts siblings at test time only — the sources stay buildable.
 *
 * Usage: node --import ./test/node/ts-source-hooks.mjs --test <file>
 */
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TS_SUFFIXES = ['.ts', '/index.ts'];

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
        throw error;
      }
      for (const suffix of TS_SUFFIXES) {
        try {
          const candidate = new URL(`${specifier}${suffix}`, context.parentURL);
          if (existsSync(fileURLToPath(candidate))) {
            return {
              url: candidate.href,
              shortCircuit: true,
              format: 'module-typescript',
            };
          }
        } catch {
          // try next suffix
        }
      }
      throw error;
    }
  },
});
